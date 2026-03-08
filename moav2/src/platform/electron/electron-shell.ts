import type { PlatformShell } from '../../core/platform/types'

export function createElectronShell(): PlatformShell {
  return {
    openExternal: (url: string) => {
      const { shell } = (window as any).require('electron')
      shell.openExternal(url)
    }
  }
}
