import { getPlatform } from '../platform'
import { AgentEvent } from '@mariozechner/pi-agent-core'
import { getOAuthApiKey } from '@mariozechner/pi-ai'
import { agentService, StreamingBlock } from './agent-service'
import { db, dbReady } from './db'
import { resolveModel, type AuthMethod } from './model-resolver'
import { getOAuthConfig, getValidAccessToken } from './google-auth'
import { logAction } from './action-logger'
import { runtimePackService } from './runtime-pack'
import { isRetryableError, withRetry } from './retry'
import { hasAssistantResponseStarted } from './session-waiting'
import { getAnthropicBrowserAuthError, resolveVertexFallback } from './provider-guards'
import { createAllTools, createSetSystemPromptTool } from '../tools'

export type DisplayBlock = StreamingBlock

export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  blocks: DisplayBlock[]
  createdAt: number
}

export interface SessionState {
  messages: DisplayMessage[]
  streamingBlocks: DisplayBlock[]
  input: string
  isStreaming: boolean
  isWaitingForResponse: boolean
  expandedTools: Set<string>
  agentReady: boolean
  isLoading: boolean
  model: string
  /** Last send error, cleared on next successful send or manual dismiss */
  sendError: string | null
}

const DEFAULT_STATE: SessionState = Object.freeze({
  messages: [],
  streamingBlocks: [],
  input: '',
  isStreaming: false,
  isWaitingForResponse: false,
  expandedTools: new Set<string>(),
  agentReady: false,
  isLoading: true,
  model: '',
  sendError: null,
})

/** Builds a user-friendly error message from a raw error */
function friendlyErrorMessage(error: any): string {
  const msg = error?.message || String(error)
  const lower = msg.toLowerCase()

  // API key issues
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('authentication'))
    return `Authentication failed. Check your API key or re-authenticate.\n\nDetails: ${msg}`
  if (lower.includes('403') || lower.includes('forbidden') || lower.includes('permission'))
    return `Access denied. Your API key may lack permissions for this model.\n\nDetails: ${msg}`

  // Rate limits
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests'))
    return `Rate limited by the provider. Retrying automatically...`

  // Server issues
  if (lower.includes('500') || lower.includes('internal server error'))
    return `Provider server error (500). Retrying...`
  if (lower.includes('502') || lower.includes('bad gateway'))
    return `Provider temporarily unavailable (502). Retrying...`
  if (lower.includes('503') || lower.includes('service unavailable') || lower.includes('overloaded'))
    return `Provider is overloaded or unavailable. Retrying...`

  // Network
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('econnreset'))
    return `Network error. Check your internet connection.\n\nDetails: ${msg}`
  if (lower.includes('timeout') || lower.includes('timed out'))
    return `Request timed out. The provider may be slow or unreachable.`

  // Model issues
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('does not exist')))
    return `Model not found. The selected model may not be available for your account.\n\nDetails: ${msg}`

  return msg
}

// Notify Vite dev server about streaming state so HMR gate can defer updates
function notifyHmrStreamingState(streaming: boolean) {
  try {
    const hot = (import.meta as any).hot
    if (hot) {
      hot.send('moa:streaming-state', { streaming })
    }
  } catch {
    // Not critical
  }
}

function isE2EMockVertexResponseEnabled(): boolean {
  return typeof window !== 'undefined' && (window as any).__MOA_E2E_MOCK_VERTEX_RESPONSE__ === true
}

