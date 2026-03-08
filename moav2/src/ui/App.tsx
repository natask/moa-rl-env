import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AgentBuffer from './components/AgentBuffer'
import TerminalBuffer from './components/TerminalBuffer'
import BrowserBuffer from './components/BrowserBuffer'
import DevToolsBuffer from './components/DevToolsBuffer'
import CommandPalette from './components/CommandPalette'
import Dropdown from './components/Dropdown'
import ErrorBoundary from './components/ErrorBoundary'
import SidebarCarousel, { type CarouselTab } from './components/SidebarCarousel'
import { useSwipeSidebar } from './hooks/useSwipeSidebar'
import { db, dbReady, type TerminalTab, type BrowserTab } from '../core/services/db'
import { agentService } from '../core/services/agent-service'
import { sessionStore } from '../core/services/session-store'
import { getProviderModels } from '../core/services/model-resolver'
import { getPlatform } from '../core/platform'
import {
  getOAuthConfig,
  buildAuthUrl,
  exchangeCode,
  listProjects,
  type GoogleOAuthConfig,
  type GcpProject,
} from '../core/services/google-auth'
import {
  anthropicOAuthProvider,
  openaiCodexOAuthProvider,
  type Model,
} from '@mariozechner/pi-ai'
import { logAction } from '../core/services/action-logger'
import { runtimePackService } from '../core/services/runtime-pack'
import { OAuthCodeBridge } from '../core/services/oauth-code-bridge'
import '../styles/App.css'

type BufferView = 'agent' | 'terminal' | 'browser' | 'devtools'
type SettingsTab = 'anthropic' | 'openai' | 'vertex' | 'custom'
type AnthropicAuthMode = 'apikey' | 'oauth'
type OpenAIAuthMode = 'apikey' | 'oauth'

interface Session {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  sortOrder: number
}

interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  createdAt: number
}

const dbReadyPromise = dbReady

// ── HMR state cache ──
interface HmrAppState {
  sessions: Session[]
  activeSessionId: string | null
  model: string
  providers: Provider[]
  streamingSessions: string[]
  hasAnthropicKey: boolean
  hasOAuthCreds: boolean
  hasOpenAIOAuthCreds: boolean
  hasVertexConfig: boolean
  hasOpenAIKey: boolean
}
const _w = window as any
const _hmr: HmrAppState | null = _w.__hmrAppState || null
function hmr<K extends keyof HmrAppState>(key: K, fallback: HmrAppState[K]): HmrAppState[K] {
  if (_hmr) return _hmr[key]
  if (key === 'model') {
    const saved = localStorage.getItem('moa_selected_model')
    if (saved) return saved as HmrAppState[K]
  }
  if (key === 'activeSessionId') {
    const saved = localStorage.getItem('moa_active_session')
    if (saved) return saved as HmrAppState[K]
  }
  if (key === 'hasAnthropicKey') {
    return !!localStorage.getItem('anthropic_key') as HmrAppState[K]
  }
  if (key === 'hasOpenAIKey') {
    return !!localStorage.getItem('openai_key') as HmrAppState[K]
  }
  if (key === 'hasVertexConfig') {
    return !!(localStorage.getItem('vertex_project') && localStorage.getItem('vertex_location')) as HmrAppState[K]
  }
  return fallback
}

// ── Restart banner (Electron only) ──
let _restartListenerAttached = false
let _restartCallback: (() => void) | null = null

function attachRestartListener() {
  if (_restartListenerAttached) return
  _restartListenerAttached = true
  // Guard: only attach IPC listener in Electron mode
  if (getPlatform().type === 'electron') {
    try {
      const { ipcRenderer } = (window as any).require('electron')
      ipcRenderer.on('moa:main-process-updated', () => {
        _restartCallback?.()
      })
    } catch { /* failed to attach */ }
  }
}

