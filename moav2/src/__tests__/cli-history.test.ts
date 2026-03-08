/**
 * CLI History tests — TDD tests for the terminal chat history CLI tool.
 *
 * Tests the database reader, command formatting (list, view, search),
 * and edge cases (empty DB, missing sessions, partial messages, JSON output).
 *
 * Uses the configured SQLite adapter in in-memory mode for fast, real-fidelity testing.
 */

// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  HistoryDbReader,
  type CliSession,
  type CliMessage,
} from '../cli/db-reader'
import {
  formatSessionList,
  formatSessionView,
  formatSearchResults,
} from '../cli/history'

// ---------------------------------------------------------------------------
// Helper: seed test data into a HistoryDbReader's underlying database
// ---------------------------------------------------------------------------

async function createTestReader(): Promise<HistoryDbReader> {
  return await HistoryDbReader.create(':memory:')
}

async function seedSessions(reader: HistoryDbReader, count: number): Promise<CliSession[]> {
  const sessions: CliSession[] = []
  for (let i = 0; i < count; i++) {
    const session: CliSession = {
      id: `session-${i + 1}`,
      title: `Chat ${i + 1}`,
      model: `claude-3-${i % 2 === 0 ? 'opus' : 'sonnet'}`,
      createdAt: 1700000000000 + i * 3600000,
      updatedAt: 1700000000000 + i * 3600000 + 1800000,
    }
    await reader.insertSession(session)
    sessions.push(session)
  }
  return sessions
}

async function seedMessages(
  reader: HistoryDbReader,
  sessionId: string,
  messages: Array<{ role: string; content: string; partial?: boolean }>
): Promise<CliMessage[]> {
  const result: CliMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg: CliMessage = {
      id: `msg-${sessionId}-${i + 1}`,
      sessionId,
      role: messages[i].role as 'user' | 'assistant' | 'system',
      content: messages[i].content,
      partial: messages[i].partial ? 1 : 0,
      createdAt: 1700000000000 + i * 60000,
    }
    await reader.insertMessage(msg)
    result.push(msg)
  }
  return result
}

// ---------------------------------------------------------------------------
// Database Reader Tests
// ---------------------------------------------------------------------------

