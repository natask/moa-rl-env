/**
 * EventStore tests.
 *
 * wa-sqlite uses WASM which does not load in jsdom/vitest, so we test EventStore
 * by providing a mock PlatformDatabase that implements the same async interface.
 * This verifies EventStore's logic (append, query, search, materialize, count,
 * replay) without requiring an actual WASM SQLite binary.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setPlatform } from '../core/platform'
import type { Platform, PlatformDatabase, PlatformStatement, PlatformSqlite } from '../core/platform/types'
import { EventStore } from '../core/services/event-store'

// ---------------------------------------------------------------------------
// In-memory SQL-ish database mock that mimics PlatformDatabase
// ---------------------------------------------------------------------------

interface Row {
  rowid: number
  id: string
  type: string
  payload: string
  actor: string
  session_id: string | null
  causation_id: string | null
  correlation_id: string | null
  timestamp: number
}

class InMemoryDB implements PlatformDatabase {
  private rows: Row[] = []
  private nextRowId = 1

  async exec(_sql: string): Promise<void> {
    // Schema creation — no-op for in-memory store
  }

  prepare(sql: string): PlatformStatement {
    const self = this
    const trimmed = sql.trim()

    return {
      async run(...params: any[]): Promise<any> {
        if (trimmed.toUpperCase().startsWith('INSERT')) {
          const row: Row = {
            rowid: self.nextRowId++,
            id: params[0],
            type: params[1],
            payload: params[2],
            actor: params[3],
            session_id: params[4],
            causation_id: params[5],
            correlation_id: params[6],
            timestamp: params[7],
          }
          self.rows.push(row)
          return { changes: 1 }
        }
        return { changes: 0 }
      },

      async get(...params: any[]): Promise<any> {
        const rows = await this.all(...params)
        return rows.length > 0 ? rows[0] : undefined
      },

      async all(...params: any[]): Promise<any[]> {
        return self.executeQuery(trimmed, params)
      },
    }
  }

  async close(): Promise<void> {}

  /**
   * Simple query engine supporting the SQL patterns EventStore generates.
   */
  private executeQuery(sql: string, params: any[]): any[] {
    const upper = sql.toUpperCase()

    // SELECT COUNT(*) as cnt FROM events ...
    if (upper.includes('SELECT COUNT(*)')) {
      const filtered = this.applyFilters(upper, params)
      return [{ cnt: filtered.length }]
    }

    // SELECT DISTINCT type FROM events ORDER BY type
    if (upper.includes('SELECT DISTINCT TYPE FROM')) {
      const types = [...new Set(this.rows.map(r => r.type))].sort()
      return types.map(t => ({ type: t }))
    }

    // SELECT DISTINCT session_id FROM events WHERE session_id IS NOT NULL
    if (upper.includes('SELECT DISTINCT SESSION_ID FROM')) {
      const sessions = [...new Set(
        this.rows.filter(r => r.session_id != null).map(r => r.session_id)
      )].sort()
      return sessions.map(s => ({ session_id: s }))
    }

    // SELECT * FROM events WHERE id = ?
    if (upper.includes('WHERE ID = ?')) {
      const row = this.rows.find(r => r.id === params[0])
      return row ? [row] : []
    }

    // FTS search: SELECT e.* FROM events e INNER JOIN events_fts ...
    if (upper.includes('EVENTS_FTS MATCH')) {
      return this.executeFtsSearch(upper, params)
    }

    // Generic SELECT with WHERE / ORDER BY / LIMIT / OFFSET
    return this.executeGenericSelect(upper, params)
  }

  private executeFtsSearch(upper: string, params: any[]): any[] {
    const query = (params[0] as string).toLowerCase()
    let filtered = this.rows.filter(r =>
      r.type.toLowerCase().includes(query) ||
      r.payload.toLowerCase().includes(query)
    )

    if (upper.includes('E.SESSION_ID = ?')) {
      filtered = filtered.filter(r => r.session_id === params[1])
      const limit = params[2] ?? 50
      return filtered.slice(0, limit)
    }

    const limit = params[1] ?? 50
    return filtered.slice(0, limit)
  }

  private executeGenericSelect(upper: string, params: any[]): any[] {
    let filtered = this.applyFilters(upper, params)
    let paramIdx = this.countWhereParams(upper)

    // ORDER BY
    if (upper.includes('ORDER BY TIMESTAMP ASC')) {
      filtered.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
    } else if (upper.includes('ORDER BY TIMESTAMP DESC')) {
      filtered.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))
    }

    // LIMIT ? OFFSET ?
    if (upper.includes('LIMIT ?')) {
      const limit = params[paramIdx++]
      const offset = upper.includes('OFFSET ?') ? params[paramIdx++] : 0
      filtered = filtered.slice(offset, offset + limit)
    } else {
      // LIMIT with literal number (e.g., LIMIT 1 in getLatest)
      const limitMatch = upper.match(/LIMIT\s+(\d+)/)
      if (limitMatch) {
        filtered = filtered.slice(0, parseInt(limitMatch[1]))
      }
    }

    return filtered
  }

  /**
   * Apply WHERE clause filters. Returns filtered rows.
   * Params are consumed in the order EventStore generates them:
   * type, session_id, actor, timestamp>=, timestamp<=
   */
  private applyFilters(upper: string, params: any[]): Row[] {
    let filtered = [...this.rows]
    if (!upper.includes('WHERE')) return filtered

    let paramIdx = 0

    // type LIKE ? or type = ?
    if (upper.includes('TYPE LIKE ?')) {
      const pattern = params[paramIdx++] as string
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$')
      filtered = filtered.filter(r => regex.test(r.type))
    } else if (upper.includes('TYPE = ?')) {
      const typeVal = params[paramIdx++]
      filtered = filtered.filter(r => r.type === typeVal)
    }

    // session_id = ?
    if (upper.includes('SESSION_ID = ?')) {
      const sidVal = params[paramIdx++]
      filtered = filtered.filter(r => r.session_id === sidVal)
    }

    // actor = ?
    if (upper.includes('ACTOR = ?')) {
      const actorVal = params[paramIdx++]
      filtered = filtered.filter(r => r.actor === actorVal)
    }

    // timestamp >= ?
    if (upper.includes('TIMESTAMP >= ?')) {
      const since = params[paramIdx++]
      filtered = filtered.filter(r => r.timestamp >= since)
    }

    // timestamp <= ?
    if (upper.includes('TIMESTAMP <= ?')) {
      const until = params[paramIdx++]
      filtered = filtered.filter(r => r.timestamp <= until)
    }

    return filtered
  }

  private countWhereParams(upper: string): number {
    if (!upper.includes('WHERE')) return 0
    let count = 0
    if (upper.includes('TYPE LIKE ?') || upper.includes('TYPE = ?')) count++
    if (upper.includes('SESSION_ID = ?')) count++
    if (upper.includes('ACTOR = ?')) count++
    if (upper.includes('TIMESTAMP >= ?')) count++
    if (upper.includes('TIMESTAMP <= ?')) count++
    return count
  }
}

