import { useEffect, useRef, useState, useCallback } from 'react'
import { getPlatform } from '../../core/platform'
import { createCapacitorMiniShell } from '../../platform/capacitor/capacitor-mini-shell'
import '../../styles/TerminalBuffer.css'

// xterm base CSS — critical for layout, must be imported statically
import 'xterm/css/xterm.css'

interface TerminalBufferProps {
  id: string
  cwd?: string
  onTitleChange?: (title: string) => void
}

function TerminalUnavailable() {
  return (
    <div
      className="terminal-buffer terminal-unavailable"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        color: 'var(--text-faint)',
        fontFamily: "'SF Mono', Monaco, Menlo, Consolas, monospace",
        fontSize: '13px',
        lineHeight: '1.7',
        textAlign: 'center',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <span>Terminal requires desktop mode (Electron).</span>
      <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
        Shell commands are available via the agent's bash tool.
      </span>
    </div>
  )
}

export default function TerminalBuffer({ id, cwd, onTitleChange }: TerminalBufferProps) {
  const platform = getPlatform()
  if (platform.type === 'capacitor') {
    return <CapacitorTerminalBuffer id={id} />
  }
  if (platform.type !== 'electron') {
    return <TerminalUnavailable />
  }
  return <ElectronTerminalBuffer id={id} cwd={cwd} onTitleChange={onTitleChange} />
}

function CapacitorTerminalBuffer({ id }: { id: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let mounted = true
    let cleanupFns: Array<() => void> = []

    Promise.all([
      import('xterm'),
      import('xterm-addon-fit'),
    ]).then(([xtermModule, fitModule]) => {
      if (!mounted || !containerRef.current) return

      const { Terminal } = xtermModule
      const { FitAddon } = fitModule

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'SF Mono', Monaco, Menlo, Consolas, monospace",
        convertEol: true,
        theme: {
          background: '#111110',
          foreground: '#eeeeec',
          cursor: '#c4a882',
        },
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      requestAnimationFrame(() => {
        try { fitAddon.fit() } catch { /* ignore */ }
      })

      const shell = createCapacitorMiniShell('/')
      let line = ''

      const writePrompt = () => {
        term.write(`\r\n${shell.getCwd()} $ `)
      }

      term.writeln('Mini shell (Capacitor)')
      term.writeln('Commands: pwd, ls, cd, cat, echo, mkdir, rm, touch, clear, help')
      term.writeln('Type "help" for command details.')
      term.write(`${shell.getCwd()} $ `)

      const disposable = term.onData(async (data) => {
        if (data === '\r') {
          const cmd = line
          line = ''
          const result = await shell.execute(cmd)
          if (result.clear) {
            term.clear()
          } else if (result.output) {
            term.writeln('')
            term.writeln(result.output)
          }
          writePrompt()
          return
        }
        if (data === '\u007F') {
          if (line.length > 0) {
            line = line.slice(0, -1)
            term.write('\b \b')
          }
          return
        }
        if (data >= ' ') {
          line += data
          term.write(data)
        }
      })

      const resizeObserver = new ResizeObserver(() => {
        try { fitAddon.fit() } catch { /* ignore */ }
      })
      resizeObserver.observe(containerRef.current)

      cleanupFns = [
        () => disposable.dispose(),
        () => resizeObserver.disconnect(),
        () => term.dispose(),
      ]
    }).catch(() => {
      if (!containerRef.current) return
      containerRef.current.innerHTML = '<div style="padding:12px;color:var(--text-faint)">Mini shell unavailable.</div>'
    })

    return () => {
      mounted = false
      for (const fn of cleanupFns) fn()
    }
  }, [id])

  return (
    <div className="terminal-wrapper">
      <div className="terminal-capacitor-note">Mini shell</div>
      <div ref={containerRef} className="terminal-buffer" aria-label="Mini shell" />
    </div>
  )
}

