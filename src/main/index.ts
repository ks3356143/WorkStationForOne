import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session, shell } from 'electron'
import { initDatabase, type DatabaseContext } from './db'
import { registerTaskHandlers } from './ipc/tasks'

const devUrl = process.env.ELECTRON_RENDERER_URL
const rendererFileUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href

app.setName('WorkStationForOne')

let database: DatabaseContext | null = null

function isExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function isAllowedNavigation(url: string): boolean {
  if (devUrl) {
    try {
      return new URL(url).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  return url === rendererFileUrl || url.startsWith(`${rendererFileUrl}#`)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#070812',
    title: 'WorkStationForOne',
    icon: join(__dirname, '../../resources/icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#070812',
      symbolColor: '#B7C9DC',
      height: 52
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })

  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadURL(rendererFileUrl)
  }
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.workstationforone.app')
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)

    database = initDatabase()
    registerTaskHandlers(database.tasks)

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
