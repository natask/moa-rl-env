/**
 * Agent Tools tests — verifies write, read, edit, bash, and search tools
 * in browser mode backed by @zenfs/core (IndexedDB via fake-indexeddb).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import 'fake-indexeddb/auto'
import { setPlatform, getPlatform } from '../core/platform'
import { createBrowserPlatform } from '../platform/browser'
import { createReadTool } from '../core/tools/read-tool'
import { createWriteTool } from '../core/tools/write-tool'
import { createEditTool } from '../core/tools/edit-tool'
import { createBashTool } from '../core/tools/bash-tool'
import { createSearchTool } from '../core/tools/search-tool'
import { createAllTools } from '../core/tools'

/** Helper to extract text from tool result content block */
function text(result: any, idx = 0): string {
  return (result.content[idx] as any).text
}

describe('Agent Tools (browser mode)', () => {
  beforeAll(async () => {
    const platform = await createBrowserPlatform()
    setPlatform(platform)
  })

  describe('write + read', () => {
    it('writes and reads a file', async () => {
      const write = createWriteTool()
      const read = createReadTool()

      const writeResult = await write.execute('t1', { path: '/project/test.txt', content: 'Hello from MOA' })
      expect(text(writeResult)).toContain('Wrote')
      expect(text(writeResult)).toContain('/project/test.txt')

      const readResult = await read.execute('t2', { path: '/project/test.txt' })
      expect(text(readResult)).toBe('Hello from MOA')
    })

    it('creates parent directories automatically', async () => {
      const write = createWriteTool()
      const read = createReadTool()

      await write.execute('t1', { path: '/deep/nested/dir/file.txt', content: 'deep content' })
      const result = await read.execute('t2', { path: '/deep/nested/dir/file.txt' })
      expect(text(result)).toBe('deep content')
    })

    it('read returns error for non-existent file', async () => {
      const read = createReadTool()
      const result = await read.execute('t1', { path: '/nonexistent/file.txt' })
      expect(text(result)).toContain('Error')
    })

    it('write overwrites existing file', async () => {
      const write = createWriteTool()
      const read = createReadTool()

      await write.execute('t1', { path: '/project/overwrite.txt', content: 'first' })
      await write.execute('t2', { path: '/project/overwrite.txt', content: 'second' })
      const result = await read.execute('t3', { path: '/project/overwrite.txt' })
      expect(text(result)).toBe('second')
    })
  })

  describe('edit', () => {
    it('replaces text in a file', async () => {
      const write = createWriteTool()
      const edit = createEditTool()
      const read = createReadTool()

      await write.execute('t1', { path: '/project/edit.txt', content: 'foo bar baz' })
      await edit.execute('t2', { path: '/project/edit.txt', old_string: 'bar', new_string: 'QUX' })
      const result = await read.execute('t3', { path: '/project/edit.txt' })
      expect(text(result)).toBe('foo QUX baz')
    })

    it('returns error when old_string not found', async () => {
      const write = createWriteTool()
      const edit = createEditTool()

      await write.execute('t1', { path: '/project/edit2.txt', content: 'hello' })
      const result = await edit.execute('t2', { path: '/project/edit2.txt', old_string: 'MISSING', new_string: 'x' })
      expect(text(result)).toContain('not found')
    })

    it('replaces only first occurrence', async () => {
      const write = createWriteTool()
      const edit = createEditTool()
      const read = createReadTool()

      await write.execute('t1', { path: '/project/edit3.txt', content: 'aaa bbb aaa' })
      await edit.execute('t2', { path: '/project/edit3.txt', old_string: 'aaa', new_string: 'ZZZ' })
      const result = await read.execute('t3', { path: '/project/edit3.txt' })
      expect(text(result)).toBe('ZZZ bbb aaa')
    })

    it('returns error for non-existent file', async () => {
      const edit = createEditTool()
      const result = await edit.execute('t1', { path: '/nonexistent/edit.txt', old_string: 'a', new_string: 'b' })
      expect(text(result)).toContain('Error')
    })
  })

  describe('bash', () => {
    it('returns browser mode message', async () => {
      const bash = createBashTool()
      const result = await bash.execute('t1', { command: 'ls -la' })
      // In browser mode, process.exec returns exitCode=1 and stdout contains "Browser mode"
      // The bash tool formats exitCode!=0 as "stdout:\n...\nstderr:\n..."
      expect(text(result)).toContain('Browser mode')
    })

    it('includes the attempted command in output', async () => {
      const bash = createBashTool()
      const result = await bash.execute('t1', { command: 'echo hello' })
      expect(text(result)).toContain('echo hello')
    })
  })

  describe('search', () => {
    it('searches file content in browser mode', async () => {
      const write = createWriteTool()
      const search = createSearchTool()

      // Create a file with searchable content
      await write.execute('t1', { path: '/searchtest/file.ts', content: 'const hello = "world"' })
      const result = await search.execute('t2', { query: 'hello', path: '/searchtest', type: 'content' })
      expect(text(result)).toContain('hello')
    })

    it('searches filenames in browser mode', async () => {
      const write = createWriteTool()
      const search = createSearchTool()

      await write.execute('t1', { path: '/searchtest2/app.tsx', content: 'export default function App() {}' })
      const result = await search.execute('t2', { query: '*.tsx', path: '/searchtest2', type: 'files' })
      expect(text(result)).toContain('app.tsx')
    })

    it('returns no matches for content not present', async () => {
      const write = createWriteTool()
      const search = createSearchTool()

      await write.execute('t1', { path: '/searchtest3/data.txt', content: 'alpha beta gamma' })
      const result = await search.execute('t2', { query: 'zzzzz', path: '/searchtest3', type: 'content' })
      expect(text(result)).toContain('No matches')
    })

    it('returns no matches for filenames not present', async () => {
      const write = createWriteTool()
      const search = createSearchTool()

      await write.execute('t1', { path: '/searchtest4/index.js', content: 'x' })
      const result = await search.execute('t2', { query: '*.py', path: '/searchtest4', type: 'files' })
      expect(text(result)).toContain('No matches')
    })

    it('content search includes line numbers', async () => {
      const write = createWriteTool()
      const search = createSearchTool()

      await write.execute('t1', {
        path: '/searchtest5/multi.txt',
        content: 'line one\nline two target\nline three',
      })
      const result = await search.execute('t2', { query: 'target', path: '/searchtest5', type: 'content' })
      // Browser file search returns "path:linenum: content"
      expect(text(result)).toContain(':2:')
      expect(text(result)).toContain('target')
    })

    it('searches with default path when path not specified', async () => {
      const write = createWriteTool()
      const search = createSearchTool()

      // Write to root (browser cwd is /)
      await write.execute('t1', { path: '/rootsearch.txt', content: 'findme' })
      const result = await search.execute('t2', { query: 'findme' })
      expect(text(result)).toContain('findme')
    })
  })

  describe('tool metadata', () => {
    it('tools have name, label, description, parameters', () => {
      const tools = [
        createReadTool(),
        createWriteTool(),
        createEditTool(),
        createBashTool(),
        createSearchTool(),
      ]

      for (const tool of tools) {
        expect(tool.name).toBeTruthy()
        expect(tool.label).toBeTruthy()
        expect(tool.description).toBeTruthy()
        expect(tool.parameters).toBeDefined()
        expect(typeof tool.execute).toBe('function')
      }
    })

    it('tools have distinct names', () => {
      const tools = [
        createReadTool(),
        createWriteTool(),
        createEditTool(),
        createBashTool(),
        createSearchTool(),
      ]
      const names = tools.map(t => t.name)
      expect(new Set(names).size).toBe(names.length)
    })

    it('registers web_fetch in default tool set', () => {
      const tools = createAllTools()
      expect(tools.some(t => t.name === 'web_fetch')).toBe(true)
    })
  })
})
