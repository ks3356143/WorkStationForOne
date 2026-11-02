import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session, shell } from 'electron'
import { initDatabase, type DatabaseContext } from './db'
import { disposeCaptureShortcut, registerCaptureHandlers, registerCaptureShortcut } from './capture'
import { registerAgentHandlers } from './ipc/agent'
import { registerProviderHandlers } from './ipc/providers'
import { registerAppHandlers, TITLE_BAR_HEIGHT, WINDOW_PALETTE } from './ipc/app'
import { ProviderService } from './providers'
import { ApprovalRuleService } from './agent/approval-rules'
import { ensureDailyBackup } from './db/backup'
import { startReminderLoop } from './reminders'
import { registerHabitHandlers } from './ipc/habits'
import { registerLearningHandlers } from './ipc/learning'
import { registerMcpHandlers } from './ipc/mcp'
import { registerNoteHandlers } from './ipc/notes'
import { registerTaskHandlers } from './ipc/tasks'
import { McpBridge } from './mcp/server'
import { McpPermissionBroker } from './mcp/permissions'
import { CapabilityRepository } from './db/capabilities'
import { PluginSourceService } from './capabilities/plugins/sources-service'
import { UpdateChecker } from './capabilities/plugins/update-checker'
import {
  defaultAppDir,
  locationFileFor,
  readLocation,
  resolveAppRoot,
  type LocationState
} from './storage/location'
import { migrateRoot, type MigrateResult } from './storage/migrate'
import { agentCapabilityRuntime, createCapabilityCenter } from './capabilities'
import { registerCapabilityHandlers } from './ipc/capability'
import { IPC_CHANNELS } from '../shared/ipc'

const devUrl = process.env.ELECTRON_RENDERER_URL
const rendererFileUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href

app.setName('WorkStationForOne')

let database: DatabaseContext | null = null
let updateChecker: UpdateChecker | null = null
let lastMigration: { ok: boolean; error: string; oldRoot: string; removedOld: boolean } | null =
  null

/**
 * 启动阶段处理待迁移：只在这里做，因为运行中移动数据库目录会让连接失效。
 * 结果留在主进程，供设置页下次打开时显示。
 */
function runPendingMigration(): void {
  if (process.env.WS_DATA_DIR) return
  const appData = app.getPath('appData')
  const locationFile = locationFileFor(appData)
  const location: LocationState = readLocation(locationFile)
  if (location.error) console.error('[storage]', location.error)
  if (!location.pending) return

  const resolved = resolveAppRoot({ locationFile, fallbackRoot: defaultAppDir(appData) })
  const result: MigrateResult = migrateRoot({
    currentRoot: resolved.root,
    targetRoot: location.pending,
    locationFile,
    location
  })
  lastMigration = {
    ok: result.ok,
    error: result.ok
      ? result.removedOld
        ? ''
        : `旧目录未能删除，可手动清理：${result.oldRoot}`
      : result.error,
    oldRoot: result.oldRoot,
    removedOld: result.removedOld
  }
  if (result.ok) {
    console.info(`[storage] 已迁移到 ${result.root}${result.removedOld ? '' : '（旧目录未删除）'}`)
  } else {
    console.error('[storage] 迁移失败，继续使用原目录', result.error)
  }
}