// ---------------------------------------------------------------------------
// Mock platform with in-memory SQLite replacement
// ---------------------------------------------------------------------------

function createMockPlatform(): Platform {
  const dbInstances = new Map<string, InMemoryDB>()

  const mockSqlite: PlatformSqlite = {
    async open(name: string): Promise<PlatformDatabase> {
      if (!dbInstances.has(name)) {
        dbInstances.set(name, new InMemoryDB())
      }
      return dbInstances.get(name)!
    }
  }

  return {
    fs: {
      readFile: async () => '',
      readFileSync: () => '',
      writeFile: async () => {},
      writeFileSync: () => {},
      existsSync: () => false,
      mkdirSync: () => {},
      readdirSync: () => [],
      statSync: () => ({ isFile: () => false, isDirectory: () => false, size: 0 }),
      unlinkSync: () => {},
    },
    path: {
      join: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
      dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '/',
      resolve: (...parts: string[]) => parts.join('/'),
      basename: (p: string) => p.split('/').pop() || '',
      extname: (p: string) => { const m = p.match(/\.[^.]+$/); return m ? m[0] : '' },
      sep: '/',
    },
    process: {
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      execSync: () => '',
      cwd: () => '/',
      env: {},
      homedir: () => '/',
    },
    sqlite: mockSqlite,
    shell: { openExternal: () => {} },
    type: 'browser',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventStore (with in-memory mock DB)', () => {
  let store: EventStore

  beforeEach(async () => {
    const platform = createMockPlatform()
    setPlatform(platform)
    store = await EventStore.create()
  })

  it('appends and retrieves an event', async () => {
    const evt = await store.append({
      type: 'message.sent',
      payload: { text: 'hello world' },
      actor: 'user',
      sessionId: 'test-session',
    })

    expect(evt.id).toBeTruthy()
    expect(evt.timestamp).toBeGreaterThan(0)
    expect(evt.type).toBe('message.sent')
    expect(evt.payload.text).toBe('hello world')

    const retrieved = await store.getById(evt.id)
    expect(retrieved).toBeDefined()
    expect(retrieved!.payload.text).toBe('hello world')
    expect(retrieved!.actor).toBe('user')
    expect(retrieved!.sessionId).toBe('test-session')
  })

  it('queries by type with glob pattern', async () => {
    await store.append({ type: 'message.sent', payload: { text: 'a' }, actor: 'user' })
    await store.append({ type: 'file.read', payload: { path: '/x' }, actor: 'agent' })
    await store.append({ type: 'message.received', payload: { text: 'b' }, actor: 'agent' })

    const messages = await store.query({ type: 'message.*' })
    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(messages.every(m => m.type.startsWith('message.'))).toBe(true)
  })

  it('queries by exact type', async () => {
    await store.append({ type: 'message.sent', payload: { text: 'a' }, actor: 'user' })
    await store.append({ type: 'file.read', payload: { path: '/x' }, actor: 'agent' })

    const fileEvents = await store.query({ type: 'file.read' })
    expect(fileEvents.length).toBe(1)
    expect(fileEvents[0].type).toBe('file.read')
  })

  it('queries by session', async () => {
    await store.append({ type: 'test.event', payload: {}, actor: 'user', sessionId: 'session-a' })
    await store.append({ type: 'test.event', payload: {}, actor: 'user', sessionId: 'session-b' })
    await store.append({ type: 'test.event', payload: {}, actor: 'user', sessionId: 'session-a' })

    const result = await store.query({ sessionId: 'session-a' })
    expect(result.length).toBe(2)
    expect(result.every(e => e.sessionId === 'session-a')).toBe(true)
  })

  it('queries by actor', async () => {
    await store.append({ type: 'x', payload: {}, actor: 'user' })
    await store.append({ type: 'x', payload: {}, actor: 'agent' })
    await store.append({ type: 'x', payload: {}, actor: 'user' })

    const result = await store.query({ actor: 'user' })
    expect(result.length).toBe(2)
    expect(result.every(e => e.actor === 'user')).toBe(true)
  })

  it('full-text search works', async () => {
    await store.append({ type: 'note', payload: { text: 'quantum computing is fascinating' }, actor: 'user' })
    await store.append({ type: 'note', payload: { text: 'classical computing' }, actor: 'user' })

    const results = await store.search('quantum')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(r => r.payload.text.includes('quantum'))).toBe(true)
  })

  it('search returns empty for empty query', async () => {
    await store.append({ type: 'note', payload: { text: 'something' }, actor: 'user' })
    const results = await store.search('  ')
    expect(results.length).toBe(0)
  })

  it('materializes a session', async () => {
    const sid = 'mat-session'
    await store.append({ type: 'message.sent', payload: { text: 'hi' }, actor: 'user', sessionId: sid })
    await store.append({ type: 'file.read', payload: { path: '/x' }, actor: 'agent', sessionId: sid })
    await store.append({ type: 'intent.created', payload: { goal: 'test' }, actor: 'user', sessionId: sid })
    await store.append({ type: 'command.executed', payload: { cmd: 'ls' }, actor: 'agent', sessionId: sid })
    await store.append({ type: 'session.created', payload: {}, actor: 'system', sessionId: sid })
    await store.append({ type: 'unknown.event', payload: {}, actor: 'system', sessionId: sid })

    const mat = await store.materialize(sid)
    expect(mat.messages.length).toBeGreaterThanOrEqual(1)
    expect(mat.fileOps.length).toBeGreaterThanOrEqual(1)
    expect(mat.intents.length).toBeGreaterThanOrEqual(1)
    expect(mat.commands.length).toBeGreaterThanOrEqual(1)
    expect(mat.sessions.length).toBeGreaterThanOrEqual(1)
    expect(mat.other.length).toBeGreaterThanOrEqual(1)
  })

  it('materialize returns empty categories for non-existent session', async () => {
    const mat = await store.materialize('nonexistent')
    expect(mat.messages.length).toBe(0)
    expect(mat.fileOps.length).toBe(0)
    expect(mat.intents.length).toBe(0)
  })

  it('counts events (no filter)', async () => {
    const initial = await store.count()
    await store.append({ type: 'count.test', payload: {}, actor: 'system' })
    expect(await store.count()).toBe(initial + 1)
  })

  it('counts events with type filter', async () => {
    await store.append({ type: 'alpha', payload: {}, actor: 'user' })
    await store.append({ type: 'beta', payload: {}, actor: 'user' })
    await store.append({ type: 'alpha', payload: {}, actor: 'user' })

    expect(await store.count('alpha')).toBe(2)
    expect(await store.count('beta')).toBe(1)
  })

  it('counts events with session filter', async () => {
    await store.append({ type: 'x', payload: {}, actor: 'user', sessionId: 'count-s1' })
    await store.append({ type: 'x', payload: {}, actor: 'user', sessionId: 'count-s2' })
    await store.append({ type: 'x', payload: {}, actor: 'user', sessionId: 'count-s1' })

    expect(await store.count(undefined, 'count-s1')).toBe(2)
    expect(await store.count(undefined, 'count-s2')).toBe(1)
  })

  it('replays with a reducer', async () => {
    const sid = 'replay-session'
    await store.append({ type: 'counter.inc', payload: { n: 1 }, actor: 'user', sessionId: sid })
    await store.append({ type: 'counter.inc', payload: { n: 2 }, actor: 'user', sessionId: sid })
    await store.append({ type: 'counter.inc', payload: { n: 3 }, actor: 'user', sessionId: sid })

    const total = await store.replay(
      (sum, evt) => sum + (evt.payload.n || 0),
      0,
      { sessionId: sid, type: 'counter.inc' }
    )
    expect(total).toBe(6)
  })

  it('replay with no matching events returns initial state', async () => {
    const result = await store.replay(
      (sum, _evt) => sum + 1,
      42,
      { sessionId: 'nonexistent', type: 'nope' }
    )
    expect(result).toBe(42)
  })

  it('appendBatch inserts multiple events', async () => {
    const events = await store.appendBatch([
      { type: 'batch.a', payload: { i: 1 }, actor: 'user' },
      { type: 'batch.b', payload: { i: 2 }, actor: 'user' },
      { type: 'batch.c', payload: { i: 3 }, actor: 'user' },
    ])
    expect(events.length).toBe(3)
    expect(events[0].type).toBe('batch.a')
    expect(events[2].type).toBe('batch.c')

    expect(await store.count('batch.*')).toBe(3)
  })

  it('getLatest returns the most recent event of a type', async () => {
    await store.append({ type: 'latest.test', payload: { v: 1 }, actor: 'user' })
    // Small delay to ensure distinct timestamps
    await new Promise(r => setTimeout(r, 5))
    await store.append({ type: 'latest.test', payload: { v: 2 }, actor: 'user' })

    const latest = await store.getLatest('latest.test')
    expect(latest).toBeDefined()
    expect(latest!.payload.v).toBe(2)
  })

  it('getLatest returns null when no events match', async () => {
    const latest = await store.getLatest('nonexistent.type')
    expect(latest).toBeNull()
  })

  it('types() returns all distinct event types', async () => {
    await store.append({ type: 'alpha', payload: {}, actor: 'user' })
    await store.append({ type: 'beta', payload: {}, actor: 'user' })
    await store.append({ type: 'alpha', payload: {}, actor: 'user' })

    const types = await store.types()
    expect(types).toContain('alpha')
    expect(types).toContain('beta')
    expect(types.length).toBe(2)
  })

  it('sessions() returns all distinct session IDs', async () => {
    await store.append({ type: 'x', payload: {}, actor: 'user', sessionId: 'sess-1' })
    await store.append({ type: 'x', payload: {}, actor: 'user', sessionId: 'sess-2' })
    await store.append({ type: 'x', payload: {}, actor: 'user' }) // no session

    const sessions = await store.sessions()
    expect(sessions).toContain('sess-1')
    expect(sessions).toContain('sess-2')
    expect(sessions.length).toBe(2)
  })

  it('close() does not throw', async () => {
    await expect(store.close()).resolves.not.toThrow()
  })
})
