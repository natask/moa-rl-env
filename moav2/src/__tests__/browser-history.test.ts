/**
 * Browser History Persistence tests.
 *
 * Verifies that the DatabaseManager (IndexedDB-based) correctly persists
 * sessions and messages across re-initialization, which simulates a browser
 * page reload. Uses fake-indexeddb to provide IndexedDB in the jsdom test env.
 *
 * Tests cover:
 * - Database initialization
 * - Session CRUD (create, read, list, update, delete)
 * - Message persistence (add, retrieve by session, update, delete)
 * - Session list ordering (most recently updated first)
 * - Message ordering (chronological)
 * - Session deletion cascading to messages
 * - Empty database handling
 * - Data survives re-initialization (simulated page reload)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { DatabaseManager } from '../core/services/db'

// ---------------------------------------------------------------------------
// Helper: small delay to ensure distinct timestamps
// ---------------------------------------------------------------------------
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Helper: create a fresh DatabaseManager instance (simulates page reload)
// ---------------------------------------------------------------------------
async function createFreshDb(): Promise<DatabaseManager> {
  const mgr = new DatabaseManager()
  await mgr.init()
  return mgr
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Browser History Persistence (DatabaseManager)', () => {
  let db: DatabaseManager

  beforeEach(async () => {
    // Reset IndexedDB completely for test isolation
    globalThis.indexedDB = new IDBFactory()
    db = await createFreshDb()
  })

  // =========================================================================
  // Database Initialization
  // =========================================================================

  describe('Database Initialization', () => {
    it('initializes without errors', async () => {
      const mgr = new DatabaseManager()
      await expect(mgr.init()).resolves.not.toThrow()
    })

    it('can be initialized multiple times on the same database (idempotent)', async () => {
      const mgr1 = await createFreshDb()
      const mgr2 = await createFreshDb()
      // Both should work independently on the same underlying DB
      const s1 = await mgr1.createSession('model-a')
      const s2 = await mgr2.createSession('model-b')
      expect(s1.id).toBeTruthy()
      expect(s2.id).toBeTruthy()
    })
  })

  // =========================================================================
  // Session CRUD
  // =========================================================================

  describe('Session CRUD', () => {
    it('creates a session with correct fields', async () => {
      const session = await db.createSession('claude-3.5-sonnet')
      expect(session.id).toBeTruthy()
      expect(session.title).toBe('New Chat')
      expect(session.model).toBe('claude-3.5-sonnet')
      expect(session.createdAt).toBeGreaterThan(0)
      expect(session.updatedAt).toBeGreaterThan(0)
      expect(session.createdAt).toBe(session.updatedAt)
    })

    it('retrieves a session by ID', async () => {
      const created = await db.createSession('model-a')
      const retrieved = await db.getSession(created.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.title).toBe('New Chat')
      expect(retrieved!.model).toBe('model-a')
    })

    it('returns null for non-existent session', async () => {
      const result = await db.getSession('non-existent-id')
      expect(result).toBeNull()
    })

    it('lists all sessions', async () => {
      await db.createSession('model-a')
      await delay(10)
      await db.createSession('model-b')
      await delay(10)
      await db.createSession('model-c')

      const sessions = await db.listSessions()
      expect(sessions.length).toBe(3)
    })

    it('lists sessions sorted by sortOrder ascending (creation date)', async () => {
      const s1 = await db.createSession('model-a')
      await delay(15)
      const s2 = await db.createSession('model-b')
      await delay(15)
      const s3 = await db.createSession('model-c')

      const sessions = await db.listSessions()
      expect(sessions.length).toBe(3)
      // Sorted by sortOrder ascending (oldest first by default)
      expect(sessions[0].id).toBe(s1.id)
      expect(sessions[1].id).toBe(s2.id)
      expect(sessions[2].id).toBe(s3.id)
    })

    it('updates session title', async () => {
      const session = await db.createSession('model-a')
      await delay(10)
      const updated = await db.updateSession(session.id, { title: 'My Conversation' })
      expect(updated).not.toBeNull()
      expect(updated!.title).toBe('My Conversation')
      expect(updated!.updatedAt).toBeGreaterThan(session.updatedAt)
    })

    it('updates session model', async () => {
      const session = await db.createSession('model-a')
      await delay(10)
      const updated = await db.updateSession(session.id, { model: 'model-b' })
      expect(updated).not.toBeNull()
      expect(updated!.model).toBe('model-b')
    })

    it('updateSession returns null for non-existent session', async () => {
      const result = await db.updateSession('non-existent', { title: 'Nope' })
      expect(result).toBeNull()
    })

    it('removes a session', async () => {
      const session = await db.createSession('model-a')
      await db.removeSession(session.id)
      const result = await db.getSession(session.id)
      expect(result).toBeNull()
    })

    it('session ordering is stable after update (sortOrder-based)', async () => {
      const s1 = await db.createSession('model-a')
      await delay(15)
      const s2 = await db.createSession('model-b')
      await delay(15)

      // s1 created first, so it should be first (sortOrder ascending)
      let sessions = await db.listSessions()
      expect(sessions[0].id).toBe(s1.id)

      // Updating s1 title does NOT change sortOrder — order remains stable
      await delay(15)
      await db.updateSession(s1.id, { title: 'Updated' })

      sessions = await db.listSessions()
      expect(sessions[0].id).toBe(s1.id)
      expect(sessions[1].id).toBe(s2.id)
    })
  })

  // =========================================================================
  // Message Persistence
  // =========================================================================

  describe('Message Persistence', () => {
    let sessionId: string

    beforeEach(async () => {
      const session = await db.createSession('test-model')
      sessionId = session.id
    })

    it('adds a message with correct fields', async () => {
      const msg = await db.addMessage(sessionId, 'user', 'Hello world')
      expect(msg.id).toBeTruthy()
      expect(msg.sessionId).toBe(sessionId)
      expect(msg.role).toBe('user')
      expect(msg.content).toBe('Hello world')
      expect(msg.createdAt).toBeGreaterThan(0)
    })

    it('retrieves messages by session ID', async () => {
      await db.addMessage(sessionId, 'user', 'First message')
      await delay(5)
      await db.addMessage(sessionId, 'assistant', 'Second message')

      const messages = await db.getMessages(sessionId)
      expect(messages.length).toBe(2)
      expect(messages[0].content).toBe('First message')
      expect(messages[1].content).toBe('Second message')
    })

    it('messages are ordered chronologically (createdAt ascending)', async () => {
      await db.addMessage(sessionId, 'user', 'First')
      await delay(10)
      await db.addMessage(sessionId, 'assistant', 'Second')
      await delay(10)
      await db.addMessage(sessionId, 'user', 'Third')

      const messages = await db.getMessages(sessionId)
      expect(messages.length).toBe(3)
      expect(messages[0].content).toBe('First')
      expect(messages[1].content).toBe('Second')
      expect(messages[2].content).toBe('Third')
      // Verify ordering
      expect(messages[0].createdAt).toBeLessThanOrEqual(messages[1].createdAt)
      expect(messages[1].createdAt).toBeLessThanOrEqual(messages[2].createdAt)
    })

    it('messages are scoped to their session', async () => {
      const session2 = await db.createSession('model-b')
      await db.addMessage(sessionId, 'user', 'Session 1 message')
      await db.addMessage(session2.id, 'user', 'Session 2 message')

      const msgs1 = await db.getMessages(sessionId)
      const msgs2 = await db.getMessages(session2.id)

      expect(msgs1.length).toBe(1)
      expect(msgs1[0].content).toBe('Session 1 message')
      expect(msgs2.length).toBe(1)
      expect(msgs2[0].content).toBe('Session 2 message')
    })

    it('addMessage updates session updatedAt', async () => {
      const sessionBefore = await db.getSession(sessionId)
      await delay(15)
      await db.addMessage(sessionId, 'user', 'New message')
      const sessionAfter = await db.getSession(sessionId)

      expect(sessionAfter).not.toBeNull()
      expect(sessionAfter!.updatedAt).toBeGreaterThan(sessionBefore!.updatedAt)
    })

    it('adds message with blocks', async () => {
      const blocks = [
        { id: 'b1', type: 'text' as const, content: 'Hello' },
        { id: 'b2', type: 'tool' as const, toolName: 'bash', status: 'completed' as const },
      ]
      const msg = await db.addMessage(sessionId, 'assistant', 'text', { blocks })
      expect(msg.blocks).toBeDefined()
      expect(msg.blocks!.length).toBe(2)
      expect(msg.blocks![0].content).toBe('Hello')
      expect(msg.blocks![1].toolName).toBe('bash')
    })

    it('adds message with partial flag', async () => {
      const msg = await db.addMessage(sessionId, 'assistant', '', { partial: true })
      expect(msg.partial).toBe(true)
    })

    it('adds message with custom ID', async () => {
      const customId = 'custom-msg-id-123'
      const msg = await db.addMessage(sessionId, 'user', 'With custom ID', { id: customId })
      expect(msg.id).toBe(customId)
    })

    it('updates message content', async () => {
      const msg = await db.addMessage(sessionId, 'assistant', 'Initial')
      await db.updateMessage(msg.id, { content: 'Updated content' })

      const messages = await db.getMessages(sessionId)
      expect(messages[0].content).toBe('Updated content')
    })

    it('updates message partial flag', async () => {
      const msg = await db.addMessage(sessionId, 'assistant', '', { partial: true })
      await db.updateMessage(msg.id, { partial: false })

      const messages = await db.getMessages(sessionId)
      // partial should be explicitly false
      expect(messages[0].partial).toBe(false)
    })

    it('removes a message', async () => {
      const msg = await db.addMessage(sessionId, 'user', 'To be deleted')
      expect((await db.getMessages(sessionId)).length).toBe(1)

      await db.removeMessage(msg.id)
      expect((await db.getMessages(sessionId)).length).toBe(0)
    })
  })

  // =========================================================================
  // Session Deletion Cascade
  // =========================================================================

  describe('Session Deletion Cascade', () => {
    it('deleting a session also deletes its messages', async () => {
      const session = await db.createSession('model-a')
      await db.addMessage(session.id, 'user', 'Message 1')
      await db.addMessage(session.id, 'assistant', 'Message 2')
      await db.addMessage(session.id, 'user', 'Message 3')

      // Verify messages exist
      expect((await db.getMessages(session.id)).length).toBe(3)

      // Delete session
      await db.removeSession(session.id)

      // Session should be gone
      expect(await db.getSession(session.id)).toBeNull()

      // Messages should also be gone
      expect((await db.getMessages(session.id)).length).toBe(0)
    })

    it('deleting a session does not affect other sessions messages', async () => {
      const s1 = await db.createSession('model-a')
      const s2 = await db.createSession('model-b')
      await db.addMessage(s1.id, 'user', 'S1 message')
      await db.addMessage(s2.id, 'user', 'S2 message')

      // Delete s1
      await db.removeSession(s1.id)

      // s2 messages should be intact
      const s2Messages = await db.getMessages(s2.id)
      expect(s2Messages.length).toBe(1)
      expect(s2Messages[0].content).toBe('S2 message')
    })
  })

  // =========================================================================
  // Empty Database Handling
  // =========================================================================

  describe('Empty Database Handling', () => {
    it('listSessions returns empty array when no sessions exist', async () => {
      const sessions = await db.listSessions()
      expect(sessions).toEqual([])
    })

    it('getMessages returns empty array for non-existent session', async () => {
      const messages = await db.getMessages('non-existent-session-id')
      expect(messages).toEqual([])
    })

    it('getMessages returns empty array for session with no messages', async () => {
      const session = await db.createSession('model-a')
      const messages = await db.getMessages(session.id)
      expect(messages).toEqual([])
    })
  })

  // =========================================================================
  // Data Survives Re-initialization (Simulated Page Reload)
  // =========================================================================

  describe('Persistence Across Re-initialization', () => {
    it('sessions survive re-initialization', async () => {
      const session = await db.createSession('model-a')
      await db.updateSession(session.id, { title: 'Persistent Chat' })

      // Simulate page reload: create a new DatabaseManager on the same IndexedDB
      const db2 = await createFreshDb()

      const sessions = await db2.listSessions()
      expect(sessions.length).toBe(1)
      expect(sessions[0].id).toBe(session.id)
      expect(sessions[0].title).toBe('Persistent Chat')
      expect(sessions[0].model).toBe('model-a')
    })

    it('messages survive re-initialization', async () => {
      const session = await db.createSession('model-a')
      await db.addMessage(session.id, 'user', 'Hello!')
      await delay(5)
      await db.addMessage(session.id, 'assistant', 'Hi there!')

      // Simulate page reload
      const db2 = await createFreshDb()

      const messages = await db2.getMessages(session.id)
      expect(messages.length).toBe(2)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('Hello!')
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].content).toBe('Hi there!')
    })

    it('multiple sessions and messages survive re-initialization', async () => {
      const s1 = await db.createSession('model-a')
      const s2 = await db.createSession('model-b')
      await db.addMessage(s1.id, 'user', 'S1 msg 1')
      await db.addMessage(s1.id, 'assistant', 'S1 msg 2')
      await db.addMessage(s2.id, 'user', 'S2 msg 1')

      // Simulate page reload
      const db2 = await createFreshDb()

      const sessions = await db2.listSessions()
      expect(sessions.length).toBe(2)

      const s1msgs = await db2.getMessages(s1.id)
      const s2msgs = await db2.getMessages(s2.id)
      expect(s1msgs.length).toBe(2)
      expect(s2msgs.length).toBe(1)
    })

    it('message blocks survive re-initialization', async () => {
      const session = await db.createSession('model-a')
      const blocks = [
        { id: 'blk-1', type: 'text' as const, content: 'Markdown content here' },
        { id: 'blk-2', type: 'tool' as const, toolName: 'read', args: { path: '/a.txt' }, status: 'completed' as const, result: 'file contents' },
      ]
      await db.addMessage(session.id, 'assistant', 'text', { blocks })

      // Simulate page reload
      const db2 = await createFreshDb()

      const messages = await db2.getMessages(session.id)
      expect(messages.length).toBe(1)
      expect(messages[0].blocks).toBeDefined()
      expect(messages[0].blocks!.length).toBe(2)
      expect(messages[0].blocks![0].content).toBe('Markdown content here')
      expect(messages[0].blocks![1].toolName).toBe('read')
      expect(messages[0].blocks![1].result).toBe('file contents')
    })

    it('session ordering is preserved after re-initialization', async () => {
      const s1 = await db.createSession('model-a')
      await delay(15)
      const s2 = await db.createSession('model-b')
      await delay(15)
      const s3 = await db.createSession('model-c')

      // Simulate page reload
      const db2 = await createFreshDb()

      const sessions = await db2.listSessions()
      // Sorted by sortOrder ascending (oldest first)
      expect(sessions[0].id).toBe(s1.id)
      expect(sessions[1].id).toBe(s2.id)
      expect(sessions[2].id).toBe(s3.id)
    })

    it('deleted sessions stay deleted after re-initialization', async () => {
      const s1 = await db.createSession('model-a')
      const s2 = await db.createSession('model-b')
      await db.addMessage(s1.id, 'user', 'msg')
      await db.removeSession(s1.id)

      // Simulate page reload
      const db2 = await createFreshDb()

      const sessions = await db2.listSessions()
      expect(sessions.length).toBe(1)
      expect(sessions[0].id).toBe(s2.id)

      // s1 messages should also be gone
      const s1msgs = await db2.getMessages(s1.id)
      expect(s1msgs.length).toBe(0)
    })
  })

  // =========================================================================
  // Provider Operations (Basic Verification)
  // =========================================================================

  describe('Provider Operations', () => {
    it('adds and lists providers', async () => {
      const provider = await db.addProvider('TestProvider', 'https://api.test.com', 'test-key-123')
      expect(provider.id).toBeTruthy()
      expect(provider.name).toBe('TestProvider')
      expect(provider.baseUrl).toBe('https://api.test.com')

      const providers = await db.listProviders()
      expect(providers.length).toBe(1)
      expect(providers[0].name).toBe('TestProvider')
    })

    it('removes trailing slash from baseUrl', async () => {
      const provider = await db.addProvider('Test', 'https://api.test.com///', 'key')
      expect(provider.baseUrl).toBe('https://api.test.com')
    })

    it('providers survive re-initialization', async () => {
      await db.addProvider('Persistent', 'https://api.persist.com', 'key')

      const db2 = await createFreshDb()
      const providers = await db2.listProviders()
      expect(providers.length).toBe(1)
      expect(providers[0].name).toBe('Persistent')
    })
  })

  // =========================================================================
  // OAuth Credentials (Basic Verification)
  // =========================================================================

  describe('OAuth Credentials', () => {
    it('stores and retrieves OAuth credentials', async () => {
      await db.setOAuthCredentials('anthropic', {
        refresh: 'refresh-token',
        access: 'access-token',
        expires: Date.now() + 3600000,
      })

      const creds = await db.getOAuthCredentials('anthropic')
      expect(creds).not.toBeNull()
      expect(creds!.refresh).toBe('refresh-token')
      expect(creds!.access).toBe('access-token')
    })

    it('removes OAuth credentials', async () => {
      await db.setOAuthCredentials('anthropic', {
        refresh: 'r', access: 'a', expires: 0,
      })
      await db.removeOAuthCredentials('anthropic')
      const creds = await db.getOAuthCredentials('anthropic')
      expect(creds).toBeNull()
    })

    it('OAuth credentials survive re-initialization', async () => {
      await db.setOAuthCredentials('google', {
        refresh: 'g-refresh', access: 'g-access', expires: 9999999,
      })

      const db2 = await createFreshDb()
      const creds = await db2.getOAuthCredentials('google')
      expect(creds).not.toBeNull()
      expect(creds!.refresh).toBe('g-refresh')
    })
  })

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('Edge Cases', () => {
    it('handles many sessions', async () => {
      const count = 20
      for (let i = 0; i < count; i++) {
        await db.createSession(`model-${i}`)
      }
      const sessions = await db.listSessions()
      expect(sessions.length).toBe(count)
    })

    it('handles many messages in one session', async () => {
      const session = await db.createSession('model-a')
      const count = 50
      for (let i = 0; i < count; i++) {
        await db.addMessage(session.id, i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`)
      }
      const messages = await db.getMessages(session.id)
      expect(messages.length).toBe(count)
      // Verify chronological ordering
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].createdAt).toBeGreaterThanOrEqual(messages[i - 1].createdAt)
      }
    })

    it('handles empty string content in messages', async () => {
      const session = await db.createSession('model-a')
      const msg = await db.addMessage(session.id, 'assistant', '')
      expect(msg.content).toBe('')

      const messages = await db.getMessages(session.id)
      expect(messages[0].content).toBe('')
    })

    it('handles special characters in session title', async () => {
      const session = await db.createSession('model-a')
      await db.updateSession(session.id, { title: 'Session with "quotes" & <tags> and unicode: \u{1F680}' })

      const retrieved = await db.getSession(session.id)
      expect(retrieved!.title).toBe('Session with "quotes" & <tags> and unicode: \u{1F680}')
    })

    it('handles special characters in message content', async () => {
      const session = await db.createSession('model-a')
      const content = '```javascript\nconsole.log("hello")\n```\n\nUnicode: \u{1F600} \nHTML: <div class="test">&amp;</div>'
      await db.addMessage(session.id, 'user', content)

      const messages = await db.getMessages(session.id)
      expect(messages[0].content).toBe(content)
    })
  })
})
