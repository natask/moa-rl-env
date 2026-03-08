export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  createdAt: number
}

export interface StoredOAuthCredentials {
  provider: string   // keyPath — e.g. 'anthropic'
  refresh: string
  access: string
  expires: number
  accountId?: string
}

export interface Session {
  id: string
  title: string
  model: string
  systemPrompt?: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  sortOrder: number
}

export interface TerminalTab {
  id: string
  title: string
  createdAt: number
  pinned: boolean
  sortOrder: number
}

export interface BrowserTab {
  id: string
  title: string
  url: string
  createdAt: number
  pinned: boolean
  sortOrder: number
}

export interface MessageBlock {
  id: string
  type: 'text' | 'tool'
  content?: string
  toolCallId?: string
  toolName?: string
  args?: Record<string, any>
  status?: 'running' | 'completed' | 'error'
  result?: string
}

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  blocks?: MessageBlock[]
  partial?: boolean
  createdAt: number
}

/** Sort tabs: pinned first (by sortOrder), then unpinned (by sortOrder) */
function sortTabs<T extends { pinned: boolean; sortOrder: number }>(tabs: T[]): T[] {
  return tabs.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return a.sortOrder - b.sortOrder
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('moa', 3)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const oldVersion = event.oldVersion

      if (oldVersion < 1) {
        const providers = db.createObjectStore('providers', { keyPath: 'id' })
        providers.createIndex('name', 'name', { unique: false })

        const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
        sessions.createIndex('updatedAt', 'updatedAt', { unique: false })

        const messages = db.createObjectStore('messages', { keyPath: 'id' })
        messages.createIndex('sessionId', 'sessionId', { unique: false })
        messages.createIndex('createdAt', 'createdAt', { unique: false })

        const events = db.createObjectStore('events', { keyPath: 'id' })
        events.createIndex('type', 'type', { unique: false })
      }

      if (oldVersion < 2) {
        db.createObjectStore('oauth-credentials', { keyPath: 'provider' })
      }

      if (oldVersion < 3) {
        // Add terminal-tabs and browser-tabs stores
        db.createObjectStore('terminal-tabs', { keyPath: 'id' })
        db.createObjectStore('browser-tabs', { keyPath: 'id' })
        // Existing sessions will get pinned/sortOrder defaults on read
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Backfill pinned/sortOrder for sessions migrated from v2 */
function backfillSession(s: Session): Session {
  if (s.pinned === undefined) s.pinned = false
  if (s.sortOrder === undefined) s.sortOrder = s.createdAt
  return s
}

export class DatabaseManager {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    this.db = await openDatabase()
  }

  private getStore(name: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized')
    return this.db.transaction(name, mode).objectStore(name)
  }

  // === Provider operations ===

  async addProvider(name: string, baseUrl: string, apiKey: string): Promise<Provider> {
    const provider: Provider = {
      id: crypto.randomUUID(),
      name,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey,
      createdAt: Date.now(),
    }
    await req(this.getStore('providers', 'readwrite').put(provider))
    return provider
  }

  async getProvider(id: string): Promise<Provider | null> {
    const result = await req(this.getStore('providers').get(id))
    return result || null
  }

  async listProviders(): Promise<Provider[]> {
    const all = await req(this.getStore('providers').getAll())
    return all.sort((a: Provider, b: Provider) => a.createdAt - b.createdAt)
  }

  async updateProvider(id: string, updates: Partial<Pick<Provider, 'name' | 'baseUrl' | 'apiKey'>>): Promise<Provider | null> {
    const store = this.getStore('providers', 'readwrite')
    const provider = await req(store.get(id)) as Provider | undefined
    if (!provider) return null
    if (updates.name !== undefined) provider.name = updates.name
    if (updates.baseUrl !== undefined) provider.baseUrl = updates.baseUrl.replace(/\/+$/, '')
    if (updates.apiKey !== undefined) provider.apiKey = updates.apiKey
    await req(store.put(provider))
    return provider
  }

  async removeProvider(id: string): Promise<boolean> {
    try {
      await req(this.getStore('providers', 'readwrite').delete(id))
      return true
    } catch {
      return false
    }
  }

  // === OAuth credential operations ===

  async getOAuthCredentials(provider: string): Promise<StoredOAuthCredentials | null> {
    const result = await req(this.getStore('oauth-credentials').get(provider))
    return result || null
  }

  async setOAuthCredentials(provider: string, creds: { refresh: string; access: string; expires: number; accountId?: string }): Promise<void> {
    const record: StoredOAuthCredentials = { provider, ...creds }
    await req(this.getStore('oauth-credentials', 'readwrite').put(record))
  }

  async removeOAuthCredentials(provider: string): Promise<void> {
    await req(this.getStore('oauth-credentials', 'readwrite').delete(provider))
  }

  // === Session operations ===

  async createSession(model: string): Promise<Session> {
    const now = Date.now()
    const session: Session = {
      id: crypto.randomUUID(),
      title: 'New Chat',
      model,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      sortOrder: now,
    }
    await req(this.getStore('sessions', 'readwrite').put(session))
    return session
  }

  async getSession(id: string): Promise<Session | null> {
    const result = await req(this.getStore('sessions').get(id))
    return result ? backfillSession(result) : null
  }

  async listSessions(): Promise<Session[]> {
    const all = await req(this.getStore('sessions').getAll())
    return sortTabs(all.map(backfillSession))
  }

  async updateSession(id: string, updates: Partial<Pick<Session, 'title' | 'model' | 'systemPrompt' | 'pinned' | 'sortOrder'>>): Promise<Session | null> {
    const store = this.getStore('sessions', 'readwrite')
    const session = await req(store.get(id)) as Session | undefined
    if (!session) return null
    backfillSession(session)
    if (updates.title !== undefined) session.title = updates.title
    if (updates.model !== undefined) session.model = updates.model
    if (updates.systemPrompt !== undefined) session.systemPrompt = updates.systemPrompt
    if (updates.pinned !== undefined) session.pinned = updates.pinned
    if (updates.sortOrder !== undefined) session.sortOrder = updates.sortOrder
    session.updatedAt = Date.now()
    await req(store.put(session))
    return session
  }

  async removeSession(id: string): Promise<void> {
    const messages = await this.getMessages(id)
    const msgStore = this.getStore('messages', 'readwrite')
    for (const m of messages) {
      await req(msgStore.delete(m.id))
    }
    await req(this.getStore('sessions', 'readwrite').delete(id))
  }

  // === Terminal Tab operations ===

  async createTerminalTab(title?: string): Promise<TerminalTab> {
    const now = Date.now()
    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      title: title || 'New Thread',
      createdAt: now,
      pinned: false,
      sortOrder: now,
    }
    await req(this.getStore('terminal-tabs', 'readwrite').put(tab))
    return tab
  }

  async listTerminalTabs(): Promise<TerminalTab[]> {
    const all = await req(this.getStore('terminal-tabs').getAll())
    return sortTabs(all)
  }

  async updateTerminalTab(id: string, updates: Partial<Pick<TerminalTab, 'title' | 'pinned' | 'sortOrder'>>): Promise<TerminalTab | null> {
    const store = this.getStore('terminal-tabs', 'readwrite')
    const tab = await req(store.get(id)) as TerminalTab | undefined
    if (!tab) return null
    if (updates.title !== undefined) tab.title = updates.title
    if (updates.pinned !== undefined) tab.pinned = updates.pinned
    if (updates.sortOrder !== undefined) tab.sortOrder = updates.sortOrder
    await req(store.put(tab))
    return tab
  }

  async removeTerminalTab(id: string): Promise<void> {
    await req(this.getStore('terminal-tabs', 'readwrite').delete(id))
  }

  // === Browser Tab operations ===

  async createBrowserTab(title?: string, url?: string): Promise<BrowserTab> {
    const now = Date.now()
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      title: title || 'Browser',
      url: url || '',
      createdAt: now,
      pinned: false,
      sortOrder: now,
    }
    await req(this.getStore('browser-tabs', 'readwrite').put(tab))
    return tab
  }

  async listBrowserTabs(): Promise<BrowserTab[]> {
    const all = await req(this.getStore('browser-tabs').getAll())
    return sortTabs(all)
  }

  async updateBrowserTab(id: string, updates: Partial<Pick<BrowserTab, 'title' | 'url' | 'pinned' | 'sortOrder'>>): Promise<BrowserTab | null> {
    const store = this.getStore('browser-tabs', 'readwrite')
    const tab = await req(store.get(id)) as BrowserTab | undefined
    if (!tab) return null
    if (updates.title !== undefined) tab.title = updates.title
    if (updates.url !== undefined) tab.url = updates.url
    if (updates.pinned !== undefined) tab.pinned = updates.pinned
    if (updates.sortOrder !== undefined) tab.sortOrder = updates.sortOrder
    await req(store.put(tab))
    return tab
  }

  async removeBrowserTab(id: string): Promise<void> {
    await req(this.getStore('browser-tabs', 'readwrite').delete(id))
  }

  // === Message operations ===

  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    opts?: { blocks?: MessageBlock[]; partial?: boolean; id?: string }
  ): Promise<Message> {
    const message: Message = {
      id: opts?.id || crypto.randomUUID(),
      sessionId,
      role,
      content,
      createdAt: Date.now(),
    }
    if (opts?.blocks) message.blocks = opts.blocks
    if (opts?.partial) message.partial = true
    await req(this.getStore('messages', 'readwrite').put(message))

    const sessionStore = this.getStore('sessions', 'readwrite')
    const session = await req(sessionStore.get(sessionId)) as Session | undefined
    if (session) {
      session.updatedAt = Date.now()
      await req(sessionStore.put(session))
    }

    return message
  }

  async updateMessage(id: string, updates: Partial<Pick<Message, 'content' | 'blocks' | 'partial'>>): Promise<void> {
    const store = this.getStore('messages', 'readwrite')
    const msg = await req(store.get(id)) as Message | undefined
    if (!msg) return
    if (updates.content !== undefined) msg.content = updates.content
    if (updates.blocks !== undefined) msg.blocks = updates.blocks
    if (updates.partial !== undefined) msg.partial = updates.partial
    else if (updates.partial === undefined && 'partial' in updates) delete msg.partial
    await req(store.put(msg))
  }

  async removeMessage(id: string): Promise<void> {
    await req(this.getStore('messages', 'readwrite').delete(id))
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const index = this.getStore('messages').index('sessionId')
    const all = await req(index.getAll(sessionId))
    return all.sort((a: Message, b: Message) => a.createdAt - b.createdAt)
  }
}

// Shared singleton instance
export const db = new DatabaseManager()

// Ready promise — consumers can await this before using db
export const dbReady: Promise<void> = db.init()
