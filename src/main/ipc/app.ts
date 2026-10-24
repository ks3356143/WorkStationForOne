import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS, type Theme } from '../../shared/ipc'

export const WINDOW_PALETTE: Record<Theme, { background: string; symbol: string }> = {
  dark: { background: '#070812', symbol: '#B7C9DC' },
  light: { background: '#EEF2FB', symbol: '#35415C' }
}

export const TITLE_BAR_HEIGHT = 52

function assertTheme(value: unknown): Theme {
  if (value !== 'dark' && value !== 'light') throw new TypeError('主题无效')
  return value
}

export const registerAppHandlersIPC = { assertTheme } as const

export function registerAppHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appSetTheme, (event, value: unknown) => {
    const theme = assertTheme(value)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const palette = WINDOW_PALETTE[theme]
    win.setBackgroundColor(palette.background)
    win.setTitleBarOverlay({
      color: palette.background,
      symbolColor: palette.symbol,
      height: TITLE_BAR_HEIGHT
    })
  })
}
