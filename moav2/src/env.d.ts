/// <reference types="vite/client" />

declare module 'path-browserify' {
  import path from 'path'
  export default path
}

declare module 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js' {
  export class IDBBatchAtomicVFS {
    static create(name: string, module: any, options?: any): Promise<any>
    name: string
  }
}

declare module 'wa-sqlite/src/sqlite-constants.js' {
  export const SQLITE_ROW: 100
  export const SQLITE_DONE: 101
  export const SQLITE_OK: 0
}
