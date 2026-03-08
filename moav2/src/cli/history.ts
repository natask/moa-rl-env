/**
 * History command implementations.
 *
 * Pure functions that take a HistoryDbReader and options, returning formatted strings.
 * No direct stdout writes — the CLI entry point handles I/O.
 */

import { HistoryDbReader, type CliSession, type CliMessage, type SearchResult } from './db-reader'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return d.toISOString().slice(11, 16)
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen) + '...'
}

// ---------------------------------------------------------------------------
// List Sessions
// ---------------------------------------------------------------------------

export interface ListOptions {
  limit?: number
  json?: boolean
}

export async function formatSessionList(reader: HistoryDbReader, opts: ListOptions): Promise<string> {
  const sessions = await reader.listSessions(opts.limit)

  if (opts.json) {
    return JSON.stringify(sessions, null, 2)
  }

  if (sessions.length === 0) {
    return 'No sessions found.'
  }

  const lines = sessions.map((s: CliSession) => {
    const created = formatTimestamp(s.createdAt)
    const updated = formatTimestamp(s.updatedAt)
    return `  [${s.id}] "${s.title}"\n  Model: ${s.model}    Created: ${created}    Updated: ${updated}`
  })

  return `${sessions.length} session(s):\n\n${lines.join('\n\n')}`
}

// ---------------------------------------------------------------------------
// View Session
// ---------------------------------------------------------------------------

export interface ViewOptions {
  limit?: number
  role?: string
  json?: boolean
}

export async function formatSessionView(reader: HistoryDbReader, sessionId: string, opts: ViewOptions): Promise<string> {
  const session = await reader.getSession(sessionId)
  if (!session) {
    return `Session not found: ${sessionId}`
  }

  const messages = await reader.getMessages(sessionId, {
    role: opts.role,
    limit: opts.limit,
  })

  if (opts.json) {
    return JSON.stringify({ session, messages }, null, 2)
  }

  if (messages.length === 0) {
    return `Session: "${session.title}" (${session.id})\nModel: ${session.model}\nCreated: ${formatTimestamp(session.createdAt)}\n\nNo messages in this session.`
  }

  const header = `Session: "${session.title}" (${session.id})\nModel: ${session.model}\nCreated: ${formatTimestamp(session.createdAt)}\n\n--- Messages (${messages.length}) ---`

  const msgLines = messages.map((m: CliMessage) => {
    const time = formatTime(m.createdAt)
    return `\n[${time}] ${m.role}:\n  ${truncate(m.content, 500)}`
  })

  return header + msgLines.join('\n')
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchCommandOptions {
  limit?: number
  sessionId?: string
  json?: boolean
}

export async function formatSearchResults(reader: HistoryDbReader, query: string, opts: SearchCommandOptions): Promise<string> {
  const results = await reader.searchMessages(query, {
    sessionId: opts.sessionId,
    limit: opts.limit,
  })

  if (opts.json) {
    return JSON.stringify(results, null, 2)
  }

  if (results.length === 0) {
    return `No matches found for "${query}".`
  }

  const lines = results.map((r: SearchResult) => {
    const time = formatTime(r.createdAt)
    return `  [${r.sessionId}] "${r.sessionTitle}" | [${time}] ${r.role}:\n    ${truncate(r.content, 300)}`
  })

  return `Search results for "${query}" (${results.length} match${results.length === 1 ? '' : 'es'}):\n\n${lines.join('\n\n')}`
}
