// Browser filesystem — @zenfs/core with IndexedDB backend
// Provides Node-like fs API backed by IndexedDB for persistence

import { configure, fs } from '@zenfs/core'
import { IndexedDB } from '@zenfs/dom'
import type { PlatformFs } from '../../core/platform/types'

let initialized = false

export async function initBrowserFs(): Promise<PlatformFs> {
  if (!initialized) {
    await configure({
      mounts: {
        '/': { backend: IndexedDB, storeName: 'moa-fs' }
      }
    })
    initialized = true
  }

  return {
    readFile: async (path: string, encoding: 'utf-8') => {
      return fs.promises.readFile(path, encoding) as Promise<string>
    },

    readFileSync: (path: string, encoding: 'utf-8') => {
      return fs.readFileSync(path, encoding) as string
    },

    writeFile: async (path: string, content: string) => {
      await fs.promises.writeFile(path, content, 'utf-8')
    },

    writeFileSync: (path: string, content: string) => {
      fs.writeFileSync(path, content, 'utf-8')
    },

    existsSync: (path: string) => {
      return fs.existsSync(path)
    },

    mkdirSync: (path: string, opts?: { recursive: boolean }) => {
      fs.mkdirSync(path, opts)
    },

    readdirSync: (path: string) => {
      return fs.readdirSync(path) as string[]
    },

    statSync: (path: string) => {
      const stat = fs.statSync(path)
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        size: stat.size,
      }
    },

    unlinkSync: (path: string) => {
      fs.unlinkSync(path)
    },
  }
}
