import type { PlatformSqlite } from '../../core/platform/types'
import { waSqliteAdapter } from '../shared/wa-sqlite-adapter'

// Electron now uses the same wa-sqlite backend as browser/capacitor.
export function createElectronSqlite(): PlatformSqlite {
  return waSqliteAdapter
}
