import type { Platform } from '../../core/platform/types'
// We will reuse some browser components for now until we specifically need native plugins
import { initBrowserFs } from '../browser/browser-fs'
import { browserPath } from '../browser/browser-path'
import { createBrowserProcess } from '../browser/browser-process'
import { browserSqlite } from '../browser/browser-sqlite'
import { capacitorShell } from './capacitor-shell'

/**
 * Create the capacitor platform.
 */
export async function createCapacitorPlatform(): Promise<Platform> {
  const fs = await initBrowserFs()

  return {
    fs,
    path: browserPath,
    process: createBrowserProcess(),
    sqlite: browserSqlite,
    shell: capacitorShell,
    type: 'capacitor',
  }
}
