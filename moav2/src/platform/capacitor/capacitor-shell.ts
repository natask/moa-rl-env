import { Browser } from '@capacitor/browser'
import type { PlatformShell } from '../../core/platform/types'

export const capacitorShell: PlatformShell = {
  openExternal(url: string): void {
    Browser.open({ url }).catch(err => {
      console.error('[MOA] Failed to open external URL:', err)
    })
  }
}