describe('HistoryDbReader', () => {
  let reader: HistoryDbReader

  beforeEach(async () => {
    reader = await createTestReader()
  })

  afterEach(async () => {
    await reader.close()
  })

  it('creates tables on initialization', async () => {
    // If we can list sessions without error, tables exist
    const sessions = await reader.listSessions()
    expect(sessions).toEqual([])
  })

  it('lists sessions sorted by updatedAt descending', async () => {
    await seedSessions(reader, 3)
    const sessions = await reader.listSessions()
    expect(sessions).toHaveLength(3)
    // Most recently updated first
    expect(sessions[0].id).toBe('session-3')
    expect(sessions[1].id).toBe('session-2')
    expect(sessions[2].id).toBe('session-1')
  })

  it('lists sessions with limit', async () => {
    await seedSessions(reader, 5)
    const sessions = await reader.listSessions(2)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].id).toBe('session-5')
    expect(sessions[1].id).toBe('session-4')
  })

  it('gets a session by ID', async () => {
    await seedSessions(reader, 2)
    const session = await reader.getSession('session-1')
    expect(session).toBeDefined()
    expect(session!.title).toBe('Chat 1')
    expect(session!.model).toBe('claude-3-opus')
  })

  it('returns null for non-existent session', async () => {
    const session = await reader.getSession('nonexistent')
    expect(session).toBeNull()
  })

  it('gets messages for a session sorted by createdAt ascending', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ])

    const messages = await reader.getMessages('session-1')
    expect(messages).toHaveLength(3)
    expect(messages[0].content).toBe('Hello')
    expect(messages[1].content).toBe('Hi there!')
    expect(messages[2].content).toBe('How are you?')
  })

  it('filters out partial messages', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Partial response...', partial: true },
      { role: 'assistant', content: 'Complete response' },
    ])

    const messages = await reader.getMessages('session-1')
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('Hello')
    expect(messages[1].content).toBe('Complete response')
  })

  it('filters messages by role', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
    ])

    const userMsgs = await reader.getMessages('session-1', { role: 'user' })
    expect(userMsgs).toHaveLength(2)
    expect(userMsgs.every(m => m.role === 'user')).toBe(true)
  })

  it('limits messages', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Msg 1' },
      { role: 'assistant', content: 'Msg 2' },
      { role: 'user', content: 'Msg 3' },
      { role: 'assistant', content: 'Msg 4' },
      { role: 'user', content: 'Msg 5' },
    ])

    const messages = await reader.getMessages('session-1', { limit: 2 })
    // Limit takes the last N messages
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('Msg 4')
    expect(messages[1].content).toBe('Msg 5')
  })

  it('returns empty array for messages of non-existent session', async () => {
    const messages = await reader.getMessages('nonexistent')
    expect(messages).toEqual([])
  })

  it('searches messages case-insensitively', async () => {
    await seedSessions(reader, 2)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Fix the LOGIN bug' },
      { role: 'assistant', content: 'I will check the login handler' },
    ])
    await seedMessages(reader, 'session-2', [
      { role: 'user', content: 'Refactor the auth module' },
    ])

    const results = await reader.searchMessages('login')
    expect(results).toHaveLength(2)
    // Results are ordered by createdAt DESC, so the assistant message (later timestamp) comes first
    const contents = results.map(r => r.content)
    expect(contents.some(c => c.includes('LOGIN'))).toBe(true)
    expect(contents.some(c => c.includes('login handler'))).toBe(true)
  })

  it('searches messages with session filter', async () => {
    await seedSessions(reader, 2)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Fix the login bug' },
    ])
    await seedMessages(reader, 'session-2', [
      { role: 'user', content: 'The login page is broken' },
    ])

    const results = await reader.searchMessages('login', { sessionId: 'session-1' })
    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe('session-1')
  })

  it('searches messages with limit', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'the first message' },
      { role: 'assistant', content: 'the second message' },
      { role: 'user', content: 'the third message' },
    ])

    const results = await reader.searchMessages('the', { limit: 2 })
    expect(results).toHaveLength(2)
  })

  it('returns empty for search with no matches', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Hello world' },
    ])

    const results = await reader.searchMessages('xyznonexistent')
    expect(results).toEqual([])
  })

  it('excludes partial messages from search results', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'assistant', content: 'partial match here', partial: true },
      { role: 'assistant', content: 'complete match here' },
    ])

    const results = await reader.searchMessages('match')
    expect(results).toHaveLength(1)
    expect(results[0].content).toBe('complete match here')
  })
})

// ---------------------------------------------------------------------------
// History Formatting Tests
// ---------------------------------------------------------------------------

describe('formatSessionList', () => {
  let reader: HistoryDbReader

  beforeEach(async () => {
    reader = await createTestReader()
  })

  afterEach(async () => {
    await reader.close()
  })

  it('returns formatted list of sessions', async () => {
    await seedSessions(reader, 3)
    const output = await formatSessionList(reader, {})
    expect(output).toContain('3 session(s)')
    expect(output).toContain('session-1')
    expect(output).toContain('session-2')
    expect(output).toContain('session-3')
    expect(output).toContain('Chat 1')
    expect(output).toContain('Chat 2')
    expect(output).toContain('Chat 3')
    expect(output).toContain('claude-3-opus')
  })

  it('returns "No sessions found." for empty database', async () => {
    const output = await formatSessionList(reader, {})
    expect(output).toBe('No sessions found.')
  })

  it('respects limit option', async () => {
    await seedSessions(reader, 5)
    const output = await formatSessionList(reader, { limit: 2 })
    expect(output).toContain('2 session(s)')
    // Should contain the 2 most recent, not the oldest
    expect(output).toContain('session-5')
    expect(output).toContain('session-4')
    expect(output).not.toContain('session-1')
  })

  it('outputs JSON when json flag is set', async () => {
    await seedSessions(reader, 2)
    const output = await formatSessionList(reader, { json: true })
    const parsed = JSON.parse(output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toHaveProperty('id')
    expect(parsed[0]).toHaveProperty('title')
    expect(parsed[0]).toHaveProperty('model')
  })

  it('outputs empty JSON array for empty database with json flag', async () => {
    const output = await formatSessionList(reader, { json: true })
    const parsed = JSON.parse(output)
    expect(parsed).toEqual([])
  })
})

describe('formatSessionView', () => {
  let reader: HistoryDbReader

  beforeEach(async () => {
    reader = await createTestReader()
  })

  afterEach(async () => {
    await reader.close()
  })

  it('returns formatted messages for a session', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Hi! How can I help?' },
    ])

    const output = await formatSessionView(reader, 'session-1', {})
    expect(output).toContain('Chat 1')
    expect(output).toContain('session-1')
    expect(output).toContain('user')
    expect(output).toContain('Hello there')
    expect(output).toContain('assistant')
    expect(output).toContain('Hi! How can I help?')
  })

  it('returns error for non-existent session', async () => {
    const output = await formatSessionView(reader, 'nonexistent', {})
    expect(output).toContain('Session not found: nonexistent')
  })

  it('filters messages by role', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Question 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Question 2' },
    ])

    const output = await formatSessionView(reader, 'session-1', { role: 'user' })
    expect(output).toContain('Question 1')
    expect(output).toContain('Question 2')
    expect(output).not.toContain('Answer 1')
  })

  it('excludes partial messages', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Partial...', partial: true },
      { role: 'assistant', content: 'Complete response' },
    ])

    const output = await formatSessionView(reader, 'session-1', {})
    expect(output).toContain('Hello')
    expect(output).toContain('Complete response')
    expect(output).not.toContain('Partial...')
  })

  it('handles session with no messages', async () => {
    await seedSessions(reader, 1)
    const output = await formatSessionView(reader, 'session-1', {})
    expect(output).toContain('No messages')
  })

  it('outputs JSON when json flag is set', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ])

    const output = await formatSessionView(reader, 'session-1', { json: true })
    const parsed = JSON.parse(output)
    expect(parsed).toHaveProperty('session')
    expect(parsed).toHaveProperty('messages')
    expect(parsed.messages).toHaveLength(2)
  })

  it('respects limit option', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Msg 1' },
      { role: 'assistant', content: 'Msg 2' },
      { role: 'user', content: 'Msg 3' },
      { role: 'assistant', content: 'Msg 4' },
    ])

    const output = await formatSessionView(reader, 'session-1', { limit: 2 })
    // Should show last 2 messages
    expect(output).toContain('Msg 3')
    expect(output).toContain('Msg 4')
    expect(output).not.toContain('Msg 1')
  })
})

