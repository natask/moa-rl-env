import { describe, it, expect, beforeAll, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { setPlatform, getPlatform } from '../core/platform'
import { createCapacitorPlatform } from '../platform/capacitor'

// Mock capacitor environment globals if necessary
vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn().mockResolvedValue(undefined)
  }
}))

describe('Platform Boot (Capacitor)', () => {
  beforeAll(async () => {
    // We assume createCapacitorPlatform handles its own setup.
    // For now, it might reuse some browser components (like ZenFS) 
    // or provide its own capacitor-specific implementations.
    const platform = await createCapacitorPlatform()
    setPlatform(platform)
  })

  it('initializes capacitor platform', () => {
    expect(getPlatform().type).toBe('capacitor')
  })

  it('has filesystem with read/write', async () => {
    const { fs } = getPlatform()
    fs.mkdirSync('/test-cap', { recursive: true })
    fs.writeFileSync('/test-cap/hello.txt', 'world')
    expect(fs.readFileSync('/test-cap/hello.txt', 'utf-8')).toBe('world')
  })

  it('has filesystem async read/write', async () => {
    const { fs } = getPlatform()
    fs.mkdirSync('/test-cap', { recursive: true })
    await fs.writeFile('/test-cap/hello-async.txt', 'world-async')
    const content = await fs.readFile('/test-cap/hello-async.txt', 'utf-8')
    expect(content).toBe('world-async')
  })
  
  it('has process stub', () => {
    const { process } = getPlatform()
    expect(process.cwd()).toBe('/')
    expect(typeof process.env).toBe('object')
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
