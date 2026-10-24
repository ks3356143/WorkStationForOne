import type { Theme } from '../../../shared/ipc'

// 与 src/renderer/public/theme-init.js 中的键保持一致：该脚本在样式表加载前同步读取。
export const THEME_STORAGE_KEY = 'workstation.theme'

export function normalizeTheme(value: unknown): Theme {
  return value === 'light' ? 'light' : 'dark'
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

export function themeLabel(theme: Theme): string {
  return theme === 'light' ? '白天' : '夜间'
}

export function readStoredTheme(storage?: Pick<Storage, 'getItem'>): Theme {
  if (!storage) return 'dark'
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'dark'
  }
}

export function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

export function syncWindowTheme(theme: Theme): void {
  if (typeof window === 'undefined') return
  void window.ws?.app.setTheme(theme).catch((error) => {
    console.error('[theme] 窗口外观同步失败', error)
  })
}

export function persistTheme(theme: Theme, storage?: Pick<Storage, 'setItem'>): void {
  if (storage) {
    try {
      storage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // 存储不可用时仍应用主题，只是不跨启动保留。
    }
  }
  applyTheme(theme)
  syncWindowTheme(theme)
}