describe('formatSearchResults', () => {
  let reader: HistoryDbReader

  beforeEach(async () => {
    reader = await createTestReader()
  })

  afterEach(async () => {
    await reader.close()
  })

  it('returns formatted search results', async () => {
    await seedSessions(reader, 2)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Fix the login bug' },
    ])
    await seedMessages(reader, 'session-2', [
      { role: 'user', content: 'The login page needs work' },
    ])

    const output = await formatSearchResults(reader, 'login', {})
    expect(output).toContain('login')
    expect(output).toContain('2 match')
    expect(output).toContain('Chat 1')
    expect(output).toContain('Chat 2')
  })

  it('returns no matches message for empty results', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'Hello' },
    ])

    const output = await formatSearchResults(reader, 'xyznonexistent', {})
    expect(output).toContain('No matches found for "xyznonexistent"')
  })

  it('filters by session', async () => {
    await seedSessions(reader, 2)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'login issue' },
    ])
    await seedMessages(reader, 'session-2', [
      { role: 'user', content: 'login page' },
    ])

    const output = await formatSearchResults(reader, 'login', { sessionId: 'session-1' })
    expect(output).toContain('1 match')
    expect(output).toContain('Chat 1')
    expect(output).not.toContain('Chat 2')
  })

  it('respects limit option', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'the first' },
      { role: 'assistant', content: 'the second' },
      { role: 'user', content: 'the third' },
    ])

    const output = await formatSearchResults(reader, 'the', { limit: 2 })
    expect(output).toContain('2 match')
  })

  it('outputs JSON when json flag is set', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'fix the bug' },
    ])

    const output = await formatSearchResults(reader, 'bug', { json: true })
    const parsed = JSON.parse(output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toHaveProperty('sessionId')
    expect(parsed[0]).toHaveProperty('sessionTitle')
    expect(parsed[0]).toHaveProperty('content')
  })

  it('returns empty JSON array for no matches with json flag', async () => {
    const output = await formatSearchResults(reader, 'nothing', { json: true })
    const parsed = JSON.parse(output)
    expect(parsed).toEqual([])
  })

  it('handles special characters in search query', async () => {
    await seedSessions(reader, 1)
    await seedMessages(reader, 'session-1', [
      { role: 'user', content: 'What about O\'Brien?' },
    ])

    // Should not throw an error
    const output = await formatSearchResults(reader, "O'Brien", {})
    expect(output).toContain('1 match')
  })
})
