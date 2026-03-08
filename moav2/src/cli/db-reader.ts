/**
 * HistoryDbReader — SQLite-backed reader for MOA chat history.
 *
 * Uses Node's built-in SQLite (`node:sqlite`) through an async API.
 * This is a read-only tool for CLI access; the Electron app writes to this database.
 *
 * The reader also provides insert methods for testing purposes.
 */

type StatementLike = {
  all(...params: any[]): any[]
  get(...params: any[]): any
  run(...params: any[]): any
}

type DbLike = {
  exec(sql: string): void
  pragma?(sql: string): void
  prepare(sql: string): StatementLike
  close(): void
}

async function openDatabase(dbPath: string): Promise<DbLike> {
  try {
    const nodeSqlite = await import('node:sqlite')
    const db = new nodeSqlite.DatabaseSync(dbPath)
    return {
      exec(sql: string) {
        db.exec(sql)
      },
      pragma(sql: string) {
        db.exec(`PRAGMA ${sql}`)
      },
      prepare(sql: string) {
        return db.prepare(sql)
      },
      close() {
        db.close()
      },
    }
  } catch (err: any) {
    throw new Error(`Could not initialize SQLite for ${dbPath}: ${err?.message ?? String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CliSession {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
}

export interface CliMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  blocks?: string      // JSON-serialized MessageBlock[]
  partial: number      // 0 or 1
  createdAt: number
}

export interface SearchResult extends CliMessage {
  sessionTitle: string
}

export interface GetMessagesOptions {
  role?: string
  limit?: number
}

export interface SearchOptions {
  sessionId?: string
  limit?: number
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  blocks TEXT,
  partial INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_sessionId ON messages(sessionId);
CREATE INDEX IF NOT EXISTS idx_messages_createdAt ON messages(createdAt);
CREATE INDEX IF NOT EXISTS idx_sessions_updatedAt ON sessions(updatedAt);
`

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export class HistoryDbReader {
  private db: DbLike

  private constructor(db: DbLike) {
    this.db = db
  }

  static async create(dbPath: string): Promise<HistoryDbReader> {
    const db = await openDatabase(dbPath)
    const reader = new HistoryDbReader(db)
    reader.init()
    return reader
  }

  private init(): void {
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = OFF')
    this.db.exec(SCHEMA_SQL)
  }

  async close(): Promise<void> {
    this.db.close()
  }

  // --- Query methods ---

  async listSessions(limit?: number): Promise<CliSession[]> {
    let sql = 'SELECT * FROM sessions ORDER BY updatedAt DESC'
    if (limit !== undefined && limit > 0) {
      sql += ` LIMIT ${limit}`
    }
    return this.db.prepare(sql).all() as CliSession[]
  }

  async getSession(id: string): Promise<CliSession | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as CliSession | undefined
    return row ?? null
  }

  async getMessages(sessionId: string, opts?: GetMessagesOptions): Promise<CliMessage[]> {
    const conditions = ['sessionId = ?', 'partial = 0']
    const params: any[] = [sessionId]

    if (opts?.role) {
      conditions.push('role = ?')
      params.push(opts.role)
    }

    let sql = `SELECT * FROM messages WHERE ${conditions.join(' AND ')} ORDER BY createdAt ASC`

    if (opts?.limit !== undefined && opts.limit > 0) {
      // To get the LAST N messages, we use a subquery
      sql = `SELECT * FROM (
        SELECT * FROM messages WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC LIMIT ${opts.limit}
      ) sub ORDER BY createdAt ASC`
    }

    return this.db.prepare(sql).all(...params) as CliMessage[]
  }

  async searchMessages(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    if (!query.trim()) return []

    const conditions = ['m.partial = 0', 'm.content LIKE ?']
    const params: any[] = [`%${query}%`]

    if (opts?.sessionId) {
      conditions.push('m.sessionId = ?')
      params.push(opts.sessionId)
    }

    const limit = opts?.limit ?? 20

    const sql = `
      SELECT m.*, s.title as sessionTitle
      FROM messages m
      JOIN sessions s ON s.id = m.sessionId
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.createdAt DESC
      LIMIT ${limit}
    `

    return this.db.prepare(sql).all(...params) as SearchResult[]
  }

  // --- Insert methods (for testing) ---

  async insertSession(session: CliSession): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO sessions (id, title, model, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)'
    ).run(session.id, session.title, session.model, session.createdAt, session.updatedAt)
  }

  async insertMessage(message: CliMessage): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO messages (id, sessionId, role, content, blocks, partial, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      message.id,
      message.sessionId,
      message.role,
      message.content,
      message.blocks ?? null,
      message.partial,
      message.createdAt
    )
  }
}

// ---------------------------------------------------------------------------
// Default database path resolution
// ---------------------------------------------------------------------------

export function getDefaultDbPath(): string {
  const os = require('os')
  const path = require('path')

  // Check environment variable override
  if (process.env.MOA_DB_PATH) {
    return process.env.MOA_DB_PATH
  }

  return path.join(os.homedir(), '.moa', 'chat-history.db')
}
