import { useEffect, useRef, useState, useCallback } from 'react'
import { getPlatform } from '../../core/platform'
import { createCapacitorBrowserController, type CapacitorBrowserController } from '../../platform/capacitor/capacitor-browser'
import '../../styles/BrowserBuffer.css'

interface BrowserBufferProps {
  id: string
  initialUrl?: string
  isActive?: boolean
  onNavigate?: (url: string, title: string) => void
  onTitleChange?: (title: string) => void
}

type NavError = {
  code: number
  description: string
  url: string
}

// ── Persistent webview/iframe store ──
// DOM elements live outside React's lifecycle so they survive HMR.
// Keyed by buffer id.
const _w = window as any
if (!_w.__moaWebviews) _w.__moaWebviews = new Map<string, HTMLElement>()
const viewStore: Map<string, HTMLElement> = _w.__moaWebviews

/** Extract a short display name from a URL (hostname without www.) */
function titleFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    return hostname
  } catch {
    return url
  }
}

export default function BrowserBuffer({ id, initialUrl, isActive, onNavigate, onTitleChange }: BrowserBufferProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<any>(null)
  const capacitorControllerRef = useRef<CapacitorBrowserController | null>(null)
  const capacitorOpenedRef = useRef(false)
  const commandPaletteOpenRef = useRef(false)
  const resizeBoundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const [inputUrl, setInputUrl] = useState(initialUrl || 'https://www.google.com')
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  // Browser mode: tracks whether the iframe failed to load (X-Frame-Options, CSP, etc.)
  const [iframeBlocked, setIframeBlocked] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [navError, setNavError] = useState<NavError | null>(null)
  const pendingNavUrlRef = useRef<string>('')

  const platform = getPlatform()
  const isElectron = platform.type === 'electron'
  const isCapacitor = platform.type === 'capacitor'

  const readCapacitorBounds = useCallback(() => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }
  }, [])

  const ensureCapacitorController = useCallback(() => {
    if (capacitorControllerRef.current) return capacitorControllerRef.current
    const controller = createCapacitorBrowserController()

    controller.addEventListener('url', ({ url }) => {
      setInputUrl(url)
      onNavigate?.(url, titleFromUrl(url))
      onTitleChange?.(titleFromUrl(url))
    })
    controller.addEventListener('loaded', () => {
      setIsLoading(false)
      setNavError(null)
    })
    controller.addEventListener('error', ({ message }) => {
      setIsLoading(false)
      setNavError({
        code: 0,
        description: message || 'Navigation failed',
        url: pendingNavUrlRef.current,
      })
    })
    controller.addEventListener('close', () => {
      capacitorOpenedRef.current = false
      setIsLoading(false)
    })

    capacitorControllerRef.current = controller
    return controller
  }, [onNavigate, onTitleChange])

  const openCapacitorUrl = useCallback(async (url: string) => {
    const controller = ensureCapacitorController()
    const bounds = readCapacitorBounds() || undefined
    const shouldOpen = !capacitorOpenedRef.current

    if (shouldOpen) {
      await controller.open(url, bounds)
      capacitorOpenedRef.current = true
      return
    }

    await controller.setUrl(url)
    await controller.show()
    if (bounds) {
      await controller.updateBounds(bounds)
    }
  }, [ensureCapacitorController, readCapacitorBounds])

  // ── Resize observer: add .resizing class to disable pointer-events on webview ──
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let resizeTimer: ReturnType<typeof setTimeout> | null = null

    const observer = new ResizeObserver(() => {
      setIsResizing(true)
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        setIsResizing(false)
      }, 150)

      if (isCapacitor) {
        if (resizeBoundsTimerRef.current) clearTimeout(resizeBoundsTimerRef.current)
        resizeBoundsTimerRef.current = setTimeout(() => {
          const bounds = readCapacitorBounds()
          if (!bounds || !capacitorOpenedRef.current) return
          capacitorControllerRef.current?.updateBounds(bounds)
        }, 150)
      }
    })

    // Observe the parent of the container (the whole browser-buffer) for size changes
    const bufferEl = container.closest('.browser-buffer')
    if (bufferEl) {
      observer.observe(bufferEl)
    }

    return () => {
      observer.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
      if (resizeBoundsTimerRef.current) {
        clearTimeout(resizeBoundsTimerRef.current)
        resizeBoundsTimerRef.current = null
      }
    }
  }, [isCapacitor, readCapacitorBounds])

  // Create or reattach the view imperatively — React never touches this element
  useEffect(() => {
    if (isCapacitor) return

    const container = containerRef.current
    if (!container) return

    let view = viewStore.get(id) as any

    if (view) {
      // Reattach surviving element from previous HMR cycle
      container.appendChild(view)
      viewRef.current = view
      if (isElectron) {
        try {
          const currentUrl = view.getURL?.()
          if (currentUrl) setInputUrl(currentUrl)
        } catch { /* webview not ready yet */ }
      }
    } else {
      if (isElectron) {
        view = document.createElement('webview') as any
        view.setAttribute('partition', 'persist:browser')
        view.src = initialUrl || 'https://www.google.com'
        view.style.flex = '1'
        view.style.width = '100%'
        view.style.height = '100%'
        view.style.background = 'var(--bg-primary)'
        view.setAttribute('plugins', 'true')
      } else {
        // Browser: try direct iframe — works for sites that allow framing
        view = document.createElement('iframe')
        view.src = initialUrl || 'https://www.google.com'
        view.style.flex = '1'
        view.style.width = '100%'
        view.style.height = '100%'
        view.style.border = 'none'
        view.style.background = 'var(--bg-primary)'
        view.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups')
        setIframeBlocked(false)
        setIsLoading(true)
      }

      container.appendChild(view)
      viewStore.set(id, view)
      viewRef.current = view
    }

    return () => {
      if (view.parentNode === container) {
        container.removeChild(view)
      }
    }
  }, [id, initialUrl, isCapacitor, isElectron])

  // Wire up event listeners
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    if (isElectron) {
      const handleNavigation = (e: any) => {
        setInputUrl(e.url)
        onNavigate?.(e.url, view.getTitle?.() || '')
      }
      const handleLoadStart = () => {
        setIsLoading(true)
        setNavError(null)
      }
      const handleLoadStop = () => {
        setIsLoading(false)
        setCanGoBack(view.canGoBack?.() || false)
        setCanGoForward(view.canGoForward?.() || false)
        // Update title when page finishes loading (catches initial load)
        const title = view.getTitle?.() || ''
        const url = view.getURL?.() || ''
        onTitleChange?.(title || titleFromUrl(url))
      }

      // Fired when the page's <title> changes (e.g. SPA route transitions)
      const handleTitleUpdated = (e: any) => {
        const title = e.title || ''
        if (title) {
          onTitleChange?.(title)
        }
      }

      const handleLoadFailure = (e: any) => {
        const errorCode = typeof e.errorCode === 'number' ? e.errorCode : 0
        const errorDescription = typeof e.errorDescription === 'string' ? e.errorDescription : 'Navigation failed'
        const validatedURL = typeof e.validatedURL === 'string'
          ? e.validatedURL
          : (view.getURL?.() || pendingNavUrlRef.current || '')

        if (errorCode === -3 && pendingNavUrlRef.current && validatedURL !== pendingNavUrlRef.current) {
          return
        }

        setIsLoading(false)
        setNavError({
          code: errorCode,
          description: errorDescription,
          url: validatedURL,
        })
      }

      // Prevent popups: intercept new-window and navigate in-place
      const handleNewWindow = (e: any) => {
        e.preventDefault()
        const url = e.url
        if (url) {
          view.loadURL(url)
        }
      }

      view.addEventListener('did-navigate', handleNavigation)
      view.addEventListener('did-navigate-in-page', handleNavigation)
      view.addEventListener('did-start-loading', handleLoadStart)
      view.addEventListener('did-stop-loading', handleLoadStop)
      view.addEventListener('page-title-updated', handleTitleUpdated)
      view.addEventListener('new-window', handleNewWindow)
      view.addEventListener('did-fail-load', handleLoadFailure)
      view.addEventListener('did-fail-provisional-load', handleLoadFailure)

      return () => {
        view.removeEventListener('did-navigate', handleNavigation)
        view.removeEventListener('did-navigate-in-page', handleNavigation)
        view.removeEventListener('did-start-loading', handleLoadStart)
        view.removeEventListener('did-stop-loading', handleLoadStop)
        view.removeEventListener('page-title-updated', handleTitleUpdated)
        view.removeEventListener('new-window', handleNewWindow)
        view.removeEventListener('did-fail-load', handleLoadFailure)
        view.removeEventListener('did-fail-provisional-load', handleLoadFailure)
      }
    } else if (!isCapacitor) {
      // Browser iframe: detect blocked embeds.
      // X-Frame-Options blocks are silent — the iframe loads but shows blank.
      // We check after load: if we can't access contentDocument AND it has no height, it's blocked.
      const handleLoad = () => {
        setIsLoading(false)
        // Give it a moment to paint, then check if it rendered anything
        setTimeout(() => {
          try {
            // If we CAN access contentDocument, the page loaded same-origin or allowed framing
            const doc = view.contentDocument || view.contentWindow?.document
            if (doc && doc.body && doc.body.innerHTML) {
              setIframeBlocked(false)
              return
            }
          } catch {
            // Cross-origin — can't check, but that's expected for sites that DO allow framing
          }
          // Heuristic: if the iframe's contentWindow exists but we can't read it,
          // and the body is blank (height 0), it was likely blocked
          try {
            if (view.contentWindow && view.contentWindow.length === 0) {
              // No sub-frames and cross-origin — likely blocked
              // But we can't be 100% sure, so we show both the iframe AND the fallback
              setIframeBlocked(true)
            }
          } catch {
            setIframeBlocked(true)
          }
        }, 1500)
      }

      const handleError = () => {
        setIsLoading(false)
        setIframeBlocked(true)
      }

      view.addEventListener('load', handleLoad)
      view.addEventListener('error', handleError)
      return () => {
        view.removeEventListener('load', handleLoad)
        view.removeEventListener('error', handleError)
      }
    }
  }, [id, onNavigate, onTitleChange, isElectron, isCapacitor])

  useEffect(() => {
    if (!isCapacitor) return

    const syncVisibility = () => {
      const controller = capacitorControllerRef.current
      if (!controller || !capacitorOpenedRef.current) return

      if (isActive && !commandPaletteOpenRef.current) {
        controller.show()
        const bounds = readCapacitorBounds()
        if (bounds) controller.updateBounds(bounds)
      } else {
        controller.hide()
      }
    }

    const handlePaletteOpen = () => {
      commandPaletteOpenRef.current = true
      syncVisibility()
    }

    const handlePaletteClose = () => {
      commandPaletteOpenRef.current = false
      syncVisibility()
    }

    window.addEventListener('moa:command-palette-open', handlePaletteOpen)
    window.addEventListener('moa:command-palette-close', handlePaletteClose)

    return () => {
      window.removeEventListener('moa:command-palette-open', handlePaletteOpen)
      window.removeEventListener('moa:command-palette-close', handlePaletteClose)
      commandPaletteOpenRef.current = false
    }
  }, [isCapacitor, isActive, readCapacitorBounds])

  useEffect(() => {
    if (!isCapacitor || !isActive) return

    if (!capacitorOpenedRef.current) {
      setIsLoading(true)
      openCapacitorUrl(inputUrl).catch(() => {
        setIsLoading(false)
        getPlatform().shell.openExternal(inputUrl)
      })
      return
    }

    if (commandPaletteOpenRef.current) {
      capacitorControllerRef.current?.hide()
      return
    }

    capacitorControllerRef.current?.show()
    const bounds = readCapacitorBounds()
    if (bounds) {
      capacitorControllerRef.current?.updateBounds(bounds)
    }
  }, [inputUrl, isActive, isCapacitor, openCapacitorUrl, readCapacitorBounds])

  useEffect(() => {
    if (!isCapacitor || isActive || !capacitorOpenedRef.current) return
    capacitorControllerRef.current?.hide()
  }, [isActive, isCapacitor])

  useEffect(() => {
    if (!isCapacitor) return

    return () => {
      if (resizeBoundsTimerRef.current) {
        clearTimeout(resizeBoundsTimerRef.current)
        resizeBoundsTimerRef.current = null
      }

      capacitorControllerRef.current?.close().catch(() => undefined)
      capacitorControllerRef.current = null
      capacitorOpenedRef.current = false
    }
  }, [isCapacitor])

  // Listen for command palette browser commands
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail?.action
      const view = viewRef.current
      switch (action) {
        case 'back':
          if (isElectron) view?.goBack?.()
          else if (isCapacitor) capacitorControllerRef.current?.goBack()
          else if (!isCapacitor) window.history.back()
          break
        case 'forward':
          if (isElectron) view?.goForward?.()
          else if (!isCapacitor) window.history.forward()
          break
        case 'reload':
          if (isElectron) view?.reload?.()
          else if (isCapacitor) {
            setIsLoading(true)
            capacitorControllerRef.current?.reload().catch(() => {
              setIsLoading(false)
            })
          } else if (view?.src) { view.src = view.src }
          break
        case 'focus-url':
          urlInputRef.current?.focus()
          urlInputRef.current?.select()
          break
      }
    }
    window.addEventListener('moa:browser-command', handler)
    return () => window.removeEventListener('moa:browser-command', handler)
  }, [isElectron, isCapacitor])

  // Browser-mode keybindings: Cmd+L (focus URL), Cmd+R (reload), Cmd+Shift+R (hard reload)
  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return

      if (e.key === 'l') {
        e.preventDefault()
        urlInputRef.current?.focus()
        urlInputRef.current?.select()
      } else if (e.key === 'r' && !e.shiftKey) {
        e.preventDefault()
        const view = viewRef.current
        if (isElectron) {
          if (!view) return
          view.reload?.()
        } else if (isCapacitor) {
          setIsLoading(true)
          capacitorControllerRef.current?.reload().catch(() => {
            setIsLoading(false)
          })
        } else if (view?.src) { view.src = view.src }
      } else if (e.key === 'r' && e.shiftKey) {
        e.preventDefault()
        const view = viewRef.current
        if (isElectron) {
          if (!view) return
          view.reloadIgnoringCache?.()
        } else if (isCapacitor) {
          setIsLoading(true)
          capacitorControllerRef.current?.reload().catch(() => {
            setIsLoading(false)
          })
        } else if (view?.src) { view.src = view.src }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isActive, isElectron, isCapacitor])

  const navigate = useCallback((targetUrl: string) => {
    let normalizedUrl = targetUrl
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl
    }
    setInputUrl(normalizedUrl)
    setNavError(null)
    pendingNavUrlRef.current = normalizedUrl
    if (isElectron) {
      viewRef.current?.loadURL(normalizedUrl)
    } else if (isCapacitor) {
      setIsLoading(true)
      openCapacitorUrl(normalizedUrl)
        .catch(() => {
          getPlatform().shell.openExternal(normalizedUrl)
        })
        .finally(() => {
          if (!capacitorOpenedRef.current) {
            setIsLoading(false)
          }
        })
    } else {
      // Browser mode: load in iframe, detect if blocked
      if (viewRef.current) {
        setIframeBlocked(false)
        setIsLoading(true)
        viewRef.current.src = normalizedUrl
      }
    }
  }, [isElectron, isCapacitor, openCapacitorUrl])

  const openInNewTab = useCallback(() => {
    if (isCapacitor) {
      getPlatform().shell.openExternal(inputUrl)
      return
    }
    window.open(inputUrl, '_blank', 'noopener,noreferrer')
  }, [inputUrl, isCapacitor])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      navigate(inputUrl)
    }
  }

  const viewContainerClass = `browser-view-container${isResizing ? ' resizing' : ''}`

  // Browser mode: iframe with blocked-site fallback overlay
  if (isCapacitor) {
    return (
      <div className="browser-buffer">
        <div className="browser-nav">
          <button onClick={() => capacitorControllerRef.current?.goBack()} title="Back">
            {'\u2190'}
          </button>
          <button onClick={() => navigate(inputUrl)} title="Reload">
            {isLoading ? '...' : '\u21BB'}
          </button>
          <input
            ref={urlInputRef}
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button onClick={openInNewTab} title="Open in browser">
            {'\u2197'}
          </button>
        </div>
        <div className={viewContainerClass}>
          <div ref={containerRef} className="browser-capacitor-anchor" />
          {navError && (
            <div className="browser-nav-error-overlay">
              <div className="browser-nav-error-title">Page failed to load</div>
              <div className="browser-nav-error-message">{navError.description}</div>
              <div className="browser-nav-error-url">{navError.url}</div>
              <button onClick={() => navigate(navError.url)}>Retry</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!isElectron) {
    return (
      <div className="browser-buffer">
        <div className="browser-nav">
          <button onClick={() => navigate(inputUrl)}>
            {isLoading ? '...' : '\u21BB'}
          </button>
          <input
            ref={urlInputRef}
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button onClick={openInNewTab} title="Open in new tab">
            {'\u2197'}
          </button>
        </div>

        <div className={`browser-fallback-link-row${iframeBlocked ? ' is-blocked' : ''}`}>
          <button className="browser-fallback-link" onClick={openInNewTab}>
            Open in new tab
          </button>
        </div>

        <div className={viewContainerClass}>
          {/* iframe container — always rendered */}
          <div ref={containerRef} style={{ flex: 1, display: 'flex', width: '100%' }} />

          {/* Blocked overlay — shown on top of blank iframe when site refuses framing */}
          {iframeBlocked && (
            <div className="browser-blocked-overlay">
              <div>This site doesn't allow embedding.</div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={openInNewTab}>
                  Open in new tab
                </button>
              </div>
              <div className="blocked-hint">
                Download the desktop app for full embedded browsing.
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Electron mode: full embedded browser
  return (
    <div className="browser-buffer">
      <div className="browser-nav">
        <button
          onClick={() => viewRef.current?.goBack()}
          disabled={!canGoBack}
        >
          {'\u2190'}
        </button>
        <button
          onClick={() => viewRef.current?.goForward()}
          disabled={!canGoForward}
        >
          {'\u2192'}
        </button>
        <button onClick={() => isLoading ? viewRef.current?.stop() : viewRef.current?.reload()}>
          {isLoading ? '\u2715' : '\u21BB'}
        </button>
        <input
          ref={urlInputRef}
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className={viewContainerClass}>
        <div ref={containerRef} style={{ flex: 1, display: 'flex', width: '100%' }} />
        {navError && (
          <div className="browser-nav-error-overlay">
            <div className="browser-nav-error-title">Page failed to load</div>
            <div className="browser-nav-error-message">{navError.description} ({navError.code})</div>
            <div className="browser-nav-error-url">{navError.url}</div>
            <button onClick={() => navigate(navError.url)}>Retry</button>
          </div>
        )}
      </div>
    </div>
  )
}