/** 设置页读取迁移结果；读取即清除，避免反复提示同一次迁移。 */
export function takeMigrationResult(): typeof lastMigration {
  const value = lastMigration
  lastMigration = null
  return value
}

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
let mcpPermissions: McpPermissionBroker | null = null
let agentHandlers: ReturnType<typeof registerAgentHandlers> | null = null

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

    // 迁移必须在开库之前：开库后移动目录会让连接指向已删除的文件。
    runPendingMigration()

    database = initDatabase()
    const providers = new ProviderService(database.providers)
    const capabilities = createCapabilityCenter({
      repository: new CapabilityRepository(database.db),
      appDataDir: database.layout.root,
      audit: database.audit,
      version: app.getVersion(),
      policy: database.mcp
    })
    // 插件源与更新检查：只操作应用私有目录，用私有 CODEX_HOME / CLAUDE_CONFIG_DIR
    const pluginSources = new PluginSourceService({
      repository: capabilities.repository,
      appDataDir: database.layout.root,
      claudeConfigDir: database.layout.claudeConfigDir,
      codexHome: database.layout.codexHome
    })
    updateChecker = new UpdateChecker({
      repository: capabilities.repository,
      sources: pluginSources,
      mcp: capabilities.mcp,
      codexHome: database.layout.codexHome,
      claudeInstallRoot: () => null,
      onAvailable: (candidates) => {
        const win = mainWindow
        if (!win || win.isDestroyed()) return
        win.webContents.send(IPC_CHANNELS.capabilityUpdateAvailable, candidates)
      },
      log: (message) => console.info(message)
    })
    updateChecker.scheduleStartup()
    // 软删任务保留 30 天后清掉，避免已删行无限堆积。
    database.tasks.purgeDeleted(Date.now() - 30 * 24 * 60 * 60 * 1000)
    registerCapabilityHandlers(capabilities, database.audit)
    registerAppHandlers({
      db: database.db,
      dir: database.layout.backupDir,
      dataDir: database.layout.dataDir,
      root: database.layout.root,
      takeMigration: takeMigrationResult
    })
    registerTaskHandlers(database.tasks)
    registerNoteHandlers(database.notes)
    registerLearningHandlers(database.learning)
    registerHabitHandlers(database.habits)
    registerProviderHandlers(providers)
    const approvalRules = new ApprovalRuleService({
      rules: database.approvalRules,
      sessions: database.agent,
      audit: database.audit
    })
    const permissions = new McpPermissionBroker({
      send: (request) => {
        const win = mainWindow
        if (!win || win.isDestroyed()) return false
        win.webContents.send(IPC_CHANNELS.mcpPermission, request)
        return true
      },
      audit: database.audit,
      isPreApproved: (sessionId, tool) => approvalRules.checkBridge(sessionId, tool),
      grantSession: (sessionId, tool) => approvalRules.grantBridgeSession(sessionId, tool),
      grantWorkspace: (request) =>
        approvalRules.grantBridgeWorkspace(request.sessionId, request.tool)
    })
    mcpPermissions = permissions
    registerMcpHandlers(database.mcp, database.audit, permissions)
    // 本地只读 MCP 桥：只绑 127.0.0.1 随机端口，token 按 Agent 回合发放
    const bridge = new McpBridge(
      {
        transaction: database.transaction,
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
        },
        requestPermission: (input) => permissions.request(input),
        isPreApproved: (sessionId, tool) => approvalRules.checkBridge(sessionId, tool),
        requestExternalApproval: (input) =>
          agentHandlers?.requestBridgeApproval(input) ??
          Promise.resolve({ behavior: 'deny', message: '审批服务未就绪' }),
        hasApprovalRelay: (sessionId) => agentHandlers?.hasApprovalRelay(sessionId) ?? false,
        isToolEnabled: (name) => database?.mcp.isToolEnabled(name) ?? true
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
    agentHandlers = registerAgentHandlers({
      getWindow: () => mainWindow,
      repository: database.agent,
      getProvider: (target) => providers.runtime(target),
      mcp: mcpBridge,
      cancelPermissions: (sessionId) => mcpPermissions?.cancelSession(sessionId),
      codexHome: database.layout.codexHome,
      capabilities: agentCapabilityRuntime(capabilities),
      approvalRules
    })
    // 到点提醒：轮询数据库，命中「今天 + 正好到点 + 没提醒过」就弹系统通知
    stopReminders = startReminderLoop(database.tasks, {
      ...(process.env.WS_REMINDER_TICK_MS
        ? { tickMs: Number(process.env.WS_REMINDER_TICK_MS) }
        : {}),
      ...(process.env.WS_REMINDER_LOG ? { logFile: process.env.WS_REMINDER_LOG } : {})
    })

    // 每天首次启动补一份快照：库只有一份，坏掉就全没了
    try {
      const created = ensureDailyBackup(database.db, database.layout.backupDir)
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
  updateChecker?.stop()
  updateChecker = null
  stopReminders?.()
  stopReminders = null
  mcpPermissions?.close()
  mcpPermissions = null
  mcpBridge?.close()
  mcpBridge = null
  disposeCaptureShortcut()
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
