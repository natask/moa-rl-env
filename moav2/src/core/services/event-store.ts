// Event Store — foundational history primitive for MOA v2
// Uses PlatformDatabase (async) accessed via getPlatform().sqlite
// Architecture: append-only event log with FTS5 search and left-fold projections

import { getPlatform } from '../platform'
import type { PlatformDatabase } from '../platform/types'

// ---------------------------------------------------------------------------
// Types (unchanged from moa v1)
// ---------------------------------------------------------------------------

export interface MoaEvent {
  id: string                     // Sortable timestamp-based ID (base36 ts + random)
  type: string                   // e.g. 'message.sent', 'file.read', 'session.created'
  payload: Record<string, any>   // Event-specific data (stored as JSON)
  actor: string                  // 'user' | 'agent' | 'system'
  sessionId?: string             // Optional session context
  causationId?: string           // What event/command caused this
  correlationId?: string         // Root transaction/session ID
  timestamp: number              // Date.now() at append time
}

export type NewEvent = Omit<MoaEvent, 'id' | 'timestamp'>

export interface QueryOpts {
  type?: string        // Filter by event type. Supports glob: 'message.*'
  sessionId?: string   // Filter by session
  actor?: string       // Filter by actor
  since?: number       // Timestamp lower bound (inclusive)
  until?: number       // Timestamp upper bound (inclusive)
  limit?: number       // Max results, default 100
  offset?: number      // Pagination offset, default 0
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deserialize a row from the events table into a MoaEvent */
function rowToEvent(row: any): MoaEvent {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload),
    actor: row.actor,
    sessionId: row.session_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    correlationId: row.correlation_id ?? undefined,
    timestamp: row.timestamp,
  }
}

// ---------------------------------------------------------------------------
// EventStore
// ---------------------------------------------------------------------------

export class EventStore {
  private db: PlatformDatabase

  private constructor(db: PlatformDatabase) {
    this.db = db
  }

  /** Async factory — creates and initializes the event store */
  static async create(): Promise<EventStore> {
    const { sqlite } = getPlatform()
    const db = await sqlite.open('moa-events.db')
    const store = new EventStore(db)
    await store.init()
    return store
  }

  // -------------------------------------------------------------------------
  // Schema initialisation (async — all db ops return Promises)
  // -------------------------------------------------------------------------

  private async init(): Promise<void> {
    // Core events table — append-only, no UPDATE / DELETE in normal operation
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id               TEXT PRIMARY KEY,
        type             TEXT NOT NULL,
        payload          TEXT NOT NULL,
        actor            TEXT NOT NULL,
        session_id       TEXT,
        causation_id     TEXT,
        correlation_id   TEXT,
        timestamp        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_session    ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_actor      ON events(actor);
      CREATE INDEX IF NOT EXISTS idx_events_corr       ON events(correlation_id);
    `)

    // FTS5 virtual table for full-text search over type + payload text
    // content= keeps FTS in sync via triggers (external content table pattern)
    await this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        type,
        payload,
        content=events,
        content_rowid=rowid
      );
    `)

    // Triggers to keep the FTS index in sync with the events table.
    // We wrap each in a try because CREATE TRIGGER IF NOT EXISTS is not
    // universally supported — the exec will throw if the trigger already exists.
    const triggers = [
      `CREATE TRIGGER events_ai AFTER INSERT ON events BEGIN
        INSERT INTO events_fts(rowid, type, payload)
        VALUES (new.rowid, new.type, new.payload);
      END;`,
      `CREATE TRIGGER events_ad AFTER DELETE ON events BEGIN
        INSERT INTO events_fts(events_fts, rowid, type, payload)
        VALUES ('delete', old.rowid, old.type, old.payload);
      END;`,
      `CREATE TRIGGER events_au AFTER UPDATE ON events BEGIN
        INSERT INTO events_fts(events_fts, rowid, type, payload)
        VALUES ('delete', old.rowid, old.type, old.payload);
        INSERT INTO events_fts(rowid, type, payload)
        VALUES (new.rowid, new.type, new.payload);
      END;`,
    ]

