import { app, BrowserWindow, ipcMain, session, webContents } from 'electron'
import * as path from 'path'
import { WINDOW_CONSTRAINTS } from './window-constraints'

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('ready', () => {
    const browserSession = session.fromPartition('persist:browser')
    browserSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = details.responseHeaders ?? {}
      const filteredHeaders: Record<string, string[]> = {}

      for (const [key, value] of Object.entries(responseHeaders)) {
        const headerName = key.toLowerCase()
        if (headerName === 'x-frame-options') continue
        if (headerName === 'content-security-policy') continue
        filteredHeaders[key] = value
      }

      callback({ responseHeaders: filteredHeaders })
    })

    createWindow()
  })
  app.on('web-contents-created', (_event, webContents) => {
    if (webContents.getType() !== 'webview') return

    webContents.on('will-navigate', () => {
      // Intentionally allow guest webview navigation.
    })

    webContents.setWindowOpenHandler(({ url }) => {
      if (url) {
        void webContents.loadURL(url)
      }
      return { action: 'deny' }
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function createWindow() {
  const win = new BrowserWindow({
    ...WINDOW_CONSTRAINTS,
    backgroundColor: '#111110',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Dev mode: load from Vite dev server
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    // Production: load built files
    win.loadFile(path.join(__dirname, '..', 'web', 'index.html'))
  }

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const key = input.key.toLowerCase()
    const isMacShortcut = process.platform === 'darwin' && input.meta && input.alt && key === 'i'
    const isOtherShortcut = process.platform !== 'darwin' && input.control && input.shift && key === 'i'

    if (!isMacShortcut && !isOtherShortcut) return

    event.preventDefault()
    win.webContents.send('moa:toggle-devtools-buffer')
  })

  // Prevent any popup/new windows — everything stays inside the MOA window
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })
}

// ── Embedded DevTools IPC ──
ipcMain.handle('devtools:embed', (event, rawWebContentsId: number) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false

  const webContentsId = Number(rawWebContentsId)
  if (!Number.isFinite(webContentsId)) return false

  const devtoolsWC = webContents.fromId(webContentsId)
  if (!devtoolsWC) return false

  try {
    win.webContents.setDevToolsWebContents(devtoolsWC)
    if (!win.webContents.isDevToolsOpened()) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
    return win.webContents.isDevToolsOpened()
  } catch {
    return false
  }
})

ipcMain.handle('devtools:close-embedded', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false

  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools()
  }

  return false
})

ipcMain.handle('devtools:is-embedded', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  return win.webContents.isDevToolsOpened()
})
