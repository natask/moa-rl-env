type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

type BrowserEventMap = {
  url: { url: string }
  loaded: {}
  error: { message?: string }
  close: {}
}

type BrowserEventName = keyof BrowserEventMap

type BrowserListener<T extends BrowserEventName> = (payload: BrowserEventMap[T]) => void

type PluginListenerHandle = {
  remove: () => Promise<void>
}

type InAppBrowserPlugin = {
  openWebView: (options: Record<string, unknown>) => Promise<{ id?: string }>
  setUrl: (options: { url: string; id?: string }) => Promise<unknown>
  goBack: (options?: { id?: string }) => Promise<unknown>
  reload: (options?: { id?: string }) => Promise<unknown>
  show: () => Promise<void>
  hide: () => Promise<void>
  close: (options?: { id?: string }) => Promise<unknown>
  updateDimensions: (options: { id?: string } & BrowserBounds) => Promise<void>
  addListener: (eventName: string, listener: (event: any) => void) => Promise<PluginListenerHandle>
}

export interface CapacitorBrowserController {
  open: (url: string, bounds?: BrowserBounds) => Promise<void>
  setUrl: (url: string) => Promise<void>
  goBack: () => Promise<void>
  reload: () => Promise<void>
  show: () => Promise<void>
  hide: () => Promise<void>
  close: () => Promise<void>
  updateBounds: (bounds: BrowserBounds) => Promise<void>
  addEventListener: <T extends BrowserEventName>(event: T, listener: BrowserListener<T>) => () => void
}

declare global {
  interface Window {
    __moaCapgoInAppBrowser?: {
      InAppBrowser?: InAppBrowserPlugin
    }
  }
}

const dynamicImportCapgo = new Function('return import("@capgo/inappbrowser")') as () => Promise<{ InAppBrowser?: InAppBrowserPlugin }>

async function loadPlugin(): Promise<InAppBrowserPlugin> {
  if (typeof window !== 'undefined' && window.__moaCapgoInAppBrowser?.InAppBrowser) {
    return window.__moaCapgoInAppBrowser.InAppBrowser
  }

  const module = await dynamicImportCapgo()
  if (!module?.InAppBrowser) {
    throw new Error('InAppBrowser plugin is unavailable')
  }

  return module.InAppBrowser
}

export function createCapacitorBrowserController(): CapacitorBrowserController {
  let pluginPromise: Promise<InAppBrowserPlugin> | null = null
  let webviewId: string | undefined
  let opened = false
  let lastBounds: BrowserBounds | null = null
  let handles: PluginListenerHandle[] = []

  const listeners: { [K in BrowserEventName]: Set<BrowserListener<K>> } = {
    url: new Set(),
    loaded: new Set(),
    error: new Set(),
    close: new Set(),
  }

  const getPlugin = async () => {
    if (!pluginPromise) {
      pluginPromise = loadPlugin()
    }
    return pluginPromise
  }

  const emit = <T extends BrowserEventName>(event: T, payload: BrowserEventMap[T]) => {
    for (const listener of listeners[event]) {
      listener(payload)
    }
  }

  const isCurrentInstance = (eventId?: string) => {
    if (!webviewId || !eventId) return true
    return eventId === webviewId
  }

  const ensureNativeListeners = async (plugin: InAppBrowserPlugin) => {
    if (handles.length > 0) return

    const urlHandle = await plugin.addListener('urlChangeEvent', (event: { id?: string; url?: string }) => {
      if (!isCurrentInstance(event?.id)) return
      if (event?.url) emit('url', { url: event.url })
    })
    const loadHandle = await plugin.addListener('browserPageLoaded', (event: { id?: string }) => {
      if (!isCurrentInstance(event?.id)) return
      emit('loaded', {})
    })
    const errorHandle = await plugin.addListener('pageLoadError', (event: { id?: string; message?: string }) => {
      if (!isCurrentInstance(event?.id)) return
      emit('error', { message: event?.message })
    })
    const closeHandle = await plugin.addListener('closeEvent', (event: { id?: string }) => {
      if (!isCurrentInstance(event?.id)) return
      opened = false
      emit('close', {})
    })

    handles = [urlHandle, loadHandle, errorHandle, closeHandle]
  }

  const removeNativeListeners = async () => {
    const pending = handles
    handles = []
    await Promise.all(pending.map((handle) => handle.remove().catch(() => undefined)))
  }

  return {
    async open(url, bounds) {
      const plugin = await getPlugin()
      await ensureNativeListeners(plugin)

      if (!opened) {
        const openOptions: Record<string, unknown> = {
          url,
          toolbarType: 'navigation',
          activeNativeNavigationForWebview: true,
          showReloadButton: true,
          isAnimated: false,
        }

        if (bounds) {
          lastBounds = bounds
          Object.assign(openOptions, bounds)
        }

        const result = await plugin.openWebView(openOptions)
        webviewId = result?.id
        opened = true
        return
      }

      await plugin.setUrl({ url, id: webviewId })
      await plugin.show()

      if (bounds) {
        await plugin.updateDimensions({ id: webviewId, ...bounds })
        lastBounds = bounds
      }
    },

    async setUrl(url) {
      const plugin = await getPlugin()
      await plugin.setUrl({ url, id: webviewId })
    },

    async goBack() {
      const plugin = await getPlugin()
      await plugin.goBack({ id: webviewId })
    },

    async reload() {
      const plugin = await getPlugin()
      await plugin.reload({ id: webviewId })
    },

    async show() {
      const plugin = await getPlugin()
      await plugin.show()
      if (lastBounds) {
        await plugin.updateDimensions({ id: webviewId, ...lastBounds })
      }
    },

    async hide() {
      const plugin = await getPlugin()
      await plugin.hide()
    },

    async close() {
      const plugin = await getPlugin()
      await plugin.close({ id: webviewId })
      opened = false
      webviewId = undefined
      await removeNativeListeners()
    },

    async updateBounds(bounds) {
      lastBounds = bounds
      if (!opened) return
      const plugin = await getPlugin()
      await plugin.updateDimensions({ id: webviewId, ...bounds })
    },

    addEventListener(event, listener) {
      listeners[event].add(listener as any)
      return () => {
        listeners[event].delete(listener as any)
      }
    },
  }
}
