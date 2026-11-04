import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS, type StorageInfo, type Theme } from '../../shared/ipc'
import { backupEntries, backupSize, createBackup, listBackups } from '../db/backup'
import { readRestoreInfo, requestRestore } from '../db/restore'
import {
  defaultAppDir,
  describeLayout,
  locationFileFor,
  readLocation,
  resolveAppRoot,
  resolveLayout,
  validateTargetRoot,
  writeLocation
} from '../storage/location'

export const WINDOW_PALETTE: Record<Theme, string> = {
  dark: '#070812',
  light: '#EEF2FB'
}

function assertTheme(value: unknown): Theme {
  if (value !== 'dark' && value !== 'light') throw new TypeError('主题无效')
  return value
}

export const registerAppHandlersIPC = { assertTheme } as const

export interface BackupTarget {
  db: import('node:sqlite').DatabaseSync
  /** 当前库文件，恢复时用它做替换与回滚 */
  dbFile: string
  /** 备份目录 */
  dir: string
  /** 数据库所在目录，设置面板要原样展示给用户 */
  dataDir: string
  /** 当前生效的存储根目录 */
  root: string
  /** 上一次启动迁移的结果，读一次即清 */
  takeMigration?: () => { ok: boolean; error: string; oldRoot: string; removedOld: boolean } | null
}

export function registerAppHandlers(backup: BackupTarget): void {
  ipcMain.handle(IPC_CHANNELS.appBackupNow, () => {
    const file = createBackup(backup.db, backup.dir)
    return { file, dir: backup.dir, bytes: backupSize(file), at: Date.now() }
  })

  ipcMain.handle(IPC_CHANNELS.appBackupList, () => ({
    dir: backup.dir,
    entries: backupEntries(backup.dir)
  }))

  ipcMain.handle(IPC_CHANNELS.appRestoreBackup, (_event, name: unknown) => {
    if (typeof name !== 'string') throw new TypeError('备份文件名无效')
    const result = requestRestore({
      db: backup.db,
      backupDir: backup.dir,
      dataDir: backup.dataDir,
      name
    })
    return { ...result, restartRequired: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.appRestoreStatus, () => readRestoreInfo(backup.dataDir))

  ipcMain.handle(IPC_CHANNELS.appRelaunch, () => {
    app.relaunch()
    app.quit()
  })

  ipcMain.handle(IPC_CHANNELS.appInfo, () => ({
    version: app.getVersion(),
    dataDir: backup.dataDir,
    backupDir: backup.dir,
    backupCount: listBackups(backup.dir).length
  }))

  const locationFile = locationFileFor(app.getPath('appData'))

  /** 只在设置页打开时读一次迁移结果，避免重复提示。 */
  const storageInfo = (): StorageInfo => {
    const envLocked = Boolean(process.env.WS_DATA_DIR)
    const location = readLocation(locationFile)
    const resolved = resolveAppRoot({
      locationFile,
      ...(process.env.WS_DATA_DIR ? { envDataDir: process.env.WS_DATA_DIR } : {}),
      fallbackRoot: defaultAppDir(app.getPath('appData'))
    })
    const migration = backup.takeMigration?.() ?? null
    const error = location.error || migration?.error || ''
    return {
      root: resolved.root,
      source: resolved.source,
      pending: location.pending,
      lastError: error,
      layout: describeLayout(resolveLayout(resolved.root)),
      locked: envLocked
    }
  }

  ipcMain.handle(IPC_CHANNELS.appStorage, () => storageInfo())

  ipcMain.handle(IPC_CHANNELS.appStoragePick, async (event) => {
    if (process.env.WS_DATA_DIR) throw new Error('当前由 WS_DATA_DIR 指定路径，无法在界面更改')
    const win = BrowserWindow.fromWebContents(event.sender)
    const picked = process.env.WS_PICK_STORAGE?.trim()
    let target = picked ?? ''
    if (!target) {
      const result = win
        ? await dialog.showOpenDialog(win, {
            title: '选择存储位置',
            buttonLabel: '迁移到这里',
            properties: ['openDirectory', 'createDirectory']
          })
        : await dialog.showOpenDialog({
            title: '选择存储位置',
            properties: ['openDirectory', 'createDirectory']
          })
      if (result.canceled || !result.filePaths[0]) return storageInfo()
      target = result.filePaths[0]
    }
    const current = resolveAppRoot({
      locationFile,
      fallbackRoot: defaultAppDir(app.getPath('appData'))
    }).root
    // 目标已存在同名子目录说明用户选到了根目录本身内部，按拒绝处理
    const invalid = validateTargetRoot(target, current)
    if (invalid) throw new Error(invalid)
    const location = readLocation(locationFile)
    writeLocation(locationFile, {
      root: location.root,
      pending: target,
      previous: location.previous
    })
    return storageInfo()
  })

  ipcMain.handle(IPC_CHANNELS.appStorageCancel, () => {
    const location = readLocation(locationFile)
    writeLocation(locationFile, { root: location.root, pending: null, previous: location.previous })
    return storageInfo()
  })

  const windowFrom = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win && !win.isDestroyed() ? win : null
  }

  ipcMain.handle(IPC_CHANNELS.appSetTheme, (event, value: unknown) => {
    const theme = assertTheme(value)
    const win = windowFrom(event)
    if (!win) return
    win.setBackgroundColor(WINDOW_PALETTE[theme])
  })

  ipcMain.handle(IPC_CHANNELS.appWindowMinimize, (event) => {
    windowFrom(event)?.minimize()
  })

  ipcMain.handle(IPC_CHANNELS.appWindowToggleMaximize, (event) => {
    const win = windowFrom(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle(IPC_CHANNELS.appWindowClose, (event) => {
    windowFrom(event)?.close()
  })

  ipcMain.handle(IPC_CHANNELS.appWindowGetState, (event) => ({
    maximized: windowFrom(event)?.isMaximized() ?? false
  }))
}
