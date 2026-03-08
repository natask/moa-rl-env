import { getPlatform } from '../platform'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { db, dbReady } from '../services/db'
import { logAction } from '../services/action-logger'

// Browser-native file walker for when shell commands aren't available
function browserFileSearch(query: string, dir: string, type: 'content' | 'files', maxResults: number, filePattern?: string): string[] {
  const { fs, path } = getPlatform()
  const results: string[] = []
  const ignores = ['node_modules', '.git', 'dist']

  function walk(currentDir: string) {
    if (results.length >= maxResults) return
    let entries: string[]
    try { entries = fs.readdirSync(currentDir) } catch { return }

    for (const entry of entries) {
      if (results.length >= maxResults) return
      const fullPath = path.join(currentDir, entry)
      let stat: ReturnType<typeof fs.statSync>
      try { stat = fs.statSync(fullPath) } catch { continue }

      if (stat.isDirectory()) {
        if (!ignores.includes(entry) && !entry.startsWith('.')) {
          walk(fullPath)
        }
      } else if (stat.isFile()) {
        if (type === 'files') {
          // Simple glob matching: *.ts matches .ts extension
          if (matchSimpleGlob(entry, query)) {
            results.push(fullPath)
          }
        } else {
          // Content search
          if (filePattern && !matchSimpleGlob(entry, filePattern)) continue
          try {
            const content = fs.readFileSync(fullPath, 'utf-8')
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) break
              if (lines[i].includes(query)) {
                results.push(`${fullPath}:${i + 1}: ${lines[i].trim()}`)
              }
            }
          } catch { /* skip unreadable files */ }
        }
      }
    }
  }

  walk(dir)
  return results
}

function matchSimpleGlob(filename: string, pattern: string): boolean {
  // Handle simple patterns: *.ts, *.tsx, test.*, etc.
  const regex = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')
  return new RegExp(`^${regex}$`).test(filename)
}

export function createSearchTool(): AgentTool<any, any> {
  return {
    name: 'search',
    label: 'Search',
    description:
      'Search across files, code, and conversation history. ' +
      'In desktop mode, uses ripgrep (rg). In browser mode, uses built-in file walker.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      path: Type.Optional(Type.String({ description: 'Directory to search in (default: /)' })),
      type: Type.Optional(Type.String({ description: '"content" (default), "files" (filename glob), "history"' })),
      filePattern: Type.Optional(Type.String({ description: 'File glob pattern (e.g. "*.ts")' })),
      maxResults: Type.Optional(Type.Number({ description: 'Max results (default: 50)' })),
    }),
    execute: async (_toolCallId, params) => {
      const maxResults = params.maxResults || 50
      const platform = getPlatform()
      const cwd = params.path || platform.process.cwd()

      try {
        // History search — always uses IndexedDB, platform-independent
        if (params.type === 'history') {
          await dbReady
          const query = params.query.toLowerCase()
          const sessions = await db.listSessions()
          const results: string[] = []

          for (const session of sessions) {
            if (results.length >= maxResults) break
            const messages = await db.getMessages(session.id)
            for (const msg of messages) {
              if (results.length >= maxResults) break
              const content = msg.content || ''
              if (content.toLowerCase().includes(query)) {
                const date = new Date(msg.createdAt).toISOString().slice(0, 16)
                const snippet = content.length > 200 ? content.substring(0, 200) + '...' : content
                results.push(`[${date}] Session "${session.title}" (${session.id}) [${msg.role}]:\n  ${snippet}`)
              }
            }
          }

          logAction('tool.search', { query: params.query, searchType: 'history', resultCount: results.length }, { actor: 'agent' })
          return {
            content: [{ type: 'text', text: results.length > 0
              ? `History: ${results.length} matches:\n\n${results.join('\n\n')}`
              : `No history matches for "${params.query}".` }],
            details: { type: 'history', query: params.query, matchCount: results.length },
          }
        }

        // File/content search — use shell on Electron, JS walker on browser
        if (platform.type === 'browser') {
          const searchType = params.type === 'files' ? 'files' : 'content'
          const results = browserFileSearch(params.query, cwd, searchType, maxResults, params.filePattern)
          logAction('tool.search', { query: params.query, searchType, resultCount: results.length }, { actor: 'agent' })
          return {
            content: [{ type: 'text', text: results.length > 0 ? results.join('\n') : 'No matches found.' }],
            details: { type: searchType, query: params.query, path: cwd, matchCount: results.length },
          }
        }

        // Electron mode: use rg/grep/find via shell (original behavior)
        if (params.type === 'files') {
          const cmd = `find ${JSON.stringify(cwd)} -maxdepth 10 -name ${JSON.stringify(params.query)} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' 2>/dev/null | head -${maxResults}`
          const output = platform.process.execSync(cmd, { timeout: 10000 })
          const lines = output.split('\n').filter(Boolean)
          logAction('tool.search', { query: params.query, searchType: 'files', resultCount: lines.length }, { actor: 'agent' })
          return {
            content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No files found.' }],
            details: { type: 'files', query: params.query, count: lines.length },
          }
        }

        // Content search with rg/grep
        const escapedQuery = params.query.replace(/'/g, "'\\''")
        let hasRg = false
        try { platform.process.execSync('which rg', { timeout: 5000 }); hasRg = true } catch {}

        let cmd: string
        if (hasRg) {
          const parts = ['rg', '--max-count 5', '--line-number', '--no-heading', '--color never']
          if (params.filePattern) parts.push(`--glob '${params.filePattern}'`)
          parts.push("--glob '!node_modules'", "--glob '!.git'", "--glob '!dist'",
                     `'${escapedQuery}'`, JSON.stringify(cwd), '2>/dev/null', `| head -${maxResults * 2}`)
          cmd = parts.join(' ')
        } else {
          const parts = ['grep -rn', '--color=never']
          if (params.filePattern) parts.push(`--include='${params.filePattern}'`)
          parts.push('--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist',
                     `'${escapedQuery}'`, JSON.stringify(cwd), '2>/dev/null', `| head -${maxResults}`)
          cmd = parts.join(' ')
        }

        const output = platform.process.execSync(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 })
        const lines = output.split('\n').filter(Boolean)
        logAction('tool.search', { query: params.query, searchType: 'content', resultCount: lines.length }, { actor: 'agent' })
        return {
          content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No matches found.' }],
          details: { type: 'content', query: params.query, path: cwd, matchCount: lines.length },
        }
      } catch (e: any) {
        if (e.status && e.stdout !== undefined) {
          const stdout = e.stdout.toString().trim()
          if (stdout) return { content: [{ type: 'text', text: stdout }], details: { type: params.type || 'content', query: params.query, path: cwd } }
          return { content: [{ type: 'text', text: 'No matches found.' }], details: { type: params.type || 'content', query: params.query, path: cwd } }
        }
        return { content: [{ type: 'text', text: `Search error: ${e.message}` }], details: { error: e.message } }
      }
    },
  }
}
