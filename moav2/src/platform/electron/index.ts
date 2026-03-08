import type { Platform } from '../../core/platform/types'
import { createElectronFs } from './electron-fs'
import { createElectronPath } from './electron-path'
import { createElectronProcess } from './electron-process'
import { createElectronSqlite } from './electron-sqlite'
import { createElectronShell } from './electron-shell'

/**
 * Create the Electron platform.
 * Wraps real Node.js APIs available via window.require() in Electron.
 * This file is only imported when running inside Electron (dynamic import in main.tsx).
 */
export function createElectronPlatform(): Platform {
  return {
    fs: createElectronFs(),
    path: createElectronPath(),
    process: createElectronProcess(),
    sqlite: createElectronSqlite(),
    shell: createElectronShell(),
    type: 'electron',
  }
}
