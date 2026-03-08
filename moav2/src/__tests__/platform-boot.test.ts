/**
 * Platform Boot tests — verifies browser platform init, fs, path, process, shell.
 * Tests the browser platform backed by @zenfs/core (IndexedDB via fake-indexeddb in jsdom).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import 'fake-indexeddb/auto'
import { setPlatform, getPlatform } from '../core/platform'
import { createBrowserPlatform } from '../platform/browser'

describe('Platform Boot', () => {
  beforeAll(async () => {
    const platform = await createBrowserPlatform()
    setPlatform(platform)
  })

  it('initializes browser platform', () => {
    expect(getPlatform().type).toBe('browser')
  })

  it('has filesystem with read/write', () => {
    const { fs } = getPlatform()
    fs.mkdirSync('/test-boot', { recursive: true })
    fs.writeFileSync('/test-boot/hello.txt', 'world')
    expect(fs.readFileSync('/test-boot/hello.txt', 'utf-8')).toBe('world')
  })

  it('has filesystem existsSync', () => {
    const { fs } = getPlatform()
    expect(fs.existsSync('/test-boot/hello.txt')).toBe(true)
    expect(fs.existsSync('/test-boot/nope.txt')).toBe(false)
  })

  it('has filesystem readdirSync', () => {
    const { fs } = getPlatform()
    const entries = fs.readdirSync('/test-boot')
    expect(entries).toContain('hello.txt')
  })

  it('has filesystem statSync', () => {
    const { fs } = getPlatform()
    const stat = fs.statSync('/test-boot/hello.txt')
    expect(stat.isFile()).toBe(true)
    expect(stat.isDirectory()).toBe(false)
    expect(stat.size).toBeGreaterThan(0)
  })

  it('has filesystem unlinkSync', () => {
    const { fs } = getPlatform()
    fs.writeFileSync('/test-boot/to-delete.txt', 'bye')
    expect(fs.existsSync('/test-boot/to-delete.txt')).toBe(true)
    fs.unlinkSync('/test-boot/to-delete.txt')
    expect(fs.existsSync('/test-boot/to-delete.txt')).toBe(false)
  })

  it('has async readFile/writeFile', async () => {
    const { fs } = getPlatform()
    fs.mkdirSync('/test-async', { recursive: true })
    await fs.writeFile('/test-async/data.txt', 'async-content')
    const content = await fs.readFile('/test-async/data.txt', 'utf-8')
    expect(content).toBe('async-content')
  })

  it('has path utilities', () => {
    const { path } = getPlatform()
    expect(path.join('/a', 'b', 'c')).toBe('/a/b/c')
    expect(path.dirname('/a/b/c.txt')).toBe('/a/b')
    expect(path.basename('/a/b/c.txt')).toBe('c.txt')
    expect(path.basename('/a/b/c.txt', '.txt')).toBe('c')
    expect(path.extname('/a/b/c.txt')).toBe('.txt')
    expect(path.sep).toBe('/')
  })

  it('has path.resolve', () => {
    const { path } = getPlatform()
    // resolve should produce an absolute path
    const resolved = path.resolve('/a', 'b', 'c')
    expect(resolved).toBe('/a/b/c')
  })

  it('has process stub', () => {
    const { process } = getPlatform()
    expect(process.cwd()).toBe('/')
    expect(process.homedir()).toBe('/')
    expect(typeof process.env).toBe('object')
  })

  it('has process.exec that returns browser mode message', async () => {
    const { process } = getPlatform()
    const result = await process.exec('ls -la')
    expect(result.stdout).toContain('Browser mode')
    expect(result.exitCode).toBe(1)
  })

  it('has process.execSync that returns browser mode message', () => {
    const { process } = getPlatform()
    const result = process.execSync('ls -la')
    expect(result).toContain('Browser mode')
  })

  it('has shell with openExternal', () => {
    expect(getPlatform().shell.openExternal).toBeDefined()
    expect(typeof getPlatform().shell.openExternal).toBe('function')
  })

  it('has sqlite interface', () => {
    expect(getPlatform().sqlite).toBeDefined()
    expect(typeof getPlatform().sqlite.open).toBe('function')
  })
})
