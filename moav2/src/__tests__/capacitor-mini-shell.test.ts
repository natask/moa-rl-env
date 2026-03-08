import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCapacitorMiniShell } from '../platform/capacitor/capacitor-mini-shell'
import { setPlatform } from '../core/platform'
import path from 'path'

function createMemoryFs() {
  const files = new Map<string, string>()
  const dirs = new Set<string>(['/'])

  const normalize = (p: string) => path.posix.resolve('/', p)

  const ensureDir = (p: string) => {
    const target = normalize(p)
    const stack: string[] = []
    let cursor = target
    while (!dirs.has(cursor) && cursor !== '/') {
      stack.push(cursor)
      cursor = path.posix.dirname(cursor)
    }
    dirs.add('/')
    while (stack.length > 0) {
      dirs.add(stack.pop() as string)
    }
  }

  return {
    readFile: async (p: string) => files.get(normalize(p)) || '',
    readFileSync: (p: string) => files.get(normalize(p)) || '',
    writeFile: async (p: string, content: string) => {
      const n = normalize(p)
      ensureDir(path.posix.dirname(n))
      files.set(n, content)
    },
    writeFileSync: (p: string, content: string) => {
      const n = normalize(p)
      ensureDir(path.posix.dirname(n))
      files.set(n, content)
    },
    existsSync: (p: string) => {
      const n = normalize(p)
      return files.has(n) || dirs.has(n)
    },
    mkdirSync: (p: string) => {
      ensureDir(p)
    },
    readdirSync: (p: string) => {
      const n = normalize(p)
      const out: string[] = []
      for (const dir of dirs) {
        if (dir !== n && path.posix.dirname(dir) === n) out.push(path.posix.basename(dir))
      }
      for (const file of files.keys()) {
        if (path.posix.dirname(file) === n) out.push(path.posix.basename(file))
      }
      return out.sort()
    },
    statSync: (p: string) => {
      const n = normalize(p)
      return {
        isFile: () => files.has(n),
        isDirectory: () => dirs.has(n),
        size: files.get(n)?.length || 0,
      }
    },
    unlinkSync: (p: string) => {
      files.delete(normalize(p))
    },
  }
}

describe('capacitor mini shell', () => {
  let shell: ReturnType<typeof createCapacitorMiniShell>
  const execSpy = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
  const execSyncSpy = vi.fn(() => '')

  beforeAll(async () => {
    const fs = createMemoryFs()
    setPlatform({
      type: 'capacitor',
      fs: fs as any,
      path: path.posix as any,
      process: {
        exec: execSpy,
        execSync: execSyncSpy,
        cwd: () => '/',
        env: {},
        homedir: () => '/',
      },
      sqlite: { open: async () => ({ exec: async () => {}, prepare: () => ({ run: async () => {}, get: async () => ({}), all: async () => [] }), close: async () => {} }) },
      shell: { openExternal: () => {} },
    } as any)
  })

  beforeEach(() => {
    shell = createCapacitorMiniShell()
  })

  it('supports pwd and cd', async () => {
    const pwd = await shell.execute('pwd')
    expect(pwd.output).toBe('/')

    await shell.execute('mkdir docs')
    const cd = await shell.execute('cd docs')
    expect(cd.output).toBe('')

    const pwd2 = await shell.execute('pwd')
    expect(pwd2.output).toBe('/docs')

    const badCd = await shell.execute('cd missing')
    expect(badCd.output).toContain('no such file or directory')
    expect(shell.getCwd()).toBe('/docs')
  })

  it('supports touch, ls, cat, echo, rm', async () => {
    await shell.execute('mkdir notes')
    await shell.execute('cd notes')
    await shell.execute('touch todo.txt')
    await shell.execute('mkdir dir-a')

    const ls = await shell.execute('ls')
    expect(ls.output).toContain('todo.txt')
    expect(ls.output).toContain('dir-a/')

    const echo = await shell.execute('echo hello')
    expect(echo.output).toBe('hello')

    const echoQuoted = await shell.execute('echo "hello world"')
    expect(echoQuoted.output).toBe('hello world')

    const cat = await shell.execute('cat todo.txt')
    expect(cat.output).toBe('')

    await shell.execute('touch nested/a/b.txt')
    const nested = await shell.execute('ls nested')
    expect(nested.output).toContain('a/')

    const rm = await shell.execute('rm todo.txt')
    expect(rm.output).toBe('')

    const rmDir = await shell.execute('rm dir-a')
    expect(rmDir.output).toContain('Is a directory')
  })

  it('supports help, clear and unknown commands', async () => {
    const help = await shell.execute('help')
    expect(help.output).toContain('print current directory')

    const clear = await shell.execute('clear')
    expect(clear.clear).toBe(true)

    const unknown = await shell.execute('nope')
    expect(unknown.output).toContain('command not found: nope')

    expect(execSpy).not.toHaveBeenCalled()
    expect(execSyncSpy).not.toHaveBeenCalled()
  })
})