function ElectronTerminalBuffer({ id, cwd, onTitleChange }: TerminalBufferProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)
  const searchAddonRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  // Search handlers
  const openSearch = useCallback(() => {
    setSearchVisible(true)
    setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchVisible(false)
    setSearchQuery('')
    searchAddonRef.current?.clearDecorations()
    // Re-focus the terminal
    termRef.current?.focus()
  }, [])

  const doSearch = useCallback((query: string, direction: 'next' | 'prev' = 'next') => {
    if (!searchAddonRef.current || !query) return
    if (direction === 'next') {
      searchAddonRef.current.findNext(query, { regex: false, caseSensitive: false, decorations: {
        matchBackground: '#c4a88244',
        matchBorder: '#c4a88266',
        matchOverviewRuler: '#c4a882',
        activeMatchBackground: '#c4a882aa',
        activeMatchBorder: '#c4a882',
        activeMatchColorOverviewRuler: '#c4a882',
      }})
    } else {
      searchAddonRef.current.findPrevious(query, { regex: false, caseSensitive: false, decorations: {
        matchBackground: '#c4a88244',
        matchBorder: '#c4a88266',
        matchOverviewRuler: '#c4a882',
        activeMatchBackground: '#c4a882aa',
        activeMatchBorder: '#c4a882',
        activeMatchColorOverviewRuler: '#c4a882',
      }})
    }
  }, [])

  // Keyboard shortcut: Cmd+F for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // Only intercept if the terminal container is visible
        if (containerRef.current?.offsetParent !== null) {
          e.preventDefault()
          openSearch()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openSearch])

  useEffect(() => {
    if (!containerRef.current) return

    let cleanupFn: (() => void) | undefined
    let mounted = true

    Promise.all([
      import('xterm'),
      import('xterm-addon-fit'),
      import('xterm-addon-webgl'),
      import('xterm-addon-web-links'),
      import('xterm-addon-unicode11'),
      import('xterm-addon-search'),
      import('../../core/services/terminal-service'),
    ]).then(([
      xtermModule,
      fitModule,
      webglModule,
      webLinksModule,
      unicode11Module,
      searchModule,
      termServiceModule,
    ]) => {
      if (!mounted || !containerRef.current) return

      const { Terminal } = xtermModule
      const { FitAddon } = fitModule
      const { WebglAddon } = webglModule
      const { WebLinksAddon } = webLinksModule
      const { Unicode11Addon } = unicode11Module
      const { SearchAddon } = searchModule
      const { terminalService } = termServiceModule

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorWidth: 2,
        fontSize: 13,
        fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', Monaco, Menlo, Consolas, monospace",
        fontWeight: '400',
        fontWeightBold: '600',
        lineHeight: 1.2,
        letterSpacing: 0,
        allowProposedApi: true,
        scrollback: 10000,
        smoothScrollDuration: 100,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        drawBoldTextInBrightColors: false,
        minimumContrastRatio: 1,
        theme: {
          background: '#111110',
          foreground: '#eeeeec',
          cursor: '#c4a882',
          cursorAccent: '#111110',
          selectionBackground: 'rgba(196, 168, 130, 0.3)',
          selectionForeground: '#eeeeec',
          selectionInactiveBackground: 'rgba(196, 168, 130, 0.15)',
          black: '#1a1a18',
          red: '#e5534b',
          green: '#6bc46d',
          yellow: '#c4a882',
          blue: '#6cb6ff',
          magenta: '#d2a8ff',
          cyan: '#76e3ea',
          white: '#b5b3ad',
          brightBlack: '#62605b',
          brightRed: '#ff7b72',
          brightGreen: '#7ee787',
          brightYellow: '#d4bc9a',
          brightBlue: '#a5d6ff',
          brightMagenta: '#e2c5ff',
          brightCyan: '#a5f3fc',
          brightWhite: '#eeeeec',
        },
      })

      termRef.current = term

      // FitAddon — responsive sizing
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      fitAddonRef.current = fitAddon

      // Unicode 11 — proper emoji & CJK support
      const unicode11Addon = new Unicode11Addon()
      term.loadAddon(unicode11Addon)
      term.unicode.activeVersion = '11'

      // Search addon
      const searchAddon = new SearchAddon()
      term.loadAddon(searchAddon)
      searchAddonRef.current = searchAddon

      // Web links — clickable URLs
      try {
        term.loadAddon(new WebLinksAddon((_, uri) => {
          // Open links in default browser
          try {
            const _require = (window as any).require
            const { shell } = _require('electron')
            shell.openExternal(uri)
          } catch {
            window.open(uri, '_blank')
          }
        }, {
          urlRegex: /https?:\/\/[^\s"')\]}>]+/,
        }))
      } catch (e) {
        console.warn('[TerminalBuffer] Web-links addon failed, URLs will not be clickable:', e)
      }

      if (!containerRef.current) {
        term.dispose()
        return
      }

      term.open(containerRef.current)

      // WebGL renderer — GPU-accelerated, fall back to canvas silently.
      // The WebglAddon can fail in multiple ways:
      //   1. Constructor throws (no WebGL support at all)
      //   2. loadAddon/activate throws (internal xterm services not ready)
      //   3. WebGL context is lost after initialization
      //   4. Disposal throws when RenderService is already disposed
      //      (causes "Cannot read properties of undefined (reading 'onRequestRedraw')")
      // All cases must fall back gracefully to the default canvas renderer.
      // We keep a reference so we can dispose it BEFORE term.dispose() to avoid
      // the disposal-order bug in xterm's MutableDisposable.
      let webglAddon: InstanceType<typeof WebglAddon> | null = null
      try {
        webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          try { webglAddon?.dispose() } catch { /* already disposed */ }
          webglAddon = null
        })
        term.loadAddon(webglAddon)
      } catch (e) {
        console.warn('[TerminalBuffer] WebGL addon failed to initialize, using canvas renderer:', e)
        webglAddon = null
        // Canvas fallback is the default — terminal works fine without WebGL
      }

      // Initial fit after paint
      requestAnimationFrame(() => {
        if (!mounted || !containerRef.current) return
        try { fitAddon.fit() } catch { /* not visible yet */ }
      })

      // Spawn the shell — with detailed error diagnostics
      let termInstance: any
      try {
        termInstance = terminalService.create(id, { cwd })
      } catch (e: any) {
        const msg = e.message || 'Unknown error'
        console.error('[TerminalBuffer] Failed to create terminal:', e)
        // Provide actionable error messages
        let detail = msg
        if (msg.includes('node-pty') || msg.includes('pty')) {
          detail = `PTY initialization failed: ${msg}. Ensure node-pty native module is rebuilt for this Electron version (npm run postinstall).`
        } else if (msg.includes('ENOENT') || msg.includes('spawn')) {
          detail = `Shell not found: ${msg}. Check that your default shell exists at the expected path.`
        } else if (msg.includes('Electron')) {
          detail = msg
        }
        setError(detail)
        if (webglAddon) {
          try { webglAddon.dispose() } catch { /* best-effort */ }
          webglAddon = null
        }
        try { term.dispose() } catch { /* swallow disposal errors */ }
        return
      }

      // Wire bidirectional I/O
      termInstance.onData((data: string) => term.write(data))
      term.onData((data: string) => termInstance.write(data))

      termInstance.onExit((code: number) => {
        term.write(`\r\n\x1b[90m[process exited ${code}]\x1b[0m\r\n`)
      })

      // Listen for terminal title changes (OSC escape sequences: \e]0;title\a)
      // Shells emit these to report the cwd or running command name.
      term.onTitleChange((title: string) => {
        if (title && onTitleChangeRef.current) {
          onTitleChangeRef.current(title)
        }
      })

      // Keep PTY dimensions in sync with xterm dimensions
      term.onResize(({ cols, rows }) => {
        termInstance.resize(cols, rows)
      })

      // Responsive resize (throttled to one fit per frame)
      let resizeRaf = 0
      const resizeObserver = new ResizeObserver(() => {
        if (!mounted || !containerRef.current) return
        if (resizeRaf) return
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0
          if (!mounted || !containerRef.current) return
          if (containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return
          try {
            fitAddon.fit()
          } catch {
            // fit() can throw if not visible
          }
        })
      })
      resizeObserver.observe(containerRef.current)

      // Focus the terminal on mount
      term.focus()

      cleanupFn = () => {
        resizeObserver.disconnect()
        if (resizeRaf) cancelAnimationFrame(resizeRaf)
        // Dispose WebGL addon BEFORE the terminal to avoid the
        // "Cannot read properties of undefined (reading 'onRequestRedraw')" error.
        // The WebGL addon's dispose handler calls renderService.setRenderer() to
        // restore the canvas renderer. If RenderService is already disposed (from
        // term.dispose()), MutableDisposable.value returns undefined and the call
        // to renderer.onRequestRedraw crashes. Disposing the addon first lets it
        // restore the renderer while RenderService is still alive.
        if (webglAddon) {
          try { webglAddon.dispose() } catch { /* best-effort */ }
          webglAddon = null
        }
        try { term.dispose() } catch { /* swallow disposal errors */ }
        termRef.current = null
        fitAddonRef.current = null
        searchAddonRef.current = null
        terminalService.destroy(id)
      }
    }).catch((e: any) => {
      if (!mounted) return
      console.error('[TerminalBuffer] Failed to load xterm:', e)
      setError(e.message || 'Failed to load terminal')
    })

    return () => {
      mounted = false
      cleanupFn?.()
    }
  }, [id, cwd])

  if (error) {
    return (
      <div className="terminal-buffer terminal-error" style={{ flexDirection: 'column', gap: '12px', padding: '20px' }}>
        <p style={{ color: 'var(--accent, #c4a882)', margin: 0 }}>Terminal failed to start</p>
        <p style={{ fontSize: '12px', color: 'var(--text-tertiary, #7c7b74)', margin: 0, maxWidth: '500px', lineHeight: '1.6' }}>{error}</p>
      </div>
    )
  }

  return (
    <div className="terminal-wrapper">
      {searchVisible && (
        <div className="terminal-search-bar">
          <input
            ref={searchInputRef}
            type="text"
            className="terminal-search-input"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              doSearch(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                doSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
              } else if (e.key === 'Escape') {
                closeSearch()
              }
            }}
          />
          <button
            className="terminal-search-btn"
            onClick={() => doSearch(searchQuery, 'prev')}
            title="Previous (Shift+Enter)"
          >
            &#x25B2;
          </button>
          <button
            className="terminal-search-btn"
            onClick={() => doSearch(searchQuery, 'next')}
            title="Next (Enter)"
          >
            &#x25BC;
          </button>
          <button
            className="terminal-search-btn terminal-search-close"
            onClick={closeSearch}
            title="Close (Esc)"
          >
            &times;
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="terminal-buffer"
      />
    </div>
  )
}