function triggerRestart() {
  // Guard: only send IPC message in Electron mode
  if (getPlatform().type === 'electron') {
    try {
      const { ipcRenderer } = (window as any).require('electron')
      ipcRenderer.send('moa:restart-app')
    } catch { /* not in electron */ }
  }
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>(hmr('sessions', []))
  const [activeSessionId, setActiveSessionId] = useState<string | null>(hmr('activeSessionId', null))
  const [model, setModel] = useState<string>(hmr('model', ''))
  const [streamingSessions, setStreamingSessions] = useState<Set<string>>(
    () => new Set(hmr('streamingSessions', []))
  )

  // Auth state
  const [hasAnthropicKey, setHasAnthropicKey] = useState(hmr('hasAnthropicKey', false))
  const [hasOAuthCreds, setHasOAuthCreds] = useState(hmr('hasOAuthCreds', false))
  const [hasOpenAIOAuthCreds, setHasOpenAIOAuthCreds] = useState(hmr('hasOpenAIOAuthCreds', false))
  const [hasVertexConfig, setHasVertexConfig] = useState(hmr('hasVertexConfig', false))
  const [hasOpenAIKey, setHasOpenAIKey] = useState(hmr('hasOpenAIKey', false))

  // Settings UI
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('anthropic')
  const [settingsError, setSettingsError] = useState('')

  // Anthropic API key form
  const [anthropicKey, setAnthropicKey] = useState('')
  const [anthropicAuthMode, setAnthropicAuthMode] = useState<AnthropicAuthMode>('apikey')

  // OpenAI API key form
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiAuthMode, setOpenaiAuthMode] = useState<OpenAIAuthMode>('apikey')

  // OAuth flow state
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthAuthUrl, setOauthAuthUrl] = useState('')
  const [oauthCode, setOauthCode] = useState('')
  const [oauthError, setOauthError] = useState('')
  // We need a ref to communicate between the login callback and the paste handler
  const oauthCodeResolverRef = useRef<{
    resolve: (code: string) => void
    reject: (error: Error) => void
  } | null>(null)
  const anthropicOAuthBridgeRef = useRef(new OAuthCodeBridge())

  // OpenAI OAuth flow state
  const [openaiOauthLoading, setOpenaiOauthLoading] = useState(false)
  const [openaiOauthAuthUrl, setOpenaiOauthAuthUrl] = useState('')
  const [openaiOauthCode, setOpenaiOauthCode] = useState('')
  const [openaiOauthError, setOpenaiOauthError] = useState('')
  const openaiOauthCodeResolverRef = useRef<{
    resolve: (code: string) => void
    reject: (error: Error) => void
  } | null>(null)
  const openaiOAuthBridgeRef = useRef(new OAuthCodeBridge())

  const isMountedRef = useRef(true)

  const isE2EMockOAuth = () => typeof window !== 'undefined' && (window as any).__MOA_E2E_MOCK_OAUTH__ === true

  const clearPendingOAuthResolvers = useCallback((reason: string) => {
    anthropicOAuthBridgeRef.current.cancel(reason)
    openaiOAuthBridgeRef.current.cancel(reason)
    oauthCodeResolverRef.current = null
    openaiOauthCodeResolverRef.current = null
  }, [])

  const resetAnthropicOAuthFlow = useCallback((reason?: string) => {
    anthropicOAuthBridgeRef.current.cancel(reason || 'Anthropic OAuth login cancelled')
    oauthCodeResolverRef.current = null
    setOauthLoading(false)
    setOauthAuthUrl('')
    setOauthCode('')
    setOauthError('')
  }, [])

  const resetOpenAIOAuthFlow = useCallback((reason?: string) => {
    openaiOAuthBridgeRef.current.cancel(reason || 'OpenAI OAuth login cancelled')
    openaiOauthCodeResolverRef.current = null
    setOpenaiOauthLoading(false)
    setOpenaiOauthAuthUrl('')
    setOpenaiOauthCode('')
    setOpenaiOauthError('')
  }, [])

  // Ensure pending OAuth resolver refs do not survive unmount.
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      clearPendingOAuthResolvers('OAuth login cancelled')
    }
  }, [clearPendingOAuthResolvers])

  useEffect(() => {
    if (settingsTab !== 'anthropic') {
      resetAnthropicOAuthFlow('Switched away from Anthropic settings')
    }
    if (settingsTab !== 'openai') {
      resetOpenAIOAuthFlow('Switched away from OpenAI settings')
    }
  }, [settingsTab, resetAnthropicOAuthFlow, resetOpenAIOAuthFlow])

  // Vertex AI form
  const [vertexProject, setVertexProject] = useState(localStorage.getItem('vertex_project') || '')
  const [vertexLocation, setVertexLocation] = useState(localStorage.getItem('vertex_location') || '')
  const [vertexAdcStatus, setVertexAdcStatus] = useState<'unknown' | 'found' | 'missing'>('unknown')

  // Vertex AI Express (API key auth)
  const [vertexAuthMode, setVertexAuthMode] = useState<'express' | 'adc-oauth'>(() =>
    localStorage.getItem('vertex_express_api_key') ? 'express' : 'adc-oauth'
  )
  const [vertexExpressKey, setVertexExpressKey] = useState('')
  const [hasVertexExpressKey, setHasVertexExpressKey] = useState(!!localStorage.getItem('vertex_express_api_key'))

  // Google OAuth flow state (for Vertex AI without gcloud)
  const [googleOAuthConfig] = useState<GoogleOAuthConfig | null>(() => getOAuthConfig())
  const [googleOAuthLoading, setGoogleOAuthLoading] = useState(false)
  const [googleOAuthUrl, setGoogleOAuthUrl] = useState('')
  const [googleOAuthCode, setGoogleOAuthCode] = useState('')
  const [googleOAuthError, setGoogleOAuthError] = useState('')
  const [googleProjects, setGoogleProjects] = useState<GcpProject[]>([])
  const [hasGoogleOAuth, setHasGoogleOAuth] = useState(false)

  // Custom provider form
  const [providers, setProviders] = useState<Provider[]>(hmr('providers', []))
  const [newName, setNewName] = useState('')
  const [newBaseUrl, setNewBaseUrl] = useState('')
  const [newApiKey, setNewApiKey] = useState('')
  const [addError, setAddError] = useState('')
  const [customModelName, setCustomModelName] = useState('')

  // Model lists (fetched from pi-ai registry)
  const [anthropicModels, setAnthropicModels] = useState<Model<any>[]>([])
  const [vertexModels, setVertexModels] = useState<Model<any>[]>([])

  // UI
  const [activeBuffer, setActiveBuffer] = useState<BufferView>('agent')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteInitialMode, setCommandPaletteInitialMode] = useState<'commands' | 'models'>('commands')
  const [restartAvailable, setRestartAvailable] = useState(false)
  const [isMobileLayout, setIsMobileLayout] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Terminal & Browser tab state
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([])
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([])
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string | null>(() =>
    localStorage.getItem('moa_active_terminal_tab')
  )
  const [activeBrowserTabId, setActiveBrowserTabId] = useState<string | null>(() =>
    localStorage.getItem('moa_active_browser_tab')
  )

  // Load model lists from pi-ai on mount
  useEffect(() => {
    getProviderModels('anthropic').then(setAnthropicModels)
    getProviderModels('google-vertex').then(setVertexModels)
  }, [])

  // Global Cmd+K / Ctrl+K to toggle command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandPaletteInitialMode('commands')
        setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const toggleDevToolsBuffer = () => {
      setActiveBuffer((prev) => (prev === 'devtools' ? 'agent' : 'devtools'))
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const isMacShortcut = e.metaKey && e.altKey && key === 'i'
      const isOtherShortcut = e.ctrlKey && e.shiftKey && key === 'i'

      if (!isMacShortcut && !isOtherShortcut) return

      e.preventDefault()
      toggleDevToolsBuffer()
    }

    window.addEventListener('keydown', handleKeyDown)

    if (getPlatform().type === 'electron') {
      try {
        const { ipcRenderer } = (window as any).require('electron')
        const handleMainToggle = () => toggleDevToolsBuffer()
        ipcRenderer.on('moa:toggle-devtools-buffer', handleMainToggle)

        return () => {
          window.removeEventListener('keydown', handleKeyDown)
          ipcRenderer.removeListener('moa:toggle-devtools-buffer', handleMainToggle)
        }
      } catch {
        // Electron IPC not available
      }
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // Listen for main process code changes (Electron-only IPC)
  useEffect(() => {
    _restartCallback = () => setRestartAvailable(true)
    attachRestartListener()
    return () => { _restartCallback = null }
  }, [])

  // Mobile layout + sidebar visibility
  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)')
    const sync = () => {
      setIsMobileLayout(media.matches)
      if (!media.matches) setMobileSidebarOpen(false)
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (isMobileLayout && activeBuffer === 'devtools') {
      setActiveBuffer('agent')
    }
  }, [isMobileLayout, activeBuffer])

  useEffect(() => {
    if (!isMobileLayout || !window.visualViewport) {
      document.documentElement.style.setProperty('--keyboard-offset', '0px')
      return
    }

    const updateKeyboardOffset = () => {
      const viewport = window.visualViewport
      if (!viewport) return
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      document.documentElement.style.setProperty('--keyboard-offset', `${Math.round(offset)}px`)
    }

    updateKeyboardOffset()
    window.visualViewport.addEventListener('resize', updateKeyboardOffset)
    window.visualViewport.addEventListener('scroll', updateKeyboardOffset)

    return () => {
      window.visualViewport?.removeEventListener('resize', updateKeyboardOffset)
      window.visualViewport?.removeEventListener('scroll', updateKeyboardOffset)
      document.documentElement.style.setProperty('--keyboard-offset', '0px')
    }
  }, [isMobileLayout])

  useSwipeSidebar({
    isMobileLayout,
    mobileSidebarOpen,
    setMobileSidebarOpen,
  })

  // Sync state to window (HMR) and localStorage
  useEffect(() => {
    _w.__hmrAppState = {
      sessions,
      activeSessionId,
      model,
      providers,
      streamingSessions: [...streamingSessions],
      hasAnthropicKey,
      hasOAuthCreds,
      hasOpenAIOAuthCreds,
      hasVertexConfig,
      hasOpenAIKey,
    } satisfies HmrAppState
    if (model) localStorage.setItem('moa_selected_model', model)
    if (activeSessionId) localStorage.setItem('moa_active_session', activeSessionId)
    if (activeTerminalTabId) localStorage.setItem('moa_active_terminal_tab', activeTerminalTabId)
    if (activeBrowserTabId) localStorage.setItem('moa_active_browser_tab', activeBrowserTabId)
  }, [sessions, activeSessionId, model, providers, streamingSessions, hasAnthropicKey, hasOAuthCreds, hasOpenAIOAuthCreds, hasVertexConfig, hasOpenAIKey, activeTerminalTabId, activeBrowserTabId])

  // Log session switches to the action logger (skip initial mount)
  const prevSessionRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevSessionRef.current !== null && activeSessionId !== prevSessionRef.current) {
      logAction('session.switched', {
        fromSessionId: prevSessionRef.current,
        toSessionId: activeSessionId,
      }, { actor: 'user' })
    }
    prevSessionRef.current = activeSessionId
  }, [activeSessionId])

  // Log model changes to the action logger (skip initial mount)
  const prevModelRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevModelRef.current !== null && model !== prevModelRef.current) {
      logAction('model.changed', {
        from: prevModelRef.current,
        to: model,
      }, { actor: 'user' })
    }
    prevModelRef.current = model
  }, [model])

  // Load initial state
  useEffect(() => {
    dbReadyPromise.then(async () => {
      await runtimePackService.initialize()
      loadSessions()
      loadProviders()
      loadTerminalTabs()
      loadBrowserTabs()

      // Check Anthropic API key
      const savedKey = localStorage.getItem('anthropic_key')
      if (savedKey) setHasAnthropicKey(true)

      // Check OpenAI API key
      const savedOpenAIKey = localStorage.getItem('openai_key')
      if (savedOpenAIKey) setHasOpenAIKey(true)

      // Check OAuth credentials
      const oauthCreds = await db.getOAuthCredentials('anthropic')
      if (oauthCreds) setHasOAuthCreds(true)

      const openaiOauthCreds = await db.getOAuthCredentials('openai')
      if (openaiOauthCreds) setHasOpenAIOAuthCreds(true)

      // Check Google OAuth credentials (for Vertex AI)
      const googleCreds = await db.getOAuthCredentials('google')
      if (googleCreds) {
        setHasGoogleOAuth(true)
        // If we have Google OAuth but no Vertex config, set it up
        if (!localStorage.getItem('vertex_project')) {
          // Project is stored separately in localStorage
          const savedProject = localStorage.getItem('vertex_project')
          if (savedProject) setVertexProject(savedProject)
        }
      }

      // Restore model selection
      const persistedModel = localStorage.getItem('moa_selected_model')
      if (persistedModel) setModel(prev => prev || persistedModel)
    })
  }, [])

  // Auto-create session if no sessions exist
  useEffect(() => {
    if (sessions.length === 0 && !activeSessionId) {
      // Small delay to ensure DB is ready and we're not in a race
      const timer = setTimeout(() => {
         createSession()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [sessions.length, activeSessionId])

  // Auto-attach configured model to model-less sessions
  useEffect(() => {
    if (!model) return

    const attach = async () => {
      const modelLessSessions = sessions.filter(s => !s.model)
      if (modelLessSessions.length === 0) return

      for (const s of modelLessSessions) {
        await db.updateSession(s.id, { model })
      }

      setSessions(prev => prev.map(s => (!s.model ? { ...s, model } : s)))

      if (activeSessionId && modelLessSessions.some(s => s.id === activeSessionId)) {
        await sessionStore.initSession(activeSessionId, model)
      }
    }

    attach().catch(console.error)
  }, [model, sessions, activeSessionId])

  // Sync model to current session's DB record when model changes
  // The model is global — when the user picks a model it applies everywhere going forward.
  // We store it on the session as metadata (what model was used), not as a setting to restore.
  useEffect(() => {
    if (model && activeSessionId) {
      db.updateSession(activeSessionId, { model }).catch(console.error)
    }
  }, [model, activeSessionId])

  // Check Vertex AI ADC status and auto-populate project + location from gcloud config.
  // This only runs in Electron where the filesystem is accessible.
  // When ADC + project + location are all detected, auto-connect without user interaction.
  useEffect(() => {
    if (getPlatform().type === 'browser') {
      setVertexAdcStatus('unknown')
      return
    }

    try {
      const platform = getPlatform()
      const home = platform.process.homedir()
      const adcPath = platform.path.join(home, '.config', 'gcloud', 'application_default_credentials.json')

      if (!platform.fs.existsSync(adcPath)) {
        setVertexAdcStatus('missing')
        return
      }
      setVertexAdcStatus('found')

      let detectedProject = vertexProject
      let detectedLocation = vertexLocation

      // Auto-populate project ID if not already set
      if (!detectedProject) {
        // 1. Try ADC file (quota_project_id for user creds, project_id for service accounts)
        try {
          const adcData = JSON.parse(platform.fs.readFileSync(adcPath, 'utf-8'))
          detectedProject = adcData.quota_project_id || adcData.project_id || ''
        } catch { /* ignore parse errors */ }

        // 2. Fallback: read gcloud properties
        if (!detectedProject) {
          try {
            const propsPath = platform.path.join(home, '.config', 'gcloud', 'properties')
            if (platform.fs.existsSync(propsPath)) {
              const props: string = platform.fs.readFileSync(propsPath, 'utf-8')
              const match = props.match(/^\s*project\s*=\s*(.+)$/m)
              if (match?.[1]?.trim()) detectedProject = match[1].trim()
            }
          } catch { /* ignore */ }
        }

        // 3. Fallback: read gcloud active configuration
        if (!detectedProject) {
          try {
            const activeConfigPath = platform.path.join(home, '.config', 'gcloud', 'configurations', 'config_default')
            if (platform.fs.existsSync(activeConfigPath)) {
              const config: string = platform.fs.readFileSync(activeConfigPath, 'utf-8')
              const match = config.match(/^\s*project\s*=\s*(.+)$/m)
              if (match?.[1]?.trim()) detectedProject = match[1].trim()
            }
          } catch { /* ignore */ }
        }

        if (detectedProject) setVertexProject(detectedProject)
      }

      // Auto-populate location if not already set
      if (!detectedLocation) {
        // 1. Try gcloud properties (compute/region)
        try {
          const propsPath = platform.path.join(home, '.config', 'gcloud', 'properties')
          if (platform.fs.existsSync(propsPath)) {
            const props: string = platform.fs.readFileSync(propsPath, 'utf-8')
            const match = props.match(/^\s*region\s*=\s*(.+)$/m)
            if (match?.[1]?.trim()) detectedLocation = match[1].trim()
          }
        } catch { /* ignore */ }

        // 2. Try gcloud active configuration
        if (!detectedLocation) {
          try {
            const activeConfigPath = platform.path.join(home, '.config', 'gcloud', 'configurations', 'config_default')
            if (platform.fs.existsSync(activeConfigPath)) {
              const config: string = platform.fs.readFileSync(activeConfigPath, 'utf-8')
              const match = config.match(/^\s*region\s*=\s*(.+)$/m)
              if (match?.[1]?.trim()) detectedLocation = match[1].trim()
            }
          } catch { /* ignore */ }
        }

        // 3. Default to us-central1 (Gemini models available everywhere)
        if (!detectedLocation) detectedLocation = 'us-central1'

        setVertexLocation(detectedLocation)
      }

      // Auto-connect if we have everything and not already connected
      if (detectedProject && detectedLocation && !hasVertexConfig) {
        localStorage.setItem('vertex_project', detectedProject)
        localStorage.setItem('vertex_location', detectedLocation)
        setHasVertexConfig(true)
        if (!model) {
          const firstModel = vertexModels[0]
          if (firstModel) setModel(`vertex:${firstModel.id}`)
        }
      }
    } catch {
      setVertexAdcStatus('unknown')
    }
  }, [showSettings])

  async function loadProviders() {
    try {
      const provs = await db.listProviders()
      if (Array.isArray(provs)) {
        setProviders(provs.filter(p => p && p.name !== 'Anthropic'))
      } else {
        setProviders([])
      }
    } catch (e) {
      console.error('Failed to load providers:', e)
      setProviders([])
    }
  }

  // ── Anthropic API Key ──

  async function saveAnthropicKey() {
    if (!anthropicKey.trim()) {
      setSettingsError('API key is required')
      return
    }
    try {
      saveToLocalStorageVerified('anthropic_key', anthropicKey.trim())
      setHasAnthropicKey(true)
      setAnthropicKey('')
      setSettingsError('')
      if (!model) {
        const firstModel = anthropicModels[0]
        if (firstModel) setModel(`anthropic-key:${firstModel.id}`)
      }
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to save API key')
    }
  }

  function clearAnthropicKey() {
    localStorage.removeItem('anthropic_key')
    setHasAnthropicKey(false)
    if (model.startsWith('anthropic-key:')) setModel('')
  }

  // ── OpenAI API Key ──

  async function saveOpenAIKey() {
    if (!openaiKey.trim()) {
      setSettingsError('API key is required')
      return
    }
    try {
      saveToLocalStorageVerified('openai_key', openaiKey.trim())
      setHasOpenAIKey(true)
      setOpenaiKey('')
      setSettingsError('')
      if (!model) {
        setModel('openai:gpt-4o')
      }
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to save API key')
    }
  }

  function clearOpenAIKey() {
    localStorage.removeItem('openai_key')
    setHasOpenAIKey(false)
    if (model.startsWith('openai:')) setModel('')
  }

  // ── Anthropic OAuth (Plan) ──

  async function startOAuthLogin() {
    if (isE2EMockOAuth()) {
      setOauthLoading(false)
      setOauthError('')
      setOauthAuthUrl('mock://anthropic-oauth')
      setOauthCode('')
      return
    }
    setOauthLoading(true)
    setOauthError('')
    setOauthAuthUrl('')
    setOauthCode('')
    clearPendingOAuthResolvers('Starting new OAuth login')
    try {
      const provider = anthropicOAuthProvider
      if (!provider) throw new Error('Anthropic OAuth provider not available')

      const creds = await provider.login({
        onAuth: (info) => {
          setOauthAuthUrl(info.url)
          // Open URL via platform abstraction (works in both Electron and browser)
          getPlatform().shell.openExternal(info.url)
        },
        onPrompt: async () => {
          return new Promise<string>((resolve, reject) => {
            openaiOauthCodeResolverRef.current = null
            oauthCodeResolverRef.current = { resolve, reject }
            anthropicOAuthBridgeRef.current.attachResolver({ resolve, reject })
          })
        },
        onManualCodeInput: async () => {
          // Wait for user to paste the code
          return new Promise<string>((resolve, reject) => {
            openaiOauthCodeResolverRef.current = null
            oauthCodeResolverRef.current = { resolve, reject }
            anthropicOAuthBridgeRef.current.attachResolver({ resolve, reject })
          })
        },
      })

      await db.setOAuthCredentials('anthropic', creds)
      if (!isMountedRef.current) return
      setHasOAuthCreds(true)
      setOauthAuthUrl('')
      oauthCodeResolverRef.current = null
      if (!model) {
        const firstModel = anthropicModels[0]
        if (firstModel) setModel(`anthropic-oauth:${firstModel.id}`)
      }
    } catch (e: any) {
      if (!isMountedRef.current) return
      setOauthError(e.message || 'OAuth login failed')
      setOauthAuthUrl('')
      oauthCodeResolverRef.current = null
    } finally {
      if (isMountedRef.current) setOauthLoading(false)
    }
  }

  function submitOAuthCode() {
    if (isE2EMockOAuth() && oauthCode.trim()) {
      setHasOAuthCreds(true)
      setOauthAuthUrl('')
      setOauthCode('')
      setOauthError('')
      return
    }
    if (oauthCode.trim()) {
      const result = anthropicOAuthBridgeRef.current.submitCode(normalizeAnthropicOAuthInput(oauthCode))
      setOauthCode('')
      if (result.accepted) {
        oauthCodeResolverRef.current = null
        setOauthError('')
      } else if (result.queued) {
        setOauthError('Login still initializing. Code queued and will submit automatically.')
      }
    }
  }

  async function clearOAuthCreds() {
    await db.removeOAuthCredentials('anthropic')
    setHasOAuthCreds(false)
    if (model.startsWith('anthropic-oauth:')) setModel('')
  }

  // ── OpenAI OAuth (Plan) ──

  async function startOpenAIOAuthLogin() {
    if (isE2EMockOAuth()) {
      setOpenaiOauthLoading(false)
      setOpenaiOauthError('')
      setOpenaiOauthAuthUrl('mock://openai-oauth')
      setOpenaiOauthCode('')
      return
    }
    setOpenaiOauthLoading(true)
    setOpenaiOauthError('')
    setOpenaiOauthAuthUrl('')
    setOpenaiOauthCode('')
    clearPendingOAuthResolvers('Starting new OAuth login')
    try {
      const provider = openaiCodexOAuthProvider
      if (!provider) throw new Error('OpenAI OAuth provider not available')

      const creds = await provider.login({
        onAuth: (info) => {
          setOpenaiOauthAuthUrl(info.url)
          getPlatform().shell.openExternal(info.url)
        },
        onPrompt: async () => {
          return new Promise<string>((resolve, reject) => {
            oauthCodeResolverRef.current = null
            openaiOauthCodeResolverRef.current = { resolve, reject }
            openaiOAuthBridgeRef.current.attachResolver({ resolve, reject })
          })
        },
        onManualCodeInput: async () => {
          return new Promise<string>((resolve, reject) => {
            oauthCodeResolverRef.current = null
            openaiOauthCodeResolverRef.current = { resolve, reject }
            openaiOAuthBridgeRef.current.attachResolver({ resolve, reject })
          })
        },
      })

      await db.setOAuthCredentials('openai', creds)
      if (!isMountedRef.current) return
      setHasOpenAIOAuthCreds(true)
      setOpenaiOauthAuthUrl('')
      openaiOauthCodeResolverRef.current = null
      if (!model) {
        setModel('openai-oauth:gpt-5')
      }
    } catch (e: any) {
      if (!isMountedRef.current) return
      setOpenaiOauthError(e.message || 'OAuth login failed')
      setOpenaiOauthAuthUrl('')
      openaiOauthCodeResolverRef.current = null
    } finally {
      if (isMountedRef.current) setOpenaiOauthLoading(false)
    }
  }

  function submitOpenAIOAuthCode() {
    if (isE2EMockOAuth() && openaiOauthCode.trim()) {
      setHasOpenAIOAuthCreds(true)
      setOpenaiOauthAuthUrl('')
      setOpenaiOauthCode('')
      setOpenaiOauthError('')
      return
    }
    if (openaiOauthCode.trim()) {
      const result = openaiOAuthBridgeRef.current.submitCode(openaiOauthCode)
      setOpenaiOauthCode('')
      if (result.accepted) {
        openaiOauthCodeResolverRef.current = null
        setOpenaiOauthError('')
      } else if (result.queued) {
        setOpenaiOauthError('Login still initializing. Code queued and will submit automatically.')
      }
    }
  }

  async function clearOpenAIOAuthCreds() {
    await db.removeOAuthCredentials('openai')
    setHasOpenAIOAuthCreds(false)
    if (model.startsWith('openai-oauth:')) setModel('')
  }

  // ── Vertex AI ──

  function saveVertexConfig() {
    if (!vertexProject.trim() || !vertexLocation.trim()) {
      setSettingsError('Project and Location are required')
      return
    }
    try {
      saveToLocalStorageVerified('vertex_project', vertexProject.trim())
      saveToLocalStorageVerified('vertex_location', vertexLocation.trim())
      setHasVertexConfig(true)
      setSettingsError('')
      if (!model) {
        const firstModel = vertexModels[0]
        if (firstModel) setModel(`vertex:${firstModel.id}`)
      }
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to save Vertex config')
    }
  }

  function clearVertexConfig() {
    localStorage.removeItem('vertex_project')
    localStorage.removeItem('vertex_location')
    setHasVertexConfig(false)
    setHasGoogleOAuth(false)
    db.removeOAuthCredentials('google')
    if (model.startsWith('vertex:')) setModel('')
  }

  // ── Vertex AI Express ──

  function saveVertexExpressKey() {
    if (!vertexExpressKey.trim()) {
      setSettingsError('API key is required')
      return
    }
    try {
      saveToLocalStorageVerified('vertex_express_api_key', vertexExpressKey.trim())
      setHasVertexExpressKey(true)
      setVertexExpressKey('')
      setSettingsError('')
      if (!model) {
        const firstModel = vertexModels[0]
        if (firstModel) setModel(`vertex-express:${firstModel.id}`)
      }
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to save Vertex API key')
    }
  }

  function clearVertexExpressKey() {
    localStorage.removeItem('vertex_express_api_key')
    setHasVertexExpressKey(false)
    if (model.startsWith('vertex-express:')) setModel('')
  }

  // ── Google OAuth (for Vertex AI without gcloud) ──

  async function startGoogleOAuthLogin() {
    if (!googleOAuthConfig) {
      setGoogleOAuthError('Google OAuth not configured — set VITE_GOOGLE_OAUTH_CLIENT_ID and VITE_GOOGLE_OAUTH_CLIENT_SECRET in .env')
      return
    }
    setGoogleOAuthLoading(true)
    setGoogleOAuthError('')
    setGoogleOAuthUrl('')
    setGoogleOAuthCode('')
    try {
      const { url } = await buildAuthUrl(googleOAuthConfig)
      setGoogleOAuthUrl(url)
      getPlatform().shell.openExternal(url)
    } catch (e: any) {
      setGoogleOAuthError(e.message || 'Failed to start Google OAuth')
      setGoogleOAuthLoading(false)
    }
  }

  async function submitGoogleOAuthCode() {
    if (!googleOAuthConfig || !googleOAuthCode.trim()) return
    try {
      const tokens = await exchangeCode(googleOAuthConfig, googleOAuthCode.trim())

      // Store tokens
      await db.setOAuthCredentials('google', {
        refresh: tokens.refresh_token,
        access: tokens.access_token,
        expires: tokens.expires_at,
      })
      setHasGoogleOAuth(true)

      // List projects and auto-populate
      try {
        const projects = await listProjects(tokens.access_token)
        setGoogleProjects(projects)
        if (projects.length === 1) {
          // Only one project, auto-select it
          setVertexProject(projects[0].projectId)
        } else if (projects.length > 0 && !vertexProject) {
          setVertexProject(projects[0].projectId)
        }
      } catch (e) {
        console.error('Failed to list projects:', e)
        // Non-fatal — user can still type project ID manually
      }

      // Default location
      if (!vertexLocation) setVertexLocation('us-central1')

      setGoogleOAuthLoading(false)
      setGoogleOAuthUrl('')
      setGoogleOAuthCode('')
    } catch (e: any) {
      setGoogleOAuthError(e.message || 'Failed to exchange code')
      setGoogleOAuthLoading(false)
    }
  }

  async function finalizeGoogleOAuthSetup() {
    if (!vertexProject.trim()) {
      setGoogleOAuthError('Select a project')
      return
    }
    const loc = vertexLocation.trim() || 'us-central1'
    localStorage.setItem('vertex_project', vertexProject.trim())
    localStorage.setItem('vertex_location', loc)
    localStorage.setItem('vertex_auth_method', 'google-oauth')
    setVertexLocation(loc)
    setHasVertexConfig(true)
    setGoogleOAuthError('')
    if (!model) {
      const firstModel = vertexModels[0]
      if (firstModel) setModel(`vertex:${firstModel.id}`)
    }
  }

  // ── Custom Providers ──

  async function addCustomProvider() {
    if (!newName.trim() || !newBaseUrl.trim()) {
      setAddError('Name and Base URL are required')
      return
    }
    setAddError('')
    try {
      const provider = await db.addProvider(newName.trim(), newBaseUrl.trim(), newApiKey.trim())
      const updated = [...providers, provider]
      setProviders(updated)
      setNewName('')
      setNewBaseUrl('')
      setNewApiKey('')
    } catch (e: any) {
      setAddError(e.message || 'Failed to add provider')
    }
  }

  async function removeCustomProvider(id: string) {
    try {
      await db.removeProvider(id)
      setProviders(providers.filter(p => p.id !== id))
      if (model.startsWith(id + ':')) setModel('')
    } catch (e) {
      console.error('Failed to remove provider:', e)
    }
  }

  // ── Sessions ──

  async function loadSessions() {
    try {
      const loaded = await db.listSessions()
      setSessions(loaded)
      setActiveSessionId(prev => {
        if (prev && loaded.some(s => s.id === prev)) return prev
        const saved = localStorage.getItem('moa_active_session')
        if (saved && loaded.some(s => s.id === saved)) return saved
        return loaded.length > 0 ? loaded[0].id : null
      })
    } catch (e) {
      console.error('Failed to load sessions:', e)
    }
  }

  async function createSession() {
    try {
      const newSession = await db.createSession(model)
      setSessions([newSession, ...sessions])
      setActiveSessionId(newSession.id)
      logAction('session.created', { sessionId: newSession.id, title: newSession.title, model }, { actor: 'user' })
    } catch (e) {
      console.error('Failed to create session:', e)
    }
  }

  async function deleteSession(id: string) {
    try {
      agentService.destroyAgent(id)
      await db.removeSession(id)
      const updated = sessions.filter(s => s.id !== id)
      setSessions(updated)
      if (activeSessionId === id) {
        setActiveSessionId(updated.length > 0 ? updated[0].id : null)
      }
    } catch (e) {
      console.error('Failed to delete session:', e)
    }
  }

  // ── Tab Pin/Unpin/Reorder (Sessions) ──

  async function pinSession(id: string) {
    // Place newly pinned tab at the bottom of the pinned section
    const pinnedSessions = sessions.filter(s => s.pinned)
    const maxPinnedOrder = pinnedSessions.length > 0
      ? Math.max(...pinnedSessions.map(s => s.sortOrder))
      : -1
    await db.updateSession(id, { pinned: true, sortOrder: maxPinnedOrder + 1 })
    await loadSessions()
  }

  async function unpinSession(id: string) {
    await db.updateSession(id, { pinned: false })
    await loadSessions()
  }

  async function reorderSessions(fromIndex: number, toIndex: number) {
    const reordered = [...sessions]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    // Recalculate sortOrder for all
    for (let i = 0; i < reordered.length; i++) {
      await db.updateSession(reordered[i].id, { sortOrder: i })
    }
    await loadSessions()
  }

  // ── Terminal Tabs ──

  async function loadTerminalTabs() {
    try {
      const tabs = await db.listTerminalTabs()
      setTerminalTabs(tabs)
      // Auto-create first terminal tab if none exist
      if (tabs.length === 0) {
        const tab = await db.createTerminalTab('New Thread')
        setTerminalTabs([tab])
        setActiveTerminalTabId(tab.id)
      } else {
        setActiveTerminalTabId(prev => {
          if (prev && tabs.some(t => t.id === prev)) return prev
          return tabs[0]?.id || null
        })
      }
    } catch (e) {
      console.error('Failed to load terminal tabs:', e)
    }
  }

  async function createTerminalTab() {
    const tab = await db.createTerminalTab('New Thread')
    setTerminalTabs(prev => [...prev, tab])
    setActiveTerminalTabId(tab.id)
    setActiveBuffer('terminal')
  }

  async function deleteTerminalTab(id: string) {
    await db.removeTerminalTab(id)
    const updated = terminalTabs.filter(t => t.id !== id)
    setTerminalTabs(updated)
    if (activeTerminalTabId === id) {
      setActiveTerminalTabId(updated[0]?.id || null)
    }
  }

  async function pinTerminalTab(id: string) {
    // Place newly pinned tab at the bottom of the pinned section
    const pinnedTabs = terminalTabs.filter(t => t.pinned)
    const maxPinnedOrder = pinnedTabs.length > 0
      ? Math.max(...pinnedTabs.map(t => t.sortOrder))
      : -1
    await db.updateTerminalTab(id, { pinned: true, sortOrder: maxPinnedOrder + 1 })
    await loadTerminalTabs()
  }

  async function unpinTerminalTab(id: string) {
    await db.updateTerminalTab(id, { pinned: false })
    await loadTerminalTabs()
  }

  async function reorderTerminalTabs(fromIndex: number, toIndex: number) {
    const reordered = [...terminalTabs]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    for (let i = 0; i < reordered.length; i++) {
      await db.updateTerminalTab(reordered[i].id, { sortOrder: i })
    }
    await loadTerminalTabs()
  }

  // ── Browser Tabs ──

  async function loadBrowserTabs() {
    try {
      const tabs = await db.listBrowserTabs()
      setBrowserTabs(tabs)
      if (tabs.length === 0) {
        const tab = await db.createBrowserTab('New Tab')
        setBrowserTabs([tab])
        setActiveBrowserTabId(tab.id)
      } else {
        setActiveBrowserTabId(prev => {
          if (prev && tabs.some(t => t.id === prev)) return prev
          return tabs[0]?.id || null
        })
      }
    } catch (e) {
      console.error('Failed to load browser tabs:', e)
    }
  }

  async function createBrowserTab() {
    const tab = await db.createBrowserTab('New Tab')
    setBrowserTabs(prev => [...prev, tab])
    setActiveBrowserTabId(tab.id)
    setActiveBuffer('browser')
  }

  async function deleteBrowserTab(id: string) {
    await db.removeBrowserTab(id)
    const updated = browserTabs.filter(t => t.id !== id)
    setBrowserTabs(updated)
    if (activeBrowserTabId === id) {
      setActiveBrowserTabId(updated[0]?.id || null)
    }
  }

  async function pinBrowserTab(id: string) {
    // Place newly pinned tab at the bottom of the pinned section
    const pinnedTabs = browserTabs.filter(t => t.pinned)
    const maxPinnedOrder = pinnedTabs.length > 0
      ? Math.max(...pinnedTabs.map(t => t.sortOrder))
      : -1
    await db.updateBrowserTab(id, { pinned: true, sortOrder: maxPinnedOrder + 1 })
    await loadBrowserTabs()
  }

  async function unpinBrowserTab(id: string) {
    await db.updateBrowserTab(id, { pinned: false })
    await loadBrowserTabs()
  }

  async function reorderBrowserTabs(fromIndex: number, toIndex: number) {
    const reordered = [...browserTabs]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    for (let i = 0; i < reordered.length; i++) {
      await db.updateBrowserTab(reordered[i].id, { sortOrder: i })
    }
    await loadBrowserTabs()
  }

  async function updateTerminalTabTitle(id: string, title: string) {
    await db.updateTerminalTab(id, { title })
    setTerminalTabs(prev => prev.map(t => t.id === id ? { ...t, title } : t))
  }

  async function updateBrowserTabTitle(id: string, title: string) {
    await db.updateBrowserTab(id, { title })
    setBrowserTabs(prev => prev.map(t => t.id === id ? { ...t, title } : t))
  }

  // ── Carousel Tab Adapters ──

  const agentCarouselTabs: CarouselTab[] = useMemo(() =>
    sessions.map(s => ({
      id: s.id,
      title: s.title || 'New Chat',
      pinned: s.pinned,
      sortOrder: s.sortOrder,
      isStreaming: streamingSessions.has(s.id),
    })),
    [sessions, streamingSessions]
  )

  const terminalCarouselTabs: CarouselTab[] = useMemo(() =>
    terminalTabs.map(t => ({
      id: t.id,
      title: t.title,
      pinned: t.pinned,
      sortOrder: t.sortOrder,
    })),
    [terminalTabs]
  )

  const browserCarouselTabs: CarouselTab[] = useMemo(() =>
    browserTabs.map(t => ({
      id: t.id,
      title: t.title,
      pinned: t.pinned,
      sortOrder: t.sortOrder,
      url: t.url,
    })),
    [browserTabs]
  )

  const onStreamingChange = useCallback((sessionId: string, streaming: boolean) => {
    setStreamingSessions(prev => {
      const next = new Set(prev)
      if (streaming) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }, [])

  const hasAnyProvider = hasAnthropicKey || hasOAuthCreds || hasOpenAIOAuthCreds || hasVertexConfig || hasVertexExpressKey || hasOpenAIKey || providers.length > 0

  const vertexProjectOptions = useMemo(() => {
    const options = googleProjects.map((p) => ({
      value: p.projectId,
      label: ('displayName' in p && typeof p.displayName === 'string' ? p.displayName : p.projectId) || p.projectId,
    }))
    if (vertexProject && !options.some((o) => o.value === vertexProject)) {
      options.unshift({ value: vertexProject, label: vertexProject })
    }
    return options
  }, [googleProjects, vertexProject])

  // Helper to format model display name
  function modelDisplayName(m: Model<any>): string {
    return m.name || m.id.replace('claude-', '').replace(/-20\d{6}.*/, '')
  }

  const canPasteFromClipboard = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'

  function saveToLocalStorageVerified(key: string, value: string) {
    localStorage.setItem(key, value)
    const saved = localStorage.getItem(key)
    if (saved !== value) {
      throw new Error(`Failed to persist ${key}`)
    }
  }

  function openCommandPalette(mode: 'commands' | 'models') {
    setCommandPaletteInitialMode(mode)
    setCommandPaletteOpen(true)
  }

  function normalizeAnthropicOAuthInput(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) return ''

    try {
      const url = new URL(trimmed)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (code && state) return `${code}#${state}`
      if (code) return code
    } catch {
      // Not a URL
    }

    if (trimmed.includes('code=')) {
      const params = new URLSearchParams(trimmed)
      const code = params.get('code')
      const state = params.get('state')
      if (code && state) return `${code}#${state}`
      if (code) return code
    }

    return trimmed
  }

  function closeCommandPalette() {
    setCommandPaletteOpen(false)
    setCommandPaletteInitialMode('commands')
  }

  async function pasteCodeFromClipboard(
    setCode: (value: string) => void,
    setError: (value: string) => void,
  ) {
    if (!canPasteFromClipboard) {
      setError('Clipboard paste is unavailable on this device')
      return
    }
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) setCode(text.trim())
    } catch {
      setError('Clipboard read failed. Paste manually instead.')
    }
  }

  // Build flat model list for command palette
  const availableModels = useMemo(() => {
    const models: { value: string; label: string; group: string }[] = []
    if (hasAnthropicKey) {
      for (const m of anthropicModels) {
        models.push({ value: `anthropic-key:${m.id}`, label: modelDisplayName(m), group: 'Anthropic (API Key)' })
      }
    }
    if (hasOAuthCreds) {
      for (const m of anthropicModels) {
        models.push({ value: `anthropic-oauth:${m.id}`, label: modelDisplayName(m), group: 'Anthropic (Plan)' })
      }
    }
    if (hasVertexConfig) {
      for (const m of vertexModels) {
        models.push({ value: `vertex:${m.id}`, label: modelDisplayName(m), group: 'Vertex AI (ADC/OAuth)' })
      }
    }
    if (hasVertexExpressKey) {
      for (const m of vertexModels) {
        models.push({ value: `vertex-express:${m.id}`, label: modelDisplayName(m), group: 'Vertex AI (Express)' })
      }
    }
    if (hasOpenAIKey) {
      models.push({ value: 'openai:gpt-4o', label: 'GPT-4o', group: 'OpenAI' })
      models.push({ value: 'openai:gpt-4o-mini', label: 'GPT-4o Mini', group: 'OpenAI' })
      models.push({ value: 'openai:gpt-4-turbo', label: 'GPT-4 Turbo', group: 'OpenAI' })
      models.push({ value: 'openai:o1', label: 'o1', group: 'OpenAI' })
      models.push({ value: 'openai:o1-mini', label: 'o1 Mini', group: 'OpenAI' })
      models.push({ value: 'openai:o3-mini', label: 'o3 Mini', group: 'OpenAI' })
    }
    if (hasOpenAIOAuthCreds) {
      models.push({ value: 'openai-oauth:gpt-5', label: 'GPT-5', group: 'OpenAI (Plan)' })
      models.push({ value: 'openai-oauth:gpt-5-mini', label: 'GPT-5 Mini', group: 'OpenAI (Plan)' })
      models.push({ value: 'openai-oauth:gpt-4.1', label: 'GPT-4.1', group: 'OpenAI (Plan)' })
    }
    for (const p of providers) {
      models.push({ value: `${p.id}:provider-model`, label: p.name, group: 'Custom' })
    }
    return models
  }, [hasAnthropicKey, hasOAuthCreds, hasOpenAIOAuthCreds, hasVertexConfig, hasVertexExpressKey, hasOpenAIKey, anthropicModels, vertexModels, providers])

  // Check if current session is streaming
  const isCurrentSessionStreaming = !!(activeSessionId && streamingSessions.has(activeSessionId))

  // Rename session handler
  async function renameSession(id: string, newTitle: string) {
    try {
      await db.updateSession(id, { title: newTitle })
      await loadSessions()
    } catch (e) {
      console.error('Failed to rename session:', e)
    }
  }

  return (
    <div
      className={`app ${isMobileLayout ? 'mobile-layout' : ''} ${mobileSidebarOpen ? 'mobile-sidebar-open' : ''}`}
    >
      {restartAvailable && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: '#1a1a2e', borderBottom: '1px solid #4a4aff',
          padding: '6px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', fontSize: '13px', color: '#e0e0e0',
        }}>
          <span>Main process updated. Restart to apply changes.</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setRestartAvailable(false)}
              style={{ background: 'none', border: '1px solid #555', color: '#aaa', borderRadius: '4px', padding: '2px 10px', cursor: 'pointer', fontSize: '12px' }}
            >
              Dismiss
            </button>
            <button
              onClick={triggerRestart}
              style={{ background: '#4a4aff', border: 'none', color: '#fff', borderRadius: '4px', padding: '2px 10px', cursor: 'pointer', fontSize: '12px' }}
            >
              Restart Now
            </button>
          </div>
        </div>
      )}
      <CommandPalette
        isOpen={commandPaletteOpen}
        initialMode={commandPaletteInitialMode}
        onClose={closeCommandPalette}
        activeBuffer={activeBuffer}
        onSwitchBuffer={(buffer) => { setActiveBuffer(buffer); closeCommandPalette() }}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSwitchSession={(id) => { setActiveSessionId(id); setActiveBuffer('agent'); closeCommandPalette() }}
        onCreateSession={() => { createSession(); closeCommandPalette() }}
        onOpenSettings={() => { setShowSettings(true); closeCommandPalette() }}
        onOpenSettingsTab={(tab) => { setSettingsTab(tab); setShowSettings(true); closeCommandPalette() }}
        canCreateSession={true}
        onDeleteSession={(id) => { deleteSession(id); closeCommandPalette() }}
        onRenameSession={(id, title) => { renameSession(id, title); closeCommandPalette() }}
        currentModel={model}
        availableModels={availableModels}
        onSelectModel={(m) => { setModel(m); closeCommandPalette() }}
        onBrowserBack={() => window.dispatchEvent(new CustomEvent('moa:browser-command', { detail: { action: 'back' } }))}
        onBrowserForward={() => window.dispatchEvent(new CustomEvent('moa:browser-command', { detail: { action: 'forward' } }))}
        onBrowserReload={() => window.dispatchEvent(new CustomEvent('moa:browser-command', { detail: { action: 'reload' } }))}
        onBrowserFocusUrl={() => window.dispatchEvent(new CustomEvent('moa:browser-command', { detail: { action: 'focus-url' } }))}
        onAgentClearInput={() => { if (activeSessionId) sessionStore.setInput(activeSessionId, '') }}
        onAgentStopGeneration={() => { if (activeSessionId) agentService.abort(activeSessionId) }}
        isStreaming={isCurrentSessionStreaming}
        terminalTabs={terminalTabs.map(t => ({ id: t.id, title: t.title }))}
        activeTerminalTabId={activeTerminalTabId}
        onSwitchTerminalTab={(id) => { setActiveTerminalTabId(id); setActiveBuffer('terminal'); closeCommandPalette() }}
        onCreateTerminalTab={() => { createTerminalTab(); closeCommandPalette() }}
        browserTabs={browserTabs.map(t => ({ id: t.id, title: t.title }))}
        activeBrowserTabId={activeBrowserTabId}
        onSwitchBrowserTab={(id) => { setActiveBrowserTabId(id); setActiveBuffer('browser'); closeCommandPalette() }}
        onCreateBrowserTab={() => { createBrowserTab(); closeCommandPalette() }}
        includeDevTools={!isMobileLayout}
      />
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <h1>MOA</h1>
            <button
              className="settings-btn"
              onClick={() => setShowSettings(!showSettings)}
              title="Provider Settings"
            >
              {showSettings ? '\u2715' : '\u2699'}
            </button>
          </div>
          {activeBuffer === 'agent' || activeBuffer === 'devtools' ? (
            <button onClick={createSession} className="new-session-btn">
              + New Chat
            </button>
          ) : activeBuffer === 'terminal' ? (
            <button onClick={createTerminalTab} className="new-session-btn">
              + New Terminal
            </button>
          ) : (
            <button onClick={createBrowserTab} className="new-session-btn">
              + New Browser
            </button>
          )}
        </div>

        {showSettings && (
          <div className="settings-panel">
            <div className="settings-provider-select">
              <Dropdown
                className="provider-dropdown"
                value={settingsTab}
                onChange={(v) => setSettingsTab(v as SettingsTab)}
                options={[
                  { value: 'anthropic', label: 'Anthropic' },
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'vertex', label: 'Vertex AI' },
                  { value: 'custom', label: 'Custom Provider' },
                ]}
              />
            </div>

            {settingsTab === 'anthropic' && (
              <div className="anthropic-setup">
                {/* Auth mode toggle */}
                <div className="auth-mode-toggle">
                  <button
                    className={`auth-mode-btn ${anthropicAuthMode === 'apikey' ? 'active' : ''}`}
                    onClick={() => {
                      resetAnthropicOAuthFlow('Switched to Anthropic API key mode')
                      setAnthropicAuthMode('apikey')
                    }}
                  >
                    API Key
                  </button>
                  <button
                    className={`auth-mode-btn ${anthropicAuthMode === 'oauth' ? 'active' : ''}`}
                    onClick={() => {
                      setSettingsError('')
                      setAnthropicAuthMode('oauth')
                    }}
                  >
                    Plan
                  </button>
                </div>

                {anthropicAuthMode === 'apikey' && (
                  <>
                    {!hasAnthropicKey ? (
                      <div className="api-key-form">
                        <p className="setup-hint">Enter your Anthropic API key</p>
                        <input
                          type="password"
                          placeholder="sk-ant-..."
                          value={anthropicKey}
                          onChange={e => setAnthropicKey(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && saveAnthropicKey()}
                        />
                        {settingsError && <p className="settings-error">{settingsError}</p>}
                        <button className="save-key-btn" onClick={saveAnthropicKey}>
                          Connect
                        </button>
                      </div>
                    ) : (
                      <div className="api-key-saved">
                        <p className="key-status">&#10003; Connected via API Key</p>
                        <button className="disconnect-btn" onClick={clearAnthropicKey}>
                          Disconnect
                        </button>
                      </div>
                    )}
                  </>
                )}

                {anthropicAuthMode === 'oauth' && (
                  <>
                    {!hasOAuthCreds ? (
                      <div className="oauth-flow">
                        <p className="setup-hint">Sign in with your Claude subscription</p>
                        {!oauthAuthUrl ? (
                          <>
                            <button
                              className="save-key-btn oauth-btn"
                              onClick={startOAuthLogin}
                              disabled={oauthLoading}
                            >
                              {oauthLoading ? 'Starting...' : 'Sign in with Claude'}
                            </button>
                            {oauthError && <p className="settings-error">{oauthError}</p>}
                          </>
                        ) : (
                          <div className="oauth-code-form">
                            <p className="setup-hint">
                              A browser window opened. Authorize the app, then paste the code, code#state, or full callback URL below.
                            </p>
                            <input
                              type="text"
                              placeholder="Paste the authorization code here (mobile: copy from browser app)"
                              value={oauthCode}
                              onChange={e => setOauthCode(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && submitOAuthCode()}
                              autoFocus
                            />
                            <button
                              className="add-provider-btn"
                              onClick={() => pasteCodeFromClipboard(setOauthCode, setOauthError)}
                              disabled={!canPasteFromClipboard}
                            >
                              Paste from clipboard
                            </button>
                            <button className="save-key-btn" onClick={submitOAuthCode} disabled={!oauthCode.trim()}>
                              Submit Code
                            </button>
                            <button
                              className="disconnect-btn"
                              onClick={() => resetAnthropicOAuthFlow('Anthropic OAuth flow reset by user')}
                            >
                              Start over
                            </button>
                            {oauthError && <p className="settings-error">{oauthError}</p>}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="api-key-saved">
                        <p className="key-status">&#10003; Connected via Plan</p>
                        <button className="disconnect-btn" onClick={clearOAuthCreds}>
                          Disconnect
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {settingsTab === 'openai' && (
              <div className="anthropic-setup">
                <div className="auth-mode-toggle">
                  <button
                    className={`auth-mode-btn ${openaiAuthMode === 'apikey' ? 'active' : ''}`}
                    onClick={() => {
                      resetOpenAIOAuthFlow('Switched to OpenAI API key mode')
                      setOpenaiAuthMode('apikey')
                    }}
                  >
                    API Key
                  </button>
                  <button
                    className={`auth-mode-btn ${openaiAuthMode === 'oauth' ? 'active' : ''}`}
                    onClick={() => {
                      setSettingsError('')
                      setOpenaiAuthMode('oauth')
                    }}
                  >
                    Plan
                  </button>
                </div>

                {openaiAuthMode === 'apikey' && (
                  <>
                    {!hasOpenAIKey ? (
                      <div className="api-key-form">
                        <p className="setup-hint">Enter your OpenAI API key</p>
                        <input
                          type="password"
                          placeholder="sk-..."
                          value={openaiKey}
                          onChange={e => setOpenaiKey(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && saveOpenAIKey()}
                        />
                        {settingsError && <p className="settings-error">{settingsError}</p>}
                        <button className="save-key-btn" onClick={saveOpenAIKey}>
                          Connect
                        </button>
                      </div>
                    ) : (
                      <div className="api-key-saved">
                        <p className="key-status">&#10003; Connected via API Key</p>
                        <button className="disconnect-btn" onClick={clearOpenAIKey}>
                          Disconnect
                        </button>
                      </div>
                    )}
                  </>
                )}

                {openaiAuthMode === 'oauth' && (
                  <>
                    {!hasOpenAIOAuthCreds ? (
                      <div className="oauth-flow">
                        <p className="setup-hint">Sign in with your ChatGPT subscription</p>
                        {!openaiOauthAuthUrl ? (
                          <>
                            <button
                              className="save-key-btn oauth-btn"
                              onClick={startOpenAIOAuthLogin}
                              disabled={openaiOauthLoading}
                            >
                              {openaiOauthLoading ? 'Starting...' : 'Sign in with ChatGPT'}
                            </button>
                            {openaiOauthError && <p className="settings-error">{openaiOauthError}</p>}
                          </>
                        ) : (
                          <div className="oauth-code-form">
                            <p className="setup-hint">A browser window opened. Authorize, then paste the code or full callback URL below.</p>
                            <input
                              type="text"
                              placeholder="Paste the authorization code here (mobile: copy from browser app)"
                              value={openaiOauthCode}
                              onChange={e => setOpenaiOauthCode(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && submitOpenAIOAuthCode()}
                              autoFocus
                            />
                            <button
                              className="add-provider-btn"
                              onClick={() => pasteCodeFromClipboard(setOpenaiOauthCode, setOpenaiOauthError)}
                              disabled={!canPasteFromClipboard}
                            >
                              Paste from clipboard
                            </button>
                            <button className="save-key-btn" onClick={submitOpenAIOAuthCode} disabled={!openaiOauthCode.trim()}>
                              Submit Code
                            </button>
                            <button
                              className="disconnect-btn"
                              onClick={() => resetOpenAIOAuthFlow('OpenAI OAuth flow reset by user')}
                            >
                              Start over
                            </button>
                            {openaiOauthError && <p className="settings-error">{openaiOauthError}</p>}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="api-key-saved">
                        <p className="key-status">&#10003; Connected via Plan</p>
                        <button className="disconnect-btn" onClick={clearOpenAIOAuthCreds}>
                          Disconnect
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {settingsTab === 'vertex' && (
              <div className="anthropic-setup">
                {!hasVertexExpressKey ? (
                  <>
                    <div className="api-key-form">
                      <p className="setup-hint">Gemini models via Vertex AI Express</p>
                      <p className="setup-hint" style={{ fontSize: '10px', opacity: 0.7, margin: 0 }}>
                        Same privacy guarantees as Vertex AI. No GCP project needed.
                      </p>
                      <input
                        type="password"
                        placeholder="Vertex AI API key"
                        value={vertexExpressKey}
                        onChange={e => setVertexExpressKey(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveVertexExpressKey()}
                      />
                      <button className="save-key-btn" onClick={saveVertexExpressKey} disabled={!vertexExpressKey.trim()}>
                        Save
                      </button>
                    </div>

                    {vertexProjectOptions.length > 0 && (
                      <div className="api-key-form">
                        <p className="setup-hint">Detected Google Cloud project</p>
                        <Dropdown
                          className="provider-dropdown"
                          value={vertexProject}
                          onChange={setVertexProject}
                          options={vertexProjectOptions}
                          placeholder="Select project"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="api-key-saved">
                    <p className="key-status">&#10003; Vertex AI configured</p>
                    <button className="disconnect-btn" onClick={clearVertexExpressKey}>
                      Remove Key
                    </button>
                  </div>
                )}
              </div>
            )}

            {settingsTab === 'custom' && (
              <div className="custom-providers">
                <div className="provider-list">
                  {providers.map(p => (
                    <div key={p.id} className="provider-item">
                      <div className="provider-info">
                        <span className="provider-name">{p.name}</span>
                        <span className="provider-url">{p.baseUrl}</span>
                      </div>
                      <button className="remove-btn" onClick={() => removeCustomProvider(p.id)}>
                        &times;
                      </button>
                    </div>
                  ))}
                </div>

                <div className="add-provider-form">
                  <p className="setup-hint">Add OpenAI-compatible provider</p>
                  <input
                    placeholder="Name (e.g. Ollama)"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                  />
                  <input
                    placeholder="Base URL (e.g. http://localhost:11434/v1)"
                    value={newBaseUrl}
                    onChange={e => setNewBaseUrl(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="API Key (optional)"
                    value={newApiKey}
                    onChange={e => setNewApiKey(e.target.value)}
                  />
                  {addError && <p className="settings-error">{addError}</p>}
                  <button className="add-provider-btn" onClick={addCustomProvider}>
                    Add Provider
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Contextual tab carousel based on active buffer */}
        {activeBuffer === 'agent' && (
          <SidebarCarousel
            panelType="agent"
            tabs={agentCarouselTabs}
            activeTabId={activeSessionId}
            onSelect={(id) => { setActiveSessionId(id); if (isMobileLayout) setMobileSidebarOpen(false) }}
            onPin={pinSession}
            onUnpin={unpinSession}
            onDelete={deleteSession}
            onReorder={reorderSessions}
            onCreate={createSession}
          />
        )}
        {activeBuffer === 'terminal' && (
          <SidebarCarousel
            panelType="terminal"
            tabs={terminalCarouselTabs}
            activeTabId={activeTerminalTabId}
            onSelect={(id) => { setActiveTerminalTabId(id); if (isMobileLayout) setMobileSidebarOpen(false) }}
            onPin={pinTerminalTab}
            onUnpin={unpinTerminalTab}
            onDelete={deleteTerminalTab}
            onReorder={reorderTerminalTabs}
            onCreate={createTerminalTab}
          />
        )}
        {activeBuffer === 'browser' && (
          <SidebarCarousel
            panelType="browser"
            tabs={browserCarouselTabs}
            activeTabId={activeBrowserTabId}
            onSelect={(id) => { setActiveBrowserTabId(id); if (isMobileLayout) setMobileSidebarOpen(false) }}
            onPin={pinBrowserTab}
            onUnpin={unpinBrowserTab}
            onDelete={deleteBrowserTab}
            onReorder={reorderBrowserTabs}
            onCreate={createBrowserTab}
          />
        )}
        {!isMobileLayout && activeBuffer === 'devtools' && (
          <SidebarCarousel
            panelType="agent"
            tabs={agentCarouselTabs}
            activeTabId={activeSessionId}
            onSelect={(id) => { setActiveSessionId(id); if (isMobileLayout) setMobileSidebarOpen(false) }}
            onPin={pinSession}
            onUnpin={unpinSession}
            onDelete={deleteSession}
            onReorder={reorderSessions}
            onCreate={createSession}
          />
        )}
      </div>

      {isMobileLayout && mobileSidebarOpen && (
        <button
          className="mobile-sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <div className="main">
        <div className="buffer-tabs desktop-only-tabs">
          <button
            className={`buffer-tab ${activeBuffer === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveBuffer('agent')}
          >
            Agent
          </button>
          <button
            className={`buffer-tab ${activeBuffer === 'terminal' ? 'active' : ''}`}
            onClick={() => setActiveBuffer('terminal')}
          >
            Terminal
          </button>
          <button
            className={`buffer-tab ${activeBuffer === 'browser' ? 'active' : ''}`}
            onClick={() => setActiveBuffer('browser')}
          >
            Browser
          </button>
          {!isMobileLayout && (
            <button
              className={`buffer-tab ${activeBuffer === 'devtools' ? 'active' : ''}`}
              onClick={() => setActiveBuffer('devtools')}
            >
              DevTools
            </button>
          )}
        </div>

        <div className="buffer-content">
          <div className={`buffer-pane${activeBuffer !== 'agent' ? ' hidden' : ''}`} style={activeBuffer === 'agent' ? { display: 'contents' } : undefined}>
            <ErrorBoundary name="Agent">
              {activeSessionId ? (
                <AgentBuffer
                  sessionId={activeSessionId}
                  model={model}
                  onSessionUpdate={loadSessions}
                  onStreamingChange={onStreamingChange}
                  onModelClick={() => openCommandPalette('models')}
                />
              ) : (
                <div className="empty-state">
                  <h2>No session selected</h2>
                  <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: '0 0 8px 0' }}>Start a new conversation to begin</p>
                  <button onClick={createSession}>New chat</button>
                </div>
              )}
            </ErrorBoundary>
          </div>
          <div className={`buffer-pane${activeBuffer !== 'terminal' ? ' hidden' : ''}`} style={activeBuffer === 'terminal' ? { display: 'flex', height: '100%', width: '100%' } : undefined}>
            <ErrorBoundary name="Terminal">
              <TerminalBuffer
                key={activeTerminalTabId || 'main-terminal'}
                id={activeTerminalTabId || 'main-terminal'}
                cwd={getPlatform().type === 'electron' ? getPlatform().process.cwd() : undefined}
                onTitleChange={(title) => {
                  if (activeTerminalTabId) updateTerminalTabTitle(activeTerminalTabId, title)
                }}
              />
            </ErrorBoundary>
          </div>
          <div className={`buffer-pane${activeBuffer !== 'browser' ? ' hidden' : ''}`} style={activeBuffer === 'browser' ? { display: 'flex', height: '100%', width: '100%' } : undefined}>
            <ErrorBoundary name="Browser">
              <BrowserBuffer
                id={activeBrowserTabId || 'main-browser'}
                isActive={activeBuffer === 'browser'}
                onTitleChange={(title) => {
                  if (activeBrowserTabId) updateBrowserTabTitle(activeBrowserTabId, title)
                }}
              />
            </ErrorBoundary>
          </div>
          {!isMobileLayout && (
            <div className={`buffer-pane${activeBuffer !== 'devtools' ? ' hidden' : ''}`} style={activeBuffer === 'devtools' ? { display: 'flex', height: '100%', width: '100%' } : undefined}>
              <ErrorBoundary name="DevTools">
                <DevToolsBuffer isActive={activeBuffer === 'devtools'} />
              </ErrorBoundary>
            </div>
          )}
        </div>

        {isMobileLayout && (
          <div className="mobile-bottom-overlay" role="toolbar" aria-label="Quick actions">
            <button
              className={`mobile-action-btn ${mobileSidebarOpen ? 'active' : ''}`}
              onClick={() => setMobileSidebarOpen(prev => !prev)}
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
            >
              {'\u2630'}
            </button>
            <button
              className={`mobile-action-btn ${activeBuffer === 'agent' ? 'active' : ''}`}
              onClick={() => setActiveBuffer('agent')}
              title="Agent"
              aria-label="Agent buffer"
            >
              {'\u25c6'}
            </button>
            <button
              className={`mobile-action-btn ${activeBuffer === 'terminal' ? 'active' : ''}`}
              onClick={() => setActiveBuffer('terminal')}
              title="Terminal"
              aria-label="Terminal buffer"
            >
              {'\u25b8'}
            </button>
            <button
              className={`mobile-action-btn ${activeBuffer === 'browser' ? 'active' : ''}`}
              onClick={() => setActiveBuffer('browser')}
              title="Browser"
              aria-label="Browser buffer"
            >
              {'\u25ce'}
            </button>
            <button
              className={`mobile-action-btn ${commandPaletteOpen ? 'active' : ''}`}
              onClick={() => openCommandPalette('commands')}
              title="Command palette"
              aria-label="Command palette"
            >
              {'\u2318'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
