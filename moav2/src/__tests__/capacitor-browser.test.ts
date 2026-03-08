import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCapacitorBrowserController } from '../platform/capacitor/capacitor-browser'

describe('capacitor browser controller', () => {
  const listeners = new Map<string, (event: any) => void>()

  const plugin = {
    openWebView: vi.fn(async () => ({ id: 'wv-1' })),
    setUrl: vi.fn(async () => ({})),
    goBack: vi.fn(async () => ({})),
    reload: vi.fn(async () => ({})),
    show: vi.fn(async () => undefined),
    hide: vi.fn(async () => undefined),
    close: vi.fn(async () => ({})),
    updateDimensions: vi.fn(async () => undefined),
    addListener: vi.fn(async (eventName: string, listener: (event: any) => void) => {
      listeners.set(eventName, listener)
      return { remove: vi.fn(async () => undefined) }
    }),
  }

  beforeEach(() => {
    listeners.clear()
    for (const value of Object.values(plugin)) {
      value.mockClear()
    }
    ;(window as any).__moaCapgoInAppBrowser = { InAppBrowser: plugin }
  })

  it('opens webview and proxies controller methods', async () => {
    const controller = createCapacitorBrowserController()
    await controller.open('https://example.com', { x: 10, y: 20, width: 200, height: 300 })

    expect(plugin.openWebView).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com',
      x: 10,
      y: 20,
      width: 200,
      height: 300,
      toolbarType: 'navigation',
    }))

    await controller.setUrl('https://next.example.com')
    await controller.goBack()
    await controller.reload()
    await controller.hide()
    await controller.show()
    await controller.updateBounds({ x: 1, y: 2, width: 3, height: 4 })
    await controller.close()

    expect(plugin.setUrl).toHaveBeenCalledWith({ id: 'wv-1', url: 'https://next.example.com' })
    expect(plugin.goBack).toHaveBeenCalledWith({ id: 'wv-1' })
    expect(plugin.reload).toHaveBeenCalledWith({ id: 'wv-1' })
    expect(plugin.hide).toHaveBeenCalled()
    expect(plugin.show).toHaveBeenCalled()
    expect(plugin.updateDimensions).toHaveBeenCalledWith({ id: 'wv-1', x: 1, y: 2, width: 3, height: 4 })
    expect(plugin.close).toHaveBeenCalledWith({ id: 'wv-1' })
  })

  it('emits url, loaded, error, and close events', async () => {
    const controller = createCapacitorBrowserController()
    const onUrl = vi.fn()
    const onLoaded = vi.fn()
    const onError = vi.fn()
    const onClose = vi.fn()

    controller.addEventListener('url', onUrl)
    controller.addEventListener('loaded', onLoaded)
    controller.addEventListener('error', onError)
    controller.addEventListener('close', onClose)

    await controller.open('https://example.com')

    listeners.get('urlChangeEvent')?.({ id: 'wv-1', url: 'https://changed.example.com' })
    listeners.get('browserPageLoaded')?.({ id: 'wv-1' })
    listeners.get('pageLoadError')?.({ id: 'wv-1', message: 'bad gateway' })
    listeners.get('closeEvent')?.({ id: 'wv-1' })

    expect(onUrl).toHaveBeenCalledWith({ url: 'https://changed.example.com' })
    expect(onLoaded).toHaveBeenCalledWith({})
    expect(onError).toHaveBeenCalledWith({ message: 'bad gateway' })
    expect(onClose).toHaveBeenCalledWith({})
  })
})