function buildDefaultSystemPrompt(cwd: string): string {
  return `You are MOA (Malleable Operating Agent) — a self-editing AI operating in a Ralph loop.

You run inside an Electron app with three integrated surfaces:
- Agent buffer (this chat — text editing and code generation)
- Terminal buffer (full PTY shell access via bash tool)
- Browser buffer (web browsing via web_fetch tool)

Working directory: ${cwd}
MOA source: ${cwd}/src

== Core Primitives ==
- HISTORY: Search and browse past conversations (history tool). Your memory spans sessions.
- SEARCH: Search files, code, and history (search tool). Find anything in the codebase or past work.
- INTENT: Track goals and progress (intent tool). Declare what you're working on, update progress, mark complete.

== Self-Modification ==
You can edit your own source code at ${cwd}/src/. When you do:
1. Vite HMR detects changes and hot-reloads the UI immediately
2. Use self_inspect to map your codebase before making changes
3. Use intent to track multi-step self-modification goals

== Tools ==
File I/O: read, write, edit
Shell: bash (30s timeout, use for git, npm, system commands)
Web: web_fetch (fetch and read web pages)
Search: search (rg/grep across files, filename glob, or history)
Memory: intent (declare/update/recall/complete/abandon goals)
History: history (list sessions, get messages, search across conversations)
Meta: self_inspect (map source tree, read own code, list tools, architecture, runtime state)

When asked to make changes, always read the relevant files first, then make targeted edits.
Use intent to track complex multi-step goals. Use history to recall past context.`
}

export class SessionStore {
  private sessions = new Map<string, SessionState>()
  private listeners = new Set<() => void>()
  private activeSubscriptions = new Map<string, () => void>()
  /** RAF handle for throttled notify — null when no frame is pending */
  private notifyRAF: number | null = null

  constructor() {
    // Bind methods to ensure 'this' context
    this.initSession = this.initSession.bind(this)
    this.getSession = this.getSession.bind(this)
    this.sendMessage = this.sendMessage.bind(this)
    this.setInput = this.setInput.bind(this)
    this.toggleTool = this.toggleTool.bind(this)
    this.subscribe = this.subscribe.bind(this)
  }

  getSnapshot(): Map<string, SessionState> {
    return this.sessions
  }

  getSession(sessionId: string): SessionState {
    return this.sessions.get(sessionId) || DEFAULT_STATE
  }

