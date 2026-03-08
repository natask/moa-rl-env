import { getPlatform } from '../platform'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'

function listFilesRecursive(dir: string, prefix: string = ''): string[] {
  const { fs, path } = getPlatform()
  const results: string[] = []
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return results }

  for (const name of names) {
    const fullPath = path.join(dir, String(name))
    const relPath = prefix ? `${prefix}/${name}` : String(name)
    let stat: ReturnType<typeof fs.statSync>
    try { stat = fs.statSync(fullPath) } catch { continue }

    if (stat.isDirectory() && !String(name).startsWith('.') && name !== 'node_modules' && name !== 'dist') {
      results.push(...listFilesRecursive(fullPath, relPath))
    } else if (stat.isFile() && /\.(ts|tsx|css|json|html)$/.test(String(name))) {
      results.push(`${relPath} (${stat.size}b)`)
    }
  }
  return results
}

export function createSelfEditTool(moaSrcPath: string): AgentTool<any, any> {
  return {
    name: 'self_inspect',
    label: 'Self Inspect',
    description: `Inspect the MOA agent's own codebase at ${moaSrcPath}.`,
    parameters: Type.Object({
      action: Type.String({ description: '"map", "read_self", "list_tools", "architecture", "state"' }),
      path: Type.Optional(Type.String({ description: 'Relative path within src/ (for read_self)' })),
    }),
    execute: async (_toolCallId, params) => {
      const { fs, path } = getPlatform()
      try {
        switch (params.action) {
          case 'map': {
            const files = listFilesRecursive(moaSrcPath)
            return { content: [{ type: 'text', text: `Source Tree (${moaSrcPath}):\n${files.length} files\n\n${files.join('\n')}` }], details: { fileCount: files.length } }
          }
          case 'read_self': {
            if (!params.path) return { content: [{ type: 'text', text: 'Error: "path" required' }], details: {} }
            const fullPath = path.resolve(moaSrcPath, params.path)
            if (!fullPath.startsWith(moaSrcPath)) return { content: [{ type: 'text', text: `Error: path must be within ${moaSrcPath}` }], details: {} }
            const content = fs.readFileSync(fullPath, 'utf-8')
            return { content: [{ type: 'text', text: content }], details: { path: fullPath, size: content.length } }
          }
          case 'architecture': {
            return { content: [{ type: 'text', text: `MOA v2 Architecture\n===================\nBrowser-native core with platform abstraction.\nPlatform: ${getPlatform().type}\nServices: agent-service, event-store (SQLite), session-store, db (IndexedDB)\nTools: read, write, edit, bash, search, web_fetch, intent, self_inspect, history` }], details: {} }
          }
          case 'state': {
            const _w = window as any
            const state: Record<string, any> = { platform: getPlatform().type }
            if (_w.__agentService) state.agents = Array.from(_w.__agentService.agents?.keys() || [])
            return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }], details: state }
          }
          default: return { content: [{ type: 'text', text: `Unknown action: "${params.action}"` }], details: {} }
        }
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], details: { error: e.message } }
      }
    },
  }
}
