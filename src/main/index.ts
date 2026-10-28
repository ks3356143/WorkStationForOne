import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session, shell } from 'electron'
import { initDatabase, type DatabaseContext } from './db'
import { disposeCaptureShortcut, registerCaptureHandlers, registerCaptureShortcut } from './capture'
import { registerAgentHandlers } from './ipc/agent'
import { registerAppHandlers, TITLE_BAR_HEIGHT, WINDOW_PALETTE } from './ipc/app'
import { backupDirFor, ensureDailyBackup } from './db/backup'
import { registerHabitHandlers } from './ipc/habits'
import { registerLearningHandlers } from './ipc/learning'
import { registerNoteHandlers } from './ipc/notes'
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

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: WINDOW_PALETTE.dark.background,
    title: 'WorkStationForOne',
    icon: join(__dirname, '../../resources/icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: WINDOW_PALETTE.dark.background,
      symbolColor: WINDOW_PALETTE.dark.symbol,
      height: TITLE_BAR_HEIGHT
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
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
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false)
    )
    session.defaultSession.setPermissionCheckHandler(() => false)

    database = initDatabase()
    // 软删任务保留 30 天后清掉，避免已删行无限堆积。
    database.tasks.purgeDeleted(Date.now() - 30 * 24 * 60 * 60 * 1000)
    registerAppHandlers({ db: database.db, dir: backupDirFor(database.file) })
    registerTaskHandlers(database.tasks)
    registerNoteHandlers(database.notes)
    registerLearningHandlers(database.learning)
    registerHabitHandlers(database.habits)
    // 捕获窗是另一个 BrowserWindow，Agent 事件只回主窗口
    registerAgentHandlers(() => mainWindow)
    // 每天首次启动补一份快照：库只有一份，坏掉就全没了
    try {
      const created = ensureDailyBackup(database.db, backupDirFor(database.file))
      if (created) console.log('[db] 已创建每日备份', created)
    } catch (error) {
      console.error('[db] 每日备份失败', error)
    }
    registerCaptureHandlers(database.tasks)
    registerCaptureShortcut()

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  disposeCaptureShortcut()
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
