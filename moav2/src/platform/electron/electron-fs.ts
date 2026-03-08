import type { PlatformFs } from '../../core/platform/types'

export function createElectronFs(): PlatformFs {
  const fs = (window as any).require('fs')

  return {
    readFile: async (path: string, encoding: 'utf-8') => fs.readFileSync(path, encoding),
    readFileSync: (path: string, encoding: 'utf-8') => fs.readFileSync(path, encoding),
    writeFile: async (path: string, content: string) => fs.writeFileSync(path, content, 'utf-8'),
    writeFileSync: (path: string, content: string) => fs.writeFileSync(path, content, 'utf-8'),
    existsSync: (path: string) => fs.existsSync(path),
    mkdirSync: (path: string, opts?: { recursive: boolean }) => fs.mkdirSync(path, opts),
    readdirSync: (path: string) => fs.readdirSync(path) as string[],
    statSync: (path: string) => {
      const s = fs.statSync(path)
      return {
        isFile: () => s.isFile(),
        isDirectory: () => s.isDirectory(),
        size: s.size,
      }
    },
    unlinkSync: (path: string) => fs.unlinkSync(path),
  }
}
