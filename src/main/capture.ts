import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type { TaskRepository } from './db/tasks'
import { registerTaskHandlersIPC } from './ipc/tasks'
import { captureWindowBounds, type Size } from './capture-bounds'

const CAPTURE_SIZE: Size = { width: 560, height: 168 }
const CAPTURE_SHORTCUT = 'CommandOrControl+Alt+Space'

let captureWindow: BrowserWindow | null = null

function captureUrl(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return `${devUrl}#capture`
  return `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#capture`
}

function place(win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  win.setBounds(captureWindowBounds(display.workArea, CAPTURE_SIZE))
}

export function openCaptureWindow(): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    place(captureWindow)
    captureWindow.show()
    captureWindow.focus()
    return
  }

  const win = new BrowserWindow({
    ...CAPTURE_SIZE,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#070812',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('blur', () => win.hide())
  win.on('closed', () => {
    captureWindow = null
  })
  win.once('ready-to-show', () => {
    place(win)
    win.show()
    win.focus()
  })
  void win.loadURL(captureUrl())
  captureWindow = win
}

export function registerCaptureHandlers(repository: TaskRepository): void {
  ipcMain.handle(IPC_CHANNELS.captureOpen, () => openCaptureWindow())

  ipcMain.handle(IPC_CHANNELS.captureClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.hide()
  })

  ipcMain.handle(IPC_CHANNELS.captureCreate, (event, value: unknown) => {
    const created = repository.create(registerTaskHandlersIPC.assertTaskDraft(value))
    // 捕获窗不共享主窗口状态：写完广播，主窗口重新拉一次库。
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.id === event.sender.id) continue
      win.webContents.send(IPC_CHANNELS.tasksChanged)
    }
    return created
  })
}

export function registerCaptureShortcut(): void {
  // 自动化测试与 Cherry Studio 等外部应用可能占用同一组合键；
  // 测试环境显式跳过，避免抢快捷键或把失败写进控制台断言。
  if (process.env.WS_DISABLE_CAPTURE_SHORTCUT === '1') return
  if (!globalShortcut.register(CAPTURE_SHORTCUT, () => openCaptureWindow())) {
    console.error(`[capture] 全局快捷键注册失败：${CAPTURE_SHORTCUT}`)
  }
}

export function disposeCaptureShortcut(): void {
  globalShortcut.unregister(CAPTURE_SHORTCUT)
}