  updateSession(sessionId: string, update: Partial<SessionState>, sync = false) {
    const current = this.getSession(sessionId)
    const next = { ...current, ...update }
    // Notify Vite HMR gate when streaming state changes
    if ('isStreaming' in update && update.isStreaming !== current.isStreaming) {
      notifyHmrStreamingState(!!update.isStreaming)
    }
    this.sessions.set(sessionId, next)
    // Use synchronous notify for critical user-facing changes (input, send,
    // streaming end, errors). Streaming content updates use throttled RAF.
    if (sync) {
      this.notifySync()
    } else {
      this.notify()
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Throttled notify — batches React re-renders to at most once per animation
   * frame (~60fps). During streaming, dozens of text_delta events fire per
   * second; without throttling each one triggers a full React reconciliation.
   */
  private notify() {
    if (this.notifyRAF !== null) return // already scheduled
    this.notifyRAF = requestAnimationFrame(() => {
      this.notifyRAF = null
      for (const listener of this.listeners) {
        listener()
      }
    })
  }

  /** Bypass RAF and notify synchronously — used for critical state changes
   *  like session init, send, and streaming end where we want immediate UI. */
  private notifySync() {
    if (this.notifyRAF !== null) {
      cancelAnimationFrame(this.notifyRAF)
      this.notifyRAF = null
    }
    for (const listener of this.listeners) {
      listener()
    }
  }

  /**
   * Resolve model string to a Model object and build the getApiKey callback.
   * Shared by initSession (first-time creation) and updateModel (hot-swap).
   */
  private async resolveModelAndAuth(model: string) {
    const vertexProject = localStorage.getItem('vertex_project')
    const vertexLocation = localStorage.getItem('vertex_location')
    const vertexExpressApiKey = localStorage.getItem('vertex_express_api_key')

    const resolvedProvider = resolveVertexFallback(model, vertexProject, vertexLocation, vertexExpressApiKey)
    const authMethod: AuthMethod = resolvedProvider.authMethod
    const modelId = resolvedProvider.modelId

    // For Vertex AI, set env vars before model resolution
    if (authMethod === 'vertex') {
      const platform = getPlatform()
      if (vertexProject) platform.process.env.GOOGLE_CLOUD_PROJECT = vertexProject
      if (vertexLocation) platform.process.env.GOOGLE_CLOUD_LOCATION = vertexLocation
    }

    // For custom providers, look up base URL
    let providerBaseUrl = ''
    if (authMethod !== 'anthropic-key' && authMethod !== 'anthropic-oauth' && authMethod !== 'openai-oauth' && authMethod !== 'vertex' && authMethod !== 'vertex-express') {
      const provider = await db.getProvider(authMethod)
      if (provider) providerBaseUrl = provider.baseUrl
    }

    const resolvedModel = await resolveModel({
      modelId,
      authMethod,
      providerBaseUrl,
    })

    const getApiKey = async (providerName: string) => {
      // Anthropic API key
      if (authMethod === 'anthropic-key') {
        const browserAuthError = getAnthropicBrowserAuthError(authMethod, getPlatform().type)
        if (browserAuthError) {
          throw new Error(browserAuthError)
        }
        const key = localStorage.getItem('anthropic_key')
        if (!key) {
          throw new Error('No Anthropic API key configured. Go to Settings and add your API key.')
        }
        return key
      }
      // Anthropic OAuth (Plan)
      if (authMethod === 'anthropic-oauth') {
        const creds = await db.getOAuthCredentials('anthropic')
        if (!creds) {
          throw new Error('Anthropic OAuth not configured. Go to Settings and sign in with your Anthropic account.')
        }
        try {
          const result = await getOAuthApiKey('anthropic', { anthropic: creds as any })
          if (result) {
            // Persist refreshed credentials
            await db.setOAuthCredentials('anthropic', result.newCredentials)
            return result.apiKey
          }
        } catch (e: any) {
          throw new Error(`Anthropic OAuth token refresh failed: ${e.message || e}. Try re-authenticating in Settings.`)
        }
        throw new Error('Anthropic OAuth: failed to obtain API key. Try re-authenticating in Settings.')
      }
      // OpenAI OAuth (ChatGPT Plan)
      if (authMethod === 'openai-oauth') {
        const creds = await db.getOAuthCredentials('openai')
        if (!creds) {
          throw new Error('OpenAI OAuth not configured. Go to Settings and sign in with your OpenAI account.')
        }
        try {
          // DB key is "openai" while OAuth provider key is "openai-codex".
          const result = await getOAuthApiKey('openai-codex', {
            'openai-codex': creds as any,
          })
          if (result) {
            await db.setOAuthCredentials('openai', result.newCredentials as any)
            return result.apiKey
          }
        } catch (e: any) {
          throw new Error(`OpenAI OAuth token refresh failed: ${e.message || e}. Try re-authenticating in Settings.`)
        }
        throw new Error('OpenAI OAuth: failed to obtain API key. Try re-authenticating in Settings.')
      }
      // Vertex AI — either ADC or Google OAuth
      if (authMethod === 'vertex') {
        const vertexAuthMethod = localStorage.getItem('vertex_auth_method')
        if (vertexAuthMethod === 'google-oauth') {
          // Google OAuth: get/refresh access token and set as model header
          const googleCreds = await db.getOAuthCredentials('google')
          const oauthConfig = getOAuthConfig()
          if (!googleCreds) {
            throw new Error('Google OAuth not configured for Vertex AI. Go to Settings and sign in with Google.')
          }
          if (!oauthConfig) {
            throw new Error('Google OAuth client not configured. Set VITE_GOOGLE_OAUTH_CLIENT_ID and VITE_GOOGLE_OAUTH_CLIENT_SECRET.')
          }
          try {
            const { accessToken, newCreds } = await getValidAccessToken(oauthConfig, googleCreds)
            await db.setOAuthCredentials('google', newCreds)
            // Set Authorization header on the resolved model so @google/genai uses it
            ;(resolvedModel as any).headers = {
              ...(resolvedModel as any).headers,
              'Authorization': `Bearer ${accessToken}`,
            }
            return '<authenticated>'
          } catch (e: any) {
            throw new Error(`Google OAuth token refresh failed: ${e.message || e}. Try re-authenticating in Settings.`)
          }
        }
        // ADC handles auth
        return '<authenticated>'
      }
      // Vertex AI Express — simple API key
      if (authMethod === 'vertex-express') {
        const key = localStorage.getItem('vertex_express_api_key')
        if (!key) {
          throw new Error('No Vertex AI Express API key configured. Go to Settings > Vertex AI and add your API key.')
        }
        return key
      }
      // Custom provider — look up API key from DB
      const storedProvider = await db.getProvider(authMethod)
      if (storedProvider?.apiKey) return storedProvider.apiKey
      // Fallback: search by name
      const storedProviders = await db.listProviders()
      const match = storedProviders.find(p =>
        p.name.toLowerCase() === providerName.toLowerCase() ||
        p.name.toLowerCase().includes(providerName.toLowerCase())
      )
      if (!match?.apiKey) {
        throw new Error(`No API key found for provider "${authMethod}". Go to Settings and add the provider with an API key.`)
      }
      return match.apiKey
    }

    // Eagerly validate that we can obtain an API key. This catches
    // missing keys before any streaming attempt so the user sees a
    // clear error immediately instead of a cryptic 401 mid-stream.
    try {
      await getApiKey(resolvedModel.provider)
    } catch (e: any) {
      // Re-throw so callers can surface the message. The lazy
      // callback will throw the same error when the agent loop
      // calls it, so this doesn't hide anything.
      throw e
    }

    return { resolvedModel, getApiKey, authMethod, modelId }
  }

  /**
   * Hot-swap the model on an existing session without destroying the agent.
   * Preserves conversation history, tools, subscriptions, and streaming state.
   * Also persists the new model to the DB.
   */
  async updateModel(sessionId: string, newModel: string) {
    await dbReady

    const { resolvedModel, getApiKey } = await this.resolveModelAndAuth(newModel)

    agentService.updateModel(sessionId, resolvedModel, getApiKey)

    // Update in-memory state
    this.updateSession(sessionId, { model: newModel })

    // Persist to DB
    db.updateSession(sessionId, { model: newModel }).catch(console.error)
  }

  private composeSystemPrompt(basePrompt: string): string {
    const runtimeInfo = runtimePackService.getInfoSync()
    const runtimeConfig = runtimePackService.getActiveConfigSync()
    const runtimeOverlay = runtimeConfig?.systemPromptAppendix
      ? `Runtime root: ${runtimeInfo.runtimeRoot}\nActive pack: ${runtimeInfo.activePackId ?? '(none)'}\n\n${runtimeConfig.systemPromptAppendix}`
      : null
    return runtimeOverlay
      ? `${basePrompt}\n\n== Runtime Pack Overlay ==\n${runtimeOverlay}`
      : basePrompt
  }

  async setSystemPrompt(sessionId: string, prompt: string): Promise<void> {
    const nextPrompt = prompt.trim()
    if (!nextPrompt) throw new Error('System prompt cannot be empty.')

    await dbReady
    const updated = await db.updateSession(sessionId, { systemPrompt: nextPrompt })
    if (!updated) throw new Error(`Session ${sessionId} not found.`)

    const agent = agentService.getAgent(sessionId)
    if (agent) {
      agent.setSystemPrompt(this.composeSystemPrompt(nextPrompt))
    }

    const now = Date.now()
    const id = `sys-${now}`
    const content = 'System prompt updated for this session.'
    const s = this.getSession(sessionId)
    this.updateSession(sessionId, {
      messages: [...s.messages, {
        id,
        role: 'system',
        blocks: [{ id: `sys-blk-${now}`, type: 'text', content }],
        createdAt: now,
      }],
    }, true)

    db.addMessage(sessionId, 'system', content, { id }).catch(() => {})
    logAction('session.system_prompt.updated', { sessionId, length: nextPrompt.length }, { actor: 'agent', sessionId })
  }

  async initSession(sessionId: string, model: string) {
    // If we already have state for this session and the model matches (or isn't set yet), don't reload
    // BUT if the component re-mounted, we might need to re-verify streaming state
    const existing = this.sessions.get(sessionId)
    if (existing && existing.agentReady && existing.model === model) {
        // Just sync streaming state in case it drifted
        this.syncStreamingState(sessionId)
        return
    }

    // If agent already exists but model changed, hot-swap the model instead of recreating
    if (existing && existing.agentReady && existing.model !== model && agentService.getAgent(sessionId)) {
        try {
          await this.updateModel(sessionId, model)
          this.syncStreamingState(sessionId)
          return
        } catch (e: any) {
          console.error('Failed to hot-swap model, falling back to full reinit:', e)
          // Fall through to full re-initialization below
          agentService.destroyAgent(sessionId)
        }
    }

    // Initialize with default if new
    if (!existing) {
        this.sessions.set(sessionId, { ...DEFAULT_STATE, model })
    } else {
        // Update model if changed
        this.updateSession(sessionId, { model })
    }

    try {
      await dbReady
      const sessionRecord = await db.getSession(sessionId)

      // Model-less session: load history but skip agent initialization.
      if (!model) {
        const msgs = await db.getMessages(sessionId)
        const loaded: DisplayMessage[] = msgs.map((m: any) => ({
          id: m.id,
          role: m.role,
          blocks: m.blocks
            ? (m.blocks as DisplayBlock[])
            : [{ id: `loaded-${m.id}`, type: 'text' as const, content: m.content }],
          createdAt: m.createdAt,
        }))
        this.updateSession(sessionId, {
          messages: loaded,
          isLoading: false,
          agentReady: false,
          model: '',
        }, true)
        return
      }

      // 1. Create Agent
      const { resolvedModel, getApiKey } = await this.resolveModelAndAuth(model)

      const cwd = getPlatform().process.cwd()
      const baseSystemPrompt = sessionRecord?.systemPrompt?.trim() || buildDefaultSystemPrompt(cwd)
      const composedSystemPrompt = this.composeSystemPrompt(baseSystemPrompt)
      const tools = createAllTools('/src')
      tools.push(createSetSystemPromptTool({
        applySystemPrompt: async (prompt) => {
          await this.setSystemPrompt(sessionId, prompt)
        },
      }))

      agentService.createAgent(sessionId, {
        model: resolvedModel,
        tools,
        systemPrompt: composedSystemPrompt,
        getApiKey,
      })

      this.updateSession(sessionId, { agentReady: true })

      // 2. Load Messages from DB
      const msgs = await db.getMessages(sessionId)

      // Check if we are streaming NOW (survived HMR)
      const isStreaming = agentService.isStreaming(sessionId)

      const loaded: DisplayMessage[] = msgs
        .filter((m: any) => !m.partial || !isStreaming) // Don't show partials if we are about to show live blocks
        .map((m: any) => ({
          id: m.id,
          role: m.role,
          blocks: m.blocks
            ? (m.blocks as DisplayBlock[])
            : [{ id: `loaded-${m.id}`, type: 'text' as const, content: m.content }],
          createdAt: m.createdAt,
        }))

      this.updateSession(sessionId, {
          messages: loaded,
          isLoading: false
      })

      // 3. Hydrate Agent History
      const nonPartial = msgs.filter((m: any) => !m.partial)
      agentService.hydrateFromMessages(sessionId, nonPartial)

      // 4. Sync Streaming State
      this.syncStreamingState(sessionId)

      // 5. Subscribe to Agent Events
      // Ensure we don't double-subscribe
      if (this.activeSubscriptions.has(sessionId)) {
          this.activeSubscriptions.get(sessionId)!()
      }

      const unsub = agentService.subscribe(sessionId, (event) => this.handleAgentEvent(sessionId, event))
      this.activeSubscriptions.set(sessionId, unsub)

    } catch (e: any) {
        console.error('Failed to init session:', e)
        this.updateSession(sessionId, {
            isLoading: false,
            messages: [...(this.getSession(sessionId).messages), {
                id: `err-${Date.now()}`,
                role: 'system',
                blocks: [{ id: `err-blk-${Date.now()}`, type: 'text', content: `Failed to create agent: ${e.message || e}` }],
                createdAt: Date.now(),
            }]
        })
    }
  }

  private syncStreamingState(sessionId: string) {
      if (agentService.isStreaming(sessionId)) {
          const blocks = agentService.getStreamingBlocks(sessionId)
          this.updateSession(sessionId, {
              isStreaming: true,
              streamingBlocks: [...blocks]
          })
      } else {
          this.updateSession(sessionId, { isStreaming: false })
      }
  }

  private handleAgentEvent(sessionId: string, agentEvent: AgentEvent) {
      const eventType = agentEvent.type as string

      switch (eventType) {
        case 'agent_start': {
            // Create partial message
            const pId = `partial-${sessionId}-${Date.now()}`
            agentService.setPartialMsgId(sessionId, pId)
            db.addMessage(sessionId, 'assistant', '', {
                id: pId,
                blocks: [],
                partial: true,
            }).catch(e => console.error('Failed to create partial message:', e))

            this.updateSession(sessionId, {
                isStreaming: true,
                streamingBlocks: [],
            })
            break
        }

        case 'message_start':
            this.updateSession(sessionId, { isStreaming: true })
            break

        case 'steer_interrupt':
            this.updateSession(sessionId, { streamingBlocks: [] })
            break

        case 'message_update':
        case 'tool_execution_start':
        case 'tool_execution_end':
        case 'message_end':
        {
            const waitingUpdate: Partial<SessionState> = {}
            if (this.getSession(sessionId).isWaitingForResponse && hasAssistantResponseStarted(agentEvent)) {
              waitingUpdate.isWaitingForResponse = false
            }
            this.updateSession(sessionId, {
                streamingBlocks: [...agentService.getStreamingBlocks(sessionId)],
                ...waitingUpdate,
            })

            if (agentEvent.type === 'tool_execution_end' || agentEvent.type === 'message_end') {
                const pmId = agentService.getPartialMsgId(sessionId)
                if (pmId) {
                    const blocks = agentService.getStreamingBlocks(sessionId)
                    const text = blocks.filter(b => b.type === 'text' && b.content).map(b => b.content).join('')
                    db.updateMessage(pmId, { content: text, blocks: blocks as any }).catch(() => {})
                }
            }
            break
        }

        case 'agent_end': {
            const pmId = agentService.getPartialMsgId(sessionId)
            const blocks = agentService.getStreamingBlocks(sessionId)
            const session = this.getSession(sessionId)

            // Check if the agent ended with an error (from pi-agent-core's catch block).
            // The agent appends an error message with stopReason: 'error' and errorMessage.
            const agentEndEvent = agentEvent as any
            const agentEndMessages: any[] = agentEndEvent.messages || []
            const errorMsg = agentEndMessages.find((m: any) =>
              m.role === 'assistant' && (m.stopReason === 'error' || m.errorMessage)
            )

            if (blocks.length > 0) {
                const finalMsg: DisplayMessage = {
                    id: pmId || `assistant-${Date.now()}`,
                    role: 'assistant',
                    blocks: [...blocks],
                    createdAt: Date.now(),
                }

                const newMessages = [...session.messages, finalMsg]

                // If there was an error, also add a system message so the user sees it
                if (errorMsg?.errorMessage) {
                    const friendly = friendlyErrorMessage({ message: errorMsg.errorMessage })
                    newMessages.push({
                        id: `err-${Date.now()}`,
                        role: 'system',
                        blocks: [{ id: `err-blk-${Date.now()}`, type: 'text', content: friendly }],
                        createdAt: Date.now(),
                    })
                    this.updateSession(sessionId, {
                        messages: newMessages,
                        streamingBlocks: [],
                        isStreaming: false,
                        isWaitingForResponse: false,
                        sendError: friendly,
                    }, true) // sync: streaming end
                } else {
                    this.updateSession(sessionId, {
                        messages: newMessages,
                        streamingBlocks: [],
                        isStreaming: false,
                        isWaitingForResponse: false,
                        sendError: null,
                    }, true) // sync: streaming end
                }

                const textContent = blocks.filter(b => b.type === 'text' && b.content).map(b => b.content).join('')
                if (pmId) {
                    db.updateMessage(pmId, {
                        content: textContent,
                        blocks: blocks as any,
                        partial: false,
                    }).catch(e => console.error('Failed to finalize message:', e))
                } else if (textContent) {
                    db.addMessage(sessionId, 'assistant', textContent, {
                        blocks: blocks as any,
                    }).catch(e => console.error('Failed to save assistant message:', e))
                }
            } else {
                if (pmId) db.removeMessage(pmId).catch(() => {})

                // No blocks produced — if there was an error, surface it to the user
                if (errorMsg?.errorMessage) {
                    const friendly = friendlyErrorMessage({ message: errorMsg.errorMessage })
                    this.updateSession(sessionId, {
                        messages: [...session.messages, {
                            id: `err-${Date.now()}`,
                            role: 'system',
                            blocks: [{ id: `err-blk-${Date.now()}`, type: 'text', content: friendly }],
                            createdAt: Date.now(),
                        }],
                        streamingBlocks: [],
                        isStreaming: false,
                        isWaitingForResponse: false,
                        sendError: friendly,
                    }, true) // sync: streaming end
                } else {
                    this.updateSession(sessionId, {
                        streamingBlocks: [],
                        isStreaming: false,
                        isWaitingForResponse: false,
                    }, true) // sync: streaming end
                }
            }
            agentService.clearPartialMsgId(sessionId)
            break
        }
      }
  }

  /** Clear the sendError for a session (e.g., user dismissed the error banner) */
  clearSendError(sessionId: string) {
    this.updateSession(sessionId, { sendError: null }, true) // sync: user action
  }

  /** Add a system error message to the chat and update sendError state */
  private addErrorToChat(sessionId: string, message: string, timestamp?: number) {
    const ts = timestamp || Date.now()
    const s = this.getSession(sessionId)
    const errorMsg: DisplayMessage = {
      id: `err-${ts}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'system',
      blocks: [{ id: `err-blk-${ts}`, type: 'text', content: message }],
      createdAt: ts,
    }
    this.updateSession(sessionId, {
      messages: [...s.messages, errorMsg],
      isStreaming: false,
      isWaitingForResponse: false,
      sendError: message,
    }, true) // sync: error display
    // Also persist the error to DB so it survives reloads
    db.addMessage(sessionId, 'system', message, {
      id: errorMsg.id,
    }).catch(() => {})
  }

  async sendMessage(sessionId: string) {
      const session = this.getSession(sessionId)
      const input = session.input.trim()

      // Guard: no empty input
      if (!input) return

      // Guard: agent not ready — show visible feedback instead of silently failing
      if (!session.agentReady) {
          this.addErrorToChat(sessionId, 'Agent is not ready yet. Please wait for initialization to complete, or check if there was an initialization error above.')
          return
      }

      // Guard: verify the agent instance actually exists
      if (!agentService.getAgent(sessionId)) {
          this.addErrorToChat(sessionId, 'Agent instance not found. Try refreshing or switching sessions.')
          return
      }

      // Clear any previous error
      this.updateSession(sessionId, { sendError: null }, true) // sync: user action

      const userMsgTime = Date.now()
      this.updateSession(sessionId, { input: '' }, true) // sync: clear input

      logAction('message.sent', { sessionId, contentPreview: input.slice(0, 100) }, { actor: 'user', sessionId })

      db.addMessage(sessionId, 'user', input).catch(console.error)

      // Auto-title
      if (session.messages.length === 0) {
          const title = input.substring(0, 30).trim() || 'New Chat'
          db.updateSession(sessionId, { title }).catch(console.error)
      }

      if (session.isStreaming) {
          // Steer logic
          const currentBlocks = agentService.getStreamingBlocks(sessionId)
          const pmId = agentService.getPartialMsgId(sessionId)

          const newMessages = [...session.messages]
          if (currentBlocks.length > 0) {
              newMessages.push({
                  id: pmId || `assistant-interrupted-${userMsgTime - 1}`,
                  role: 'assistant',
                  blocks: [...currentBlocks],
                  createdAt: userMsgTime - 1,
              })
          }
          newMessages.push({
              id: `user-${userMsgTime}`,
              role: 'user',
              blocks: [{ id: `ublk-${userMsgTime}`, type: 'text', content: input }],
              createdAt: userMsgTime,
          })

          this.updateSession(sessionId, {
              messages: newMessages,
              streamingBlocks: []
          }, true) // sync: steer — user sees message immediately

          if (currentBlocks.length > 0) {
              const textContent = currentBlocks.filter(b => b.type === 'text' && b.content).map(b => b.content).join('')
              if (pmId) {
                  db.updateMessage(pmId, {
                      content: textContent,
                      blocks: currentBlocks as any,
                      partial: false,
                  }).catch(console.error)
              }
          }

          agentService.clearPartialMsgId(sessionId)

          try {
              agentService.steer(sessionId, input)
          } catch (e: any) {
              const friendly = friendlyErrorMessage(e)
               this.updateSession(sessionId, {
                   messages: [...newMessages, {
                       id: `err-${userMsgTime}`,
                       role: 'system',
                       blocks: [{ id: `err-blk-${userMsgTime}`, type: 'text', content: friendly }],
                       createdAt: userMsgTime,
                   }],
                   isWaitingForResponse: false,
                   sendError: friendly,
               }, true) // sync: error display
           }

      } else {
          // Normal flow
          this.updateSession(sessionId, {
              messages: [...session.messages, {
                  id: `user-${userMsgTime}`,
                  role: 'user',
                  blocks: [{ id: `ublk-${userMsgTime}`, type: 'text', content: input }],
                  createdAt: userMsgTime,
              }],
              isStreaming: true,
               isWaitingForResponse: true,
           }, true) // sync: user message send

          if (isE2EMockVertexResponseEnabled() && session.model.startsWith('vertex-express:')) {
            const assistantTime = Date.now()
            const assistantMessage: DisplayMessage = {
              id: `assistant-${assistantTime}`,
              role: 'assistant',
              blocks: [{ id: `ablk-${assistantTime}`, type: 'text', content: 'Mock Vertex Express response.' }],
              createdAt: assistantTime,
            }
            const current = this.getSession(sessionId)
            this.updateSession(sessionId, {
              messages: [...current.messages, assistantMessage],
              isStreaming: false,
              isWaitingForResponse: false,
              sendError: null,
            }, true)
            db.addMessage(sessionId, 'assistant', 'Mock Vertex Express response.', {
              id: assistantMessage.id,
              blocks: assistantMessage.blocks as any,
            }).catch(() => {})
            return
          }

           try {
              await withRetry(
                async () => {
                  await agentService.prompt(sessionId, input)
                },
                {
                  onRetry: ({ attempt, maxRetries, error }) => {
                    if (!isRetryableError(error)) return
                    console.error(`Send attempt ${attempt} failed:`, error)
                    const s = this.getSession(sessionId)
                    const retryMsg: DisplayMessage = {
                      id: `retry-${userMsgTime}-${attempt}`,
                      role: 'system',
                      blocks: [{ id: `retry-blk-${userMsgTime}-${attempt}`, type: 'text', content: `Retrying... (attempt ${attempt}/${maxRetries})` }],
                      createdAt: Date.now(),
                    }
                    this.updateSession(sessionId, {
                      messages: [...s.messages, retryMsg],
                      isStreaming: true,
                      isWaitingForResponse: true,
                    })
                  },
                }
              )

              // Success — clear any send error
              this.updateSession(sessionId, { sendError: null })
          } catch (e: any) {
              const friendly = friendlyErrorMessage(e)
              this.addErrorToChat(sessionId, friendly, userMsgTime)
          }
      }
  }

  setInput(sessionId: string, value: string) {
      this.updateSession(sessionId, { input: value }, true) // sync: user typing
  }

  toggleTool(sessionId: string, toolId: string) {
      const session = this.getSession(sessionId)
      const next = new Set(session.expandedTools)
      if (next.has(toolId)) next.delete(toolId)
      else next.add(toolId)
      this.updateSession(sessionId, { expandedTools: next }, true) // sync: user click
  }
}

// Singleton instance — in moav2, entry point manages lifecycle instead of window.__sessionStore
export const sessionStore = new SessionStore()
