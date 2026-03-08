import type { Platform } from '../../core/platform/types'
import { initBrowserFs } from './browser-fs'
import { browserPath } from './browser-path'
import { createBrowserProcess } from './browser-process'
import { browserSqlite } from './browser-sqlite'
import { browserShell } from './browser-shell'

/**
 * Create the browser platform.
 * Async because filesystem and SQLite need initialization.
 */
export async function createBrowserPlatform(): Promise<Platform> {
  const fs = await initBrowserFs()

  return {
    fs,
    path: browserPath,
    process: createBrowserProcess(),
    sqlite: browserSqlite,
    shell: browserShell,
    type: 'browser',
  }
}
