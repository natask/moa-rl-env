import pathBrowserify from 'path-browserify'
import type { PlatformPath } from '../../core/platform/types'

export const browserPath: PlatformPath = {
  join: (...parts: string[]) => pathBrowserify.join(...parts),
  dirname: (p: string) => pathBrowserify.dirname(p),
  resolve: (...parts: string[]) => pathBrowserify.resolve(...parts),
  basename: (p: string, ext?: string) => ext ? pathBrowserify.basename(p, ext) : pathBrowserify.basename(p),
  extname: (p: string) => pathBrowserify.extname(p),
  sep: '/',
}
