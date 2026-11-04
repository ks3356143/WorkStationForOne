import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/ipc'

const { handle, fromWebContents } = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle },
  BrowserWindow: { fromWebContents },
  app: {
    getPath: () => process.env.WS_TEST_APPDATA ?? 'C:\\Users\\test\\AppData\\Roaming',
    getVersion: () => '0.0.0-test'
  },
  dialog: { showOpenDialog: vi.fn() }
}))

const { registerAppHandlers, registerAppHandlersIPC } = await import('./app')

function windowStub(options: { destroyed?: boolean; maximized?: boolean } = {}) {
  return {
    isDestroyed: () => options.destroyed ?? false,
    isMaximized: () => options.maximized ?? false,
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    setBackgroundColor: vi.fn()
  }
}

function handlerFor(channel: string) {
  // 备份连接在这些断言里用不到，给个空壳即可
  registerAppHandlers({ db: {} as never, dbFile: '', dir: '', dataDir: '', root: '' })
  const call = handle.mock.calls.find(([name]) => name === channel)
  if (!call) throw new Error(`handler not registered: ${channel}`)
  return call[1] as (event: unknown, ...args: unknown[]) => unknown
}

describe('主题与窗口 IPC', () => {
  beforeEach(() => {
    handle.mockClear()
    fromWebContents.mockReset()
  })

  it('拒绝非法主题', () => {
    expect(() => registerAppHandlersIPC.assertTheme('auto')).toThrow(TypeError)
    expect(() => registerAppHandlersIPC.assertTheme(undefined)).toThrow(TypeError)
    expect(registerAppHandlersIPC.assertTheme('light')).toBe('light')
  })

  it('同步窗口背景色', () => {
    const win = windowStub()
    fromWebContents.mockReturnValue(win)

    handlerFor(IPC_CHANNELS.appSetTheme)({ sender: 'sender' }, 'light')

    expect(win.setBackgroundColor).toHaveBeenCalledWith('#EEF2FB')
  })

  it('窗口不可用时跳过外观同步', () => {
    const win = windowStub({ destroyed: true })
    fromWebContents.mockReturnValue(win)

    expect(() => handlerFor(IPC_CHANNELS.appSetTheme)({ sender: 'sender' }, 'dark')).not.toThrow()
    expect(win.setBackgroundColor).not.toHaveBeenCalled()
  })

  it('窗口控制走当前窗口：最小化 / 最大化·还原 / 关闭', () => {
    const win = windowStub()
    fromWebContents.mockReturnValue(win)

    handlerFor(IPC_CHANNELS.appWindowMinimize)({ sender: 'sender' })
    handlerFor(IPC_CHANNELS.appWindowToggleMaximize)({ sender: 'sender' })
    handlerFor(IPC_CHANNELS.appWindowClose)({ sender: 'sender' })

    expect(win.minimize).toHaveBeenCalledTimes(1)
    expect(win.maximize).toHaveBeenCalledTimes(1)
    expect(win.close).toHaveBeenCalledTimes(1)
  })

  it('最大化时再次切换会还原', () => {
    const win = windowStub({ maximized: true })
    fromWebContents.mockReturnValue(win)

    handlerFor(IPC_CHANNELS.appWindowToggleMaximize)({ sender: 'sender' })

    expect(win.unmaximize).toHaveBeenCalledTimes(1)
    expect(win.maximize).not.toHaveBeenCalled()
  })

  it('读取窗口最大化状态', () => {
    fromWebContents.mockReturnValueOnce(windowStub({ maximized: true }))
    expect(handlerFor(IPC_CHANNELS.appWindowGetState)({ sender: 'sender' })).toEqual({
      maximized: true
    })

    fromWebContents.mockReturnValueOnce(windowStub({ maximized: false }))
    expect(handlerFor(IPC_CHANNELS.appWindowGetState)({ sender: 'sender' })).toEqual({
      maximized: false
    })
  })
})
