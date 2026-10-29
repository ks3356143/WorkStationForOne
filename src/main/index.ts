import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session, shell } from 'electron'
import { initDatabase, type DatabaseContext } from './db'
import { disposeCaptureShortcut, registerCaptureHandlers, registerCaptureShortcut } from './capture'
import { registerAgentHandlers } from './ipc/agent'
import { registerProviderHandlers } from './ipc/providers'
import { registerAppHandlers, TITLE_BAR_HEIGHT, WINDOW_PALETTE } from './ipc/app'
import { ProviderService } from './providers'
import { backupDirFor, ensureDailyBackup } from './db/backup'
import { startReminderLoop } from './reminders'
import { registerHabitHandlers } from './ipc/habits'
import { registerLearningHandlers } from './ipc/learning'
import { registerMcpHandlers } from './ipc/mcp'
import { registerNoteHandlers } from './ipc/notes'
import { registerTaskHandlers } from './ipc/tasks'
import { McpBridge } from './mcp/server'
import { IPC_CHANNELS } from '../shared/ipc'

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
let stopReminders: (() => void) | null = null
let mcpBridge: McpBridge | null = null

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

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.workstationforone.app')
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false)
    )
    session.defaultSession.setPermissionCheckHandler(() => false)

    database = initDatabase()
    const providers = new ProviderService(database.providers)
    // 软删任务保留 30 天后清掉，避免已删行无限堆积。
    database.tasks.purgeDeleted(Date.now() - 30 * 24 * 60 * 60 * 1000)
    registerAppHandlers({
      db: database.db,
      dir: backupDirFor(database.file),
      dataDir: dirname(database.file)
    })
    registerTaskHandlers(database.tasks)
    registerNoteHandlers(database.notes)
    registerLearningHandlers(database.learning)
    registerHabitHandlers(database.habits)
    registerProviderHandlers(providers)
    registerMcpHandlers(database.mcp, database.audit)
    // 本地只读 MCP 桥：只绑 127.0.0.1 随机端口，token 按 Agent 回合发放
    const bridge = new McpBridge(
      {
        tasks: database.tasks,
        notes: database.notes,
        learning: database.learning,
        habits: database.habits,
        audit: database.audit
      },
      app.getVersion(),
      {
        mode: (domain) => database?.mcp.mode(domain) ?? 'read',
        notifyChanged: (domains) => {
          const win = mainWindow
          if (win && !win.isDestroyed()) win.webContents.send(IPC_CHANNELS.mcpChanged, domains)
        }
      }
    )
    try {
      await bridge.start()
      mcpBridge = bridge
    } catch (error) {
      bridge.close()
      console.error('[mcp] 只读数据桥启动失败，本轮 Agent 不启用', error)
    }
    // 上次进程退出后 run/wait 已不存在，重启时统一回落为 idle。
    database.agent.resetTransientStatuses()
    // 捕获窗是另一个 BrowserWindow，Agent 事件只回主窗口
    registerAgentHandlers(
      () => mainWindow,
      database.agent,
      undefined,
      () => providers.runtime(),
      undefined,
      mcpBridge
    )
    // 到点提醒：轮询数据库，命中「今天 + 正好到点 + 没提醒过」就弹系统通知
    stopReminders = startReminderLoop(database.tasks, {
      ...(process.env.WS_REMINDER_TICK_MS
        ? { tickMs: Number(process.env.WS_REMINDER_TICK_MS) }
        : {}),
      ...(process.env.WS_REMINDER_LOG ? { logFile: process.env.WS_REMINDER_LOG } : {})
    })

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
  // 先停轮询/桥再关库：反过来的话 tick 或 MCP 请求会读到已关闭的连接
  stopReminders?.()
  stopReminders = null
  mcpBridge?.close()
  mcpBridge = null
  disposeCaptureShortcut()
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
