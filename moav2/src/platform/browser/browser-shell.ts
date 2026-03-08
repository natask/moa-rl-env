import type { PlatformShell } from '../../core/platform/types'

export const browserShell: PlatformShell = {
  openExternal: (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
