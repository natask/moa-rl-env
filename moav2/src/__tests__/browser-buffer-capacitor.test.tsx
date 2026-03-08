import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'

const openExternal = vi.fn()

const controllerMock = {
  open: vi.fn(async () => undefined),
  setUrl: vi.fn(async () => undefined),
  goBack: vi.fn(async () => undefined),
  reload: vi.fn(async () => undefined),
  show: vi.fn(async () => undefined),
  hide: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  updateBounds: vi.fn(async () => undefined),
  addEventListener: vi.fn(() => () => undefined),
}

const createController = vi.fn(() => controllerMock)

vi.mock('../core/platform', () => ({
  getPlatform: () => ({
    type: 'capacitor',
    shell: { openExternal },
  }),
}))

vi.mock('../platform/capacitor/capacitor-browser', () => ({
  createCapacitorBrowserController: () => createController(),
}))

import BrowserBuffer from '../ui/components/BrowserBuffer'

describe('BrowserBuffer capacitor mode', () => {
  beforeAll(() => {
    ;(globalThis as any).ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
  })

  beforeEach(() => {
    createController.mockClear()
    openExternal.mockClear()
    for (const key of Object.keys(controllerMock) as Array<keyof typeof controllerMock>) {
      controllerMock[key].mockClear()
    }
  })

  it('creates controller lazily and opens when active', async () => {
    render(<BrowserBuffer id="b1" isActive />)
    await act(async () => {})

    expect(createController).toHaveBeenCalledTimes(1)
    expect(controllerMock.open).toHaveBeenCalledTimes(1)
    expect(controllerMock.open).toHaveBeenCalledWith('https://www.google.com', expect.objectContaining({ width: 1, height: 1 }))
  })

  it('hides and shows webview for tab switch and palette events', async () => {
    const { rerender } = render(<BrowserBuffer id="b1" isActive />)
    await act(async () => {})

    rerender(<BrowserBuffer id="b1" isActive={false} />)
    await act(async () => {})
    expect(controllerMock.hide).toHaveBeenCalled()

    rerender(<BrowserBuffer id="b1" isActive />)
    await act(async () => {})
    expect(controllerMock.show).toHaveBeenCalled()
    expect(controllerMock.updateBounds).toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new CustomEvent('moa:command-palette-open'))
    })
    expect(controllerMock.hide).toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new CustomEvent('moa:command-palette-close'))
    })
    expect(controllerMock.show).toHaveBeenCalled()
  })

  it('closes controller on unmount', async () => {
    const { unmount } = render(<BrowserBuffer id="b1" isActive />)
    await act(async () => {})

    unmount()
    await act(async () => {})
    expect(controllerMock.close).toHaveBeenCalledTimes(1)
  })
})
