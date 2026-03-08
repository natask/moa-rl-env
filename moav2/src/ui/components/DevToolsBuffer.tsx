import { useCallback, useEffect, useRef, useState } from 'react'
import { getPlatform } from '../../core/platform'
import '../../styles/DevToolsBuffer.css'

interface DevToolsBufferProps {
  isActive: boolean
}

const _w = window as any
if (!_w.__moaDevtoolsView) {
  _w.__moaDevtoolsView = null
}

function DevToolsUnavailable() {
  const platform = getPlatform()
  const message = platform.type === 'capacitor'
    ? 'DevTools is not available on mobile.'
    : 'DevTools requires desktop mode (Electron).'
  return (
    <div className="devtools-buffer devtools-unavailable">
      <span>{message}</span>
      <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
        Use your browser's built-in developer tools instead.
      </span>
    </div>
  )
}

export default function DevToolsBuffer({ isActive }: DevToolsBufferProps) {
  const platform = getPlatform()
  if (platform.type !== 'electron') {
    return <DevToolsUnavailable />
  }
  return <ElectronDevToolsBuffer isActive={isActive} />
}

function ElectronDevToolsBuffer({ isActive }: { isActive: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<any>(null)
  const [webContentsId, setWebContentsId] = useState<number | null>(null)
  const [embedded, setEmbedded] = useState(false)

  const ipcRenderer = (window as any).require('electron').ipcRenderer

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let view = _w.__moaDevtoolsView as any

    if (!view) {
      view = document.createElement('webview') as any
      view.src = 'about:blank'
      view.style.flex = '1'
      view.style.width = '100%'
      view.style.height = '100%'
      view.style.background = 'var(--bg-primary)'
      _w.__moaDevtoolsView = view
    }

    container.appendChild(view)
    viewRef.current = view

    return () => {
      if (view.parentNode === container) {
        container.removeChild(view)
      }
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const setReady = () => {
      try {
        const id = view.getWebContentsId?.()
        if (typeof id === 'number' && id > 0) {
          setWebContentsId(id)
        }
      } catch {
        // Not ready yet
      }
    }

    setReady()
    view.addEventListener('dom-ready', setReady)
    return () => {
      view.removeEventListener('dom-ready', setReady)
    }
  }, [])

  useEffect(() => {
    let active = true
    ipcRenderer.invoke('devtools:is-embedded').then((isEmbedded: boolean) => {
      if (active) {
        setEmbedded(!!isEmbedded)
      }
    }).catch(() => {
      if (active) {
        setEmbedded(false)
      }
    })

    return () => {
      active = false
    }
  }, [ipcRenderer])

  useEffect(() => {
    if (!isActive || embedded || !webContentsId) return

    let cancelled = false
    ipcRenderer.invoke('devtools:embed', webContentsId).then((ok: boolean) => {
      if (!cancelled) {
        setEmbedded(!!ok)
      }
    }).catch(() => {
      if (!cancelled) {
        setEmbedded(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isActive, embedded, webContentsId, ipcRenderer])

  const closeDevTools = useCallback(async () => {
    await ipcRenderer.invoke('devtools:close-embedded')
    setEmbedded(false)
  }, [ipcRenderer])

  return (
    <div className="devtools-buffer">
      <div className="devtools-toolbar">
        <span className="devtools-target">Inspecting: MOA renderer</span>
        <button className="devtools-close-btn" onClick={closeDevTools}>
          Close
        </button>
      </div>
      <div className="devtools-webview-container">
        <div ref={containerRef} className="devtools-webview-host" />
        {!embedded && (
          <div className="devtools-inactive-overlay">
            DevTools are inactive. Use the toolbar button or Cmd+Opt+I / Ctrl+Shift+I.
          </div>
        )}
      </div>
    </div>
  )
}