    for (const sql of triggers) {
      try {
        await this.db.exec(sql)
      } catch (_) {
        // Trigger already exists — safe to ignore
      }
    }
  }

  // -------------------------------------------------------------------------
  // ID generation — lexicographically sortable by time
  // -------------------------------------------------------------------------

  private generateId(): string {
    // 9-char base36 timestamp gives us sortability through ~2060
    const ts = Date.now().toString(36).padStart(9, '0')
    // 8-char random suffix for uniqueness within the same millisecond
    const rand = Math.random().toString(36).substring(2, 10)
    return `${ts}-${rand}`
  }

  // -------------------------------------------------------------------------
  // Write side — append only (async)
  // -------------------------------------------------------------------------

  /** Append a new event to the log. Returns the complete event with id and timestamp. */
  async append(event: NewEvent): Promise<MoaEvent> {
    const id = this.generateId()
    const timestamp = Date.now()
    const payloadJson = JSON.stringify(event.payload)

    const stmt = this.db.prepare(`
      INSERT INTO events (id, type, payload, actor, session_id, causation_id, correlation_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    await stmt.run(
      id,
      event.type,
      payloadJson,
      event.actor,
      event.sessionId ?? null,
      event.causationId ?? null,
      event.correlationId ?? null,
      timestamp,
    )

    return {
      id,
      type: event.type,
      payload: event.payload,
      actor: event.actor,
      sessionId: event.sessionId,
      causationId: event.causationId,
      correlationId: event.correlationId,
      timestamp,
    }
  }

  /** Append multiple events sequentially. Browser SQLite may not support transactions the same way. */
  async appendBatch(events: NewEvent[]): Promise<MoaEvent[]> {
    const results: MoaEvent[] = []
    for (const evt of events) {
      results.push(await this.append(evt))
    }
    return results
  }

  // -------------------------------------------------------------------------
  // Read side — queries (async)
  // -------------------------------------------------------------------------

  /** Query events with flexible filters. Returns events sorted by timestamp ASC. */
  async query(opts: QueryOpts = {}): Promise<MoaEvent[]> {
    const clauses: string[] = []
    const params: any[] = []

    if (opts.type) {
      if (opts.type.includes('*')) {
        // Glob pattern: 'message.*' -> LIKE 'message.%'
        clauses.push('type LIKE ?')
        params.push(opts.type.replace(/\*/g, '%'))
      } else {
        clauses.push('type = ?')
        params.push(opts.type)
      }
    }

    if (opts.sessionId) {
      clauses.push('session_id = ?')
      params.push(opts.sessionId)
    }

    if (opts.actor) {
      clauses.push('actor = ?')
      params.push(opts.actor)
    }

    if (opts.since != null) {
      clauses.push('timestamp >= ?')
      params.push(opts.since)
    }

    if (opts.until != null) {
      clauses.push('timestamp <= ?')
      params.push(opts.until)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = opts.limit ?? 100
    const offset = opts.offset ?? 0

    const sql = `
      SELECT * FROM events
      ${where}
      ORDER BY timestamp ASC, id ASC
      LIMIT ? OFFSET ?
    `
    params.push(limit, offset)

    const rows = await this.db.prepare(sql).all(...params)
    return rows.map(rowToEvent)
  }

  /** Full-text search over event type and payload JSON text. */
  async search(query: string, opts?: { limit?: number; sessionId?: string }): Promise<MoaEvent[]> {
    const limit = opts?.limit ?? 50
    const sessionFilter = opts?.sessionId

    // FTS5 MATCH requires the query to be non-empty
    if (!query.trim()) return []

    let sql: string
    const params: any[] = []

    if (sessionFilter) {
      sql = `
        SELECT e.* FROM events e
        INNER JOIN events_fts f ON e.rowid = f.rowid
        WHERE events_fts MATCH ? AND e.session_id = ?
        ORDER BY rank
        LIMIT ?
      `
      params.push(query, sessionFilter, limit)
    } else {
      sql = `
        SELECT e.* FROM events e
        INNER JOIN events_fts f ON e.rowid = f.rowid
        WHERE events_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `
      params.push(query, limit)
    }

    try {
      const rows = await this.db.prepare(sql).all(...params)
      return rows.map(rowToEvent)
    } catch (_) {
      // FTS query syntax errors should not crash the app
      console.warn('[EventStore] FTS search failed for query:', query)
      return []
    }
  }

  // -------------------------------------------------------------------------
  // Projections (Read Models) — async
  // -------------------------------------------------------------------------

  /**
   * Left-fold all events for a session into a materialized read model.
   * Returns a categorized snapshot of the session's current state.
   */
  async materialize(sessionId: string): Promise<{
    messages: MoaEvent[]
    intents: MoaEvent[]
    fileOps: MoaEvent[]
    commands: MoaEvent[]
    sessions: MoaEvent[]
    other: MoaEvent[]
  }> {
    const events = await this.query({ sessionId, limit: 10_000 })

    const result = {
      messages: [] as MoaEvent[],
      intents: [] as MoaEvent[],
      fileOps: [] as MoaEvent[],
      commands: [] as MoaEvent[],
      sessions: [] as MoaEvent[],
      other: [] as MoaEvent[],
    }

    for (const evt of events) {
      if (evt.type.startsWith('message.')) {
        result.messages.push(evt)
      } else if (evt.type.startsWith('intent.')) {
        result.intents.push(evt)
      } else if (evt.type.startsWith('file.')) {
        result.fileOps.push(evt)
      } else if (evt.type.startsWith('command.')) {
        result.commands.push(evt)
      } else if (evt.type.startsWith('session.')) {
        result.sessions.push(evt)
      } else {
        result.other.push(evt)
      }
    }

    return result
  }

  /** Get the most recent event of a given type, optionally within a session. */
  async getLatest(type: string, sessionId?: string): Promise<MoaEvent | null> {
    const clauses = ['type = ?']
    const params: any[] = [type]

    if (sessionId) {
      clauses.push('session_id = ?')
      params.push(sessionId)
    }

    const sql = `
      SELECT * FROM events
      WHERE ${clauses.join(' AND ')}
      ORDER BY timestamp DESC, id DESC
      LIMIT 1
    `

    const row = await this.db.prepare(sql).get(...params)
    return row ? rowToEvent(row) : null
  }

  /** Get a single event by its ID. */
  async getById(id: string): Promise<MoaEvent | null> {
    const row = await this.db.prepare('SELECT * FROM events WHERE id = ?').get(id)
    return row ? rowToEvent(row) : null
  }

  /** Count events, optionally filtered by type and/or session. */
  async count(type?: string, sessionId?: string): Promise<number> {
    const clauses: string[] = []
    const params: any[] = []

    if (type) {
      if (type.includes('*')) {
        clauses.push('type LIKE ?')
        params.push(type.replace(/\*/g, '%'))
      } else {
        clauses.push('type = ?')
        params.push(type)
      }
    }

    if (sessionId) {
      clauses.push('session_id = ?')
      params.push(sessionId)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const sql = `SELECT COUNT(*) as cnt FROM events ${where}`

    const row = await this.db.prepare(sql).get(...params) as { cnt: number }
    return row.cnt
  }

  // -------------------------------------------------------------------------
  // Utility (async)
  // -------------------------------------------------------------------------

  /** Get all distinct event types in the store. */
  async types(): Promise<string[]> {
    const rows = await this.db.prepare('SELECT DISTINCT type FROM events ORDER BY type').all()
    return rows.map((r: any) => r.type)
  }

  /** Get all distinct session IDs. */
  async sessions(): Promise<string[]> {
    const rows = await this.db
      .prepare('SELECT DISTINCT session_id FROM events WHERE session_id IS NOT NULL ORDER BY session_id')
      .all()
    return rows.map((r: any) => r.session_id)
  }

  /**
   * Replay events through a reducer function.
   * This is the generic left-fold — callers supply the fold logic.
   */
  async replay<T>(
    reducer: (state: T, event: MoaEvent) => T,
    initialState: T,
    opts?: QueryOpts,
  ): Promise<T> {
    const events = await this.query({ ...opts, limit: opts?.limit ?? 100_000 })
    let state = initialState
    for (const evt of events) {
      state = reducer(state, evt)
    }
    return state
  }

  /** Close the database connection. Call on app shutdown. */
  async close(): Promise<void> {
    try {
      await this.db.close()
    } catch (_) {
      // Already closed or never opened
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton — async initialization
// ---------------------------------------------------------------------------

let _eventStore: EventStore | null = null

export async function getEventStore(): Promise<EventStore> {
  if (!_eventStore) {
    _eventStore = await EventStore.create()
  }
  return _eventStore
}
