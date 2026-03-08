import React from 'react'
import ReactDOM from 'react-dom/client'
import { setPlatform } from './core/platform'
import type { Platform } from './core/platform/types'
import './styles/index.css'

async function boot() {
  let platform: Platform

  // Detect runtime environment
  const isElectron = typeof window !== 'undefined' &&
    (window as any).require &&
    (window as any).process?.versions?.electron

  const isCapacitor = typeof window !== 'undefined' &&
    ((window as any).Capacitor?.isNative || !!(window as any).Capacitor)

  if (isElectron) {
    console.log('[MOA] Detected Electron environment')
    const { createElectronPlatform } = await import('./platform/electron')
    platform = createElectronPlatform()
  } else if (isCapacitor) {
    console.log('[MOA] Detected Capacitor environment')
    const { createCapacitorPlatform } = await import('./platform/capacitor')
    platform = await createCapacitorPlatform()
  } else {
    console.log('[MOA] Detected browser environment')
    const { createBrowserPlatform } = await import('./platform/browser')
    platform = await createBrowserPlatform()
  }

  setPlatform(platform)
  console.log(`[MOA] Platform initialized: ${platform.type}`)

  // Initialize the append-only action logger (EventStore backed)
  try {
    const { getEventStore } = await import('./core/services/event-store')
    const { initActionLogger } = await import('./core/services/action-logger')
    const eventStore = await getEventStore()
    initActionLogger(eventStore)
    console.log('[MOA] Action logger initialized')
  } catch (e) {
    console.warn('[MOA] Action logger failed to initialize — logging disabled:', e)
  }

  // Now mount React — all components can safely call getPlatform()
  const { default: App } = await import('./ui/App')

  const root = ReactDOM.createRoot(document.getElementById('root')!)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

boot().catch(err => {
  console.error('[MOA] Boot failed:', err)
  document.body.innerHTML = `<pre style="color:red;padding:20px;">MOA failed to start:\n${err.message}\n\n${err.stack}</pre>`
})
