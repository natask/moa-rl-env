import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import '../../styles/CommandPalette.css'
import { tokenFuzzyMatch, sortFiltered, getRecencyMap, recordUsage, type RecencyMap } from './commandPaletteUtils'

type BufferView = 'agent' | 'terminal' | 'browser' | 'devtools'
type SettingsTab = 'anthropic' | 'openai' | 'vertex' | 'custom'

interface Session {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
}

interface ModelOption {
  value: string
  label: string
  group: string
}

export interface CommandItem {
  id: string
  label: string
  category: string
  kind: 'executable' | 'selectable'
  action: () => void
  isActive?: boolean
  hint?: string
}

interface TabInfo {
  id: string
  title: string
}

interface CommandPaletteProps {
  isOpen: boolean
  initialMode?: 'commands' | 'models'
  onClose: () => void
  activeBuffer: BufferView
  onSwitchBuffer: (buffer: BufferView) => void
  sessions: Session[]
  activeSessionId: string | null
  onSwitchSession: (id: string) => void
  onCreateSession: () => void
  onOpenSettings: () => void
  onOpenSettingsTab: (tab: SettingsTab) => void
  canCreateSession: boolean
  // Session management
  onDeleteSession: (id: string) => void
  onRenameSession: (id: string, newTitle: string) => void
  // Model selection
  currentModel: string
  availableModels: ModelOption[]
  onSelectModel: (modelValue: string) => void
  // Browser commands
  onBrowserBack: () => void
  onBrowserForward: () => void
  onBrowserReload: () => void
  onBrowserFocusUrl: () => void
  // Agent commands
  onAgentClearInput: () => void
  onAgentStopGeneration: () => void
  isStreaming: boolean
  // Tab management for ! commands
  terminalTabs?: TabInfo[]
  activeTerminalTabId?: string | null
  onSwitchTerminalTab?: (id: string) => void
  onCreateTerminalTab?: () => void
  browserTabs?: TabInfo[]
  activeBrowserTabId?: string | null
  onSwitchBrowserTab?: (id: string) => void
  onCreateBrowserTab?: () => void
  includeDevTools?: boolean
}

/** Bang command prefixes: !a=agent, !t=terminal, !b=browser */
const BANG_PREFIXES: Record<string, string> = {
  '!a': 'agent',
  '!b': 'browser',
  '!t': 'terminal',
}

/** Stable empty arrays to avoid re-render identity issues in useMemo deps */
const EMPTY_TABS: TabInfo[] = []

type PaletteMode = 'commands' | 'models' | 'rename'

