import type { PlatformPath } from '../../core/platform/types'

export function createElectronPath(): PlatformPath {
  const path = (window as any).require('path')
  return {
    join: (...parts: string[]) => path.join(...parts),
    dirname: (p: string) => path.dirname(p),
    resolve: (...parts: string[]) => path.resolve(...parts),
    basename: (p: string, ext?: string) => ext ? path.basename(p, ext) : path.basename(p),
    extname: (p: string) => path.extname(p),
    sep: path.sep,
  }
}
