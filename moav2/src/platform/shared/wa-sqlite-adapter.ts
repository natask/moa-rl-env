import { Factory } from 'wa-sqlite'
// @ts-ignore - wa-sqlite ships ESM builds
import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs'
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js'
import { SQLITE_ROW } from 'wa-sqlite/src/sqlite-constants.js'
import type { PlatformDatabase, PlatformStatement, PlatformSqlite } from '../../core/platform/types'

class WaSqliteStatement implements PlatformStatement {
  private sqlite3: any
  private db: number
  private sql: string

  constructor(sqlite3: any, db: number, sql: string) {
    this.sqlite3 = sqlite3
    this.db = db
    this.sql = sql
  }

  async run(...params: any[]): Promise<any> {
    for await (const stmt of this.sqlite3.statements(this.db, this.sql)) {
      if (params.length > 0) {
        this.sqlite3.bind_collection(stmt, params)
      }
      await this.sqlite3.step(stmt)
    }
    return { changes: this.sqlite3.changes(this.db) }
  }

  async get(...params: any[]): Promise<any> {
    const rows = await this.all(...params)
    return rows.length > 0 ? rows[0] : undefined
  }

  async all(...params: any[]): Promise<any[]> {
    const results: any[] = []
    for await (const stmt of this.sqlite3.statements(this.db, this.sql)) {
      if (params.length > 0) {
        this.sqlite3.bind_collection(stmt, params)
      }
      const columns = this.sqlite3.column_names(stmt)
      while (await this.sqlite3.step(stmt) === SQLITE_ROW) {
        const row: any = {}
        for (let i = 0; i < columns.length; i++) {
          row[columns[i]] = this.sqlite3.column(stmt, i)
        }
        results.push(row)
      }
    }
    return results
  }
}

class WaSqliteDatabase implements PlatformDatabase {
  private sqlite3: any
  private db: number

  constructor(sqlite3: any, db: number) {
    this.sqlite3 = sqlite3
    this.db = db
  }

  async exec(sql: string): Promise<void> {
    await this.sqlite3.exec(this.db, sql)
  }

  prepare(sql: string): PlatformStatement {
    return new WaSqliteStatement(this.sqlite3, this.db, sql)
  }

  async close(): Promise<void> {
    await this.sqlite3.close(this.db)
  }
}

export const waSqliteAdapter: PlatformSqlite = {
  async open(name: string): Promise<PlatformDatabase> {
    const module = await SQLiteESMFactory()
    const sqlite3 = Factory(module)
    const vfs = await IDBBatchAtomicVFS.create(name, module)
    sqlite3.vfs_register(vfs, true)

    const db = await sqlite3.open_v2(name)
    await sqlite3.exec(db, 'PRAGMA journal_mode = WAL')
    await sqlite3.exec(db, 'PRAGMA synchronous = NORMAL')
    await sqlite3.exec(db, 'PRAGMA foreign_keys = OFF')

    return new WaSqliteDatabase(sqlite3, db)
  },
}
