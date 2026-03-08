import type { Platform } from './types'

let _platform: Platform | null = null

export function setPlatform(p: Platform): void {
  _platform = p
}

export function getPlatform(): Platform {
  if (!_platform) {
    throw new Error('Platform not initialized. Call setPlatform() before using any platform APIs.')
  }
  return _platform
}

export type { Platform, PlatformFs, PlatformPath, PlatformProcess, PlatformDatabase, PlatformStatement, PlatformSqlite, PlatformShell } from './types'