export default function CommandPalette({
  isOpen,
  initialMode = 'commands',
  onClose,
  activeBuffer,
  onSwitchBuffer,
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onOpenSettings,
  onOpenSettingsTab,
  canCreateSession,
  onDeleteSession,
  onRenameSession,
  currentModel,
  availableModels,
  onSelectModel,
  onBrowserBack,
  onBrowserForward,
  onBrowserReload,
  onBrowserFocusUrl,
  onAgentClearInput,
  onAgentStopGeneration,
  isStreaming,
  terminalTabs = EMPTY_TABS,
  activeTerminalTabId,
  onSwitchTerminalTab,
  onCreateTerminalTab,
  browserTabs = EMPTY_TABS,
  activeBrowserTabId,
  onSwitchBrowserTab,
  onCreateBrowserTab,
  includeDevTools = true,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<PaletteMode>('commands')
  const [isDirectModelMode, setIsDirectModelMode] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [recencyMap, setRecencyMap] = useState<RecencyMap>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset state when opening — reload recency map
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setMode(initialMode)
      setIsDirectModelMode(initialMode === 'models')
      setRenameValue('')
      setRecencyMap(getRecencyMap())
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen, initialMode])

  useEffect(() => {
    if (!isOpen) return
    window.dispatchEvent(new CustomEvent('moa:command-palette-open'))
    return () => {
      window.dispatchEvent(new CustomEvent('moa:command-palette-close'))
    }
  }, [isOpen])

  // Record usage and update local recency state
  const trackUsage = useCallback((id: string) => {
    recordUsage(id)
    setRecencyMap(getRecencyMap())
  }, [])

  // Switch to model selection sub-view
  function enterModelMode() {
    setMode('models')
    setIsDirectModelMode(false)
    setQuery('')
    setSelectedIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Switch to rename mode
  function enterRenameMode() {
    const activeSession = sessions.find(s => s.id === activeSessionId)
    setMode('rename')
    setRenameValue(activeSession?.title || '')
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function goBack() {
    setMode('commands')
    setIsDirectModelMode(false)
    setQuery('')
    setSelectedIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function closeOrGoBack() {
    if (mode === 'models' && isDirectModelMode) {
      onClose()
      return
    }
    goBack()
  }

  // Build main command list
  const allCommands = useMemo<CommandItem[]>(() => {
    const cmds: CommandItem[] = []

    // Buffer commands
    const buffers: { id: BufferView; label: string; hint: string }[] = [
      { id: 'agent', label: 'Agent', hint: '' },
      { id: 'terminal', label: 'Terminal', hint: '' },
      { id: 'browser', label: 'Browser', hint: '' },
      ...(includeDevTools ? [{ id: 'devtools' as BufferView, label: 'DevTools', hint: '' }] : []),
    ]
    for (const b of buffers) {
      cmds.push({
        id: `buffer-${b.id}`,
        label: b.label,
        category: 'Buffer',
        kind: 'selectable',
        action: () => onSwitchBuffer(b.id),
        isActive: activeBuffer === b.id,
      })
    }

    // Session action commands
    if (canCreateSession) {
      cmds.push({
        id: 'session-new',
        label: 'New Session',
        category: 'Session',
        kind: 'executable',
        action: onCreateSession,
      })
    }

    if (activeSessionId) {
      cmds.push({
        id: 'session-delete',
        label: 'Delete Session',
        category: 'Session',
        kind: 'executable',
        action: () => {
          if (window.confirm('Delete the active session? This cannot be undone.')) {
            onDeleteSession(activeSessionId)
          }
        },
        hint: 'active',
      })
      cmds.push({
        id: 'session-rename',
        label: 'Rename Session',
        category: 'Session',
        kind: 'executable',
        action: enterRenameMode,
        hint: 'active',
      })
    }

    // Model command — opens sub-view
    cmds.push({
      id: 'model-select',
      label: 'Select Model',
      category: 'Model',
      kind: 'executable',
      action: enterModelMode,
      hint: currentModel ? currentModel.replace(/^(anthropic-key:|anthropic-oauth:|vertex-express:|vertex:)/, '') : 'none',
    })

    // Settings commands
    cmds.push({
      id: 'settings-general',
      label: 'Settings',
      category: 'Settings',
      kind: 'executable',
      action: onOpenSettings,
    })
    cmds.push({
      id: 'settings-anthropic',
      label: 'Settings: Anthropic',
      category: 'Settings',
      kind: 'executable',
      action: () => onOpenSettingsTab('anthropic'),
    })
    cmds.push({
      id: 'settings-openai',
      label: 'Settings: OpenAI',
      category: 'Settings',
      kind: 'executable',
      action: () => onOpenSettingsTab('openai'),
    })
    cmds.push({
      id: 'settings-vertex',
      label: 'Settings: Vertex AI',
      category: 'Settings',
      kind: 'executable',
      action: () => onOpenSettingsTab('vertex'),
    })
    cmds.push({
      id: 'settings-custom',
      label: 'Settings: Custom Providers',
      category: 'Settings',
      kind: 'executable',
      action: () => onOpenSettingsTab('custom'),
    })

    // Browser commands
    cmds.push({
      id: 'browser-back',
      label: 'Browser: Back',
      category: 'Browser',
      kind: 'executable',
      action: () => { onBrowserBack(); onSwitchBuffer('browser') },
    })
    cmds.push({
      id: 'browser-forward',
      label: 'Browser: Forward',
      category: 'Browser',
      kind: 'executable',
      action: () => { onBrowserForward(); onSwitchBuffer('browser') },
    })
    cmds.push({
      id: 'browser-reload',
      label: 'Browser: Reload',
      category: 'Browser',
      kind: 'executable',
      action: () => { onBrowserReload(); onSwitchBuffer('browser') },
    })
    cmds.push({
      id: 'browser-url',
      label: 'Browser: Navigate to URL',
      category: 'Browser',
      kind: 'executable',
      action: () => { onBrowserFocusUrl(); onSwitchBuffer('browser') },
    })

    // DevTools commands
    if (includeDevTools) {
      cmds.push({
        id: 'devtools-toggle',
        label: 'Toggle DevTools',
        category: 'DevTools',
        kind: 'executable',
        action: () => onSwitchBuffer(activeBuffer === 'devtools' ? 'agent' : 'devtools'),
      })
    }

    // Agent commands
    cmds.push({
      id: 'agent-clear-input',
      label: 'Agent: Clear Input',
      category: 'Agent',
      kind: 'executable',
      action: onAgentClearInput,
    })
    if (isStreaming) {
      cmds.push({
        id: 'agent-stop',
        label: 'Agent: Stop Generation',
        category: 'Agent',
        kind: 'executable',
        action: onAgentStopGeneration,
      })
    }

    // Session switch commands (at the bottom)
    for (const s of sessions) {
      cmds.push({
        id: `session-switch-${s.id}`,
        label: s.title || 'New Chat',
        category: 'Session',
        kind: 'selectable',
        action: () => onSwitchSession(s.id),
        isActive: activeSessionId === s.id,
      })
    }

    // Terminal tab commands
    if (onCreateTerminalTab) {
      cmds.push({
        id: 'terminal-new',
        label: 'New Terminal',
        category: 'Terminal',
        kind: 'executable',
        action: onCreateTerminalTab,
      })
    }
    for (const t of terminalTabs) {
      cmds.push({
        id: `terminal-switch-${t.id}`,
        label: t.title,
        category: 'Terminal',
        kind: 'selectable',
        action: () => { onSwitchTerminalTab?.(t.id); onSwitchBuffer('terminal') },
        isActive: activeTerminalTabId === t.id,
      })
    }

    // Browser tab commands
    if (onCreateBrowserTab) {
      cmds.push({
        id: 'browser-new',
        label: 'New Browser',
        category: 'Browser Tab',
        kind: 'executable',
        action: onCreateBrowserTab,
      })
    }
    for (const t of browserTabs) {
      cmds.push({
        id: `browser-switch-${t.id}`,
        label: t.title,
        category: 'Browser Tab',
        kind: 'selectable',
        action: () => { onSwitchBrowserTab?.(t.id); onSwitchBuffer('browser') },
        isActive: activeBrowserTabId === t.id,
      })
    }

    return cmds
  }, [
    activeBuffer, activeSessionId, sessions, canCreateSession, currentModel,
    availableModels, isStreaming,
    onSwitchBuffer, onSwitchSession, onCreateSession, onOpenSettings,
    onOpenSettingsTab, onDeleteSession, onSelectModel,
    onBrowserBack, onBrowserForward, onBrowserReload, onBrowserFocusUrl,
    onAgentClearInput, onAgentStopGeneration,
    terminalTabs, activeTerminalTabId, onSwitchTerminalTab, onCreateTerminalTab,
    browserTabs, activeBrowserTabId, onSwitchBrowserTab, onCreateBrowserTab,
    includeDevTools,
  ])

  // Model list for sub-view
  const modelCommands = useMemo<CommandItem[]>(() => {
    return availableModels.map(m => ({
      id: `model-${m.value}`,
      label: m.label,
      category: m.group,
      kind: 'selectable' as const,
      action: () => onSelectModel(m.value),
      isActive: currentModel === m.value,
    }))
  }, [availableModels, currentModel, onSelectModel])

  // Determine which list is active
  const activeList = mode === 'models' ? modelCommands : allCommands

  // Parse bang prefix from query: "!b search" → bangFilter='browser', searchQuery='search'
  const { bangFilter, searchQuery } = useMemo(() => {
    const trimmed = query.trimStart()
    for (const [prefix, filter] of Object.entries(BANG_PREFIXES)) {
      if (trimmed.startsWith(prefix)) {
        const rest = trimmed.slice(prefix.length).trimStart()
        return { bangFilter: filter, searchQuery: rest }
      }
    }
    return { bangFilter: null as string | null, searchQuery: query }
  }, [query])

  // Filtered list — fuzzy match against combined "category label" then sort
  const filtered = useMemo(() => {
    if (mode === 'rename') return []

    let list = activeList

    // Apply bang filter
    if (bangFilter) {
      list = list.filter(item => {
        const cat = item.category.toLowerCase()
        if (bangFilter === 'agent') return cat === 'session' || cat === 'agent'
        if (bangFilter === 'terminal') return cat === 'terminal'
        if (bangFilter === 'browser') return cat === 'browser' || cat === 'browser tab'
        return true
      })
    }

    const matched = searchQuery
      ? list.filter(item => tokenFuzzyMatch(searchQuery, item.category + ' ' + item.label))
      : list
    return sortFiltered(matched, searchQuery, recencyMap)
  }, [query, searchQuery, bangFilter, activeList, mode, recencyMap])

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  function handleKeyDown(e: React.KeyboardEvent) {
    // Rename mode: Enter submits, Escape goes back
    if (mode === 'rename') {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (activeSessionId && renameValue.trim()) {
          onRenameSession(activeSessionId, renameValue.trim())
          onClose()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        goBack()
      }
      return
    }

    // Ctrl+N / Ctrl+P — readline-style navigation
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault()
      setSelectedIndex(i => (i + 1) % (filtered.length || 1))
      return
    }
    if (e.ctrlKey && e.key === 'p') {
      e.preventDefault()
      setSelectedIndex(i => (i - 1 + (filtered.length || 1)) % (filtered.length || 1))
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % (filtered.length || 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + (filtered.length || 1)) % (filtered.length || 1))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[selectedIndex]) {
          trackUsage(filtered[selectedIndex].id)
          filtered[selectedIndex].action()
          // Don't close if entering a sub-view
          if (mode === 'commands' && (filtered[selectedIndex].id === 'model-select' || filtered[selectedIndex].id === 'session-rename')) {
            // sub-view entered, don't close
          } else {
            onClose()
          }
        }
        break
      case 'Escape':
        e.preventDefault()
        if (mode !== 'commands') {
          closeOrGoBack()
        } else {
          onClose()
        }
        break
      case 'Backspace':
        // If query is empty and in sub-view, go back
        if (!query && mode !== 'commands') {
          e.preventDefault()
          closeOrGoBack()
        }
        break
    }
  }

  if (!isOpen) return null

  const placeholder =
    mode === 'models' ? 'Select a model...' :
    mode === 'rename' ? 'Enter new session name...' :
    bangFilter ? `Search ${bangFilter} tabs...` :
    'Type a command... (!a agent, !t terminal, !b browser)'

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-palette-input-row">
          <input
            ref={inputRef}
            className="command-palette-input"
            placeholder={placeholder}
            value={mode === 'rename' ? renameValue : query}
            onChange={e => mode === 'rename' ? setRenameValue(e.target.value) : setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {mode !== 'commands' && (
            <button className="command-palette-back" onClick={closeOrGoBack} title="Back">
              &#x2715;
            </button>
          )}
        </div>
        {mode !== 'rename' && (
          <div className="command-palette-list" ref={listRef}>
            {filtered.map((item, i) => (
              <button
                key={item.id}
                className={`command-palette-item ${i === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  trackUsage(item.id)
                  item.action()
                  // Don't close for sub-view entries
                  if (item.id === 'model-select' || item.id === 'session-rename') return
                  onClose()
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="command-palette-item-left">
                  <span className="command-palette-category">{item.category}</span>
                  <span className="command-palette-label">{item.label}</span>
                </span>
                <span className="command-palette-item-right">
                  {item.hint && <span className="command-palette-hint">{item.hint}</span>}
                  {item.kind === 'selectable' && item.isActive && (
                    <span className="command-palette-check">&#10003;</span>
                  )}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="command-palette-empty">No matching commands</div>
            )}
          </div>
        )}
        {mode === 'rename' && (
          <div className="command-palette-rename-hint">
            Press Enter to confirm, Escape to cancel
          </div>
        )}
      </div>
    </div>
  )
}
