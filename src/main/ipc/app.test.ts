import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handle, fromWebContents } = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle },
  BrowserWindow: { fromWebContents }
}))

const { registerAppHandlers, registerAppHandlersIPC } = await import('./app')

function windowStub(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    setBackgroundColor: vi.fn(),
    setTitleBarOverlay: vi.fn()
  }
}

function lastHandler() {
  // 备份连接在这些断言里用不到，给个空壳即可
  registerAppHandlers({ db: {} as never, dir: '', dataDir: '' })
  return handle.mock.calls.at(-1)![1] as (event: unknown, value: unknown) => void
}

describe('主题 IPC', () => {
  beforeEach(() => {
    handle.mockClear()
    fromWebContents.mockReset()
  })

  it('拒绝非法主题', () => {
    expect(() => registerAppHandlersIPC.assertTheme('auto')).toThrow(TypeError)
    expect(() => registerAppHandlersIPC.assertTheme(undefined)).toThrow(TypeError)
    expect(registerAppHandlersIPC.assertTheme('light')).toBe('light')
  })

  it('同步窗口背景与标题栏配色', () => {
    const win = windowStub()
    fromWebContents.mockReturnValue(win)

    lastHandler()({ sender: 'sender' }, 'light')

    expect(win.setBackgroundColor).toHaveBeenCalledWith('#EEF2FB')
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#EEF2FB',
      symbolColor: '#35415C',
      height: 52
    })
  })

  it('窗口不可用时跳过外观同步', () => {
    const win = windowStub(true)
    fromWebContents.mockReturnValue(win)

    expect(() => lastHandler()({ sender: 'sender' }, 'dark')).not.toThrow()
    expect(win.setBackgroundColor).not.toHaveBeenCalled()
  })
})
