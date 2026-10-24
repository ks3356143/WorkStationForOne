import { describe, expect, it, vi } from 'vitest'
import {
  THEME_STORAGE_KEY,
  normalizeTheme,
  otherTheme,
  persistTheme,
  readStoredTheme,
  themeLabel
} from './theme'

describe('主题取值', () => {
  it('只把 light 视为浅色，其余回退到暗色', () => {
    expect(normalizeTheme('light')).toBe('light')
    expect(normalizeTheme('dark')).toBe('dark')
    expect(normalizeTheme('auto')).toBe('dark')
    expect(normalizeTheme(null)).toBe('dark')
    expect(normalizeTheme(undefined)).toBe('dark')
  })

  it('在两个主题之间互转', () => {
    expect(otherTheme('dark')).toBe('light')
    expect(otherTheme('light')).toBe('dark')
  })

  it('返回中文模式名', () => {
    expect(themeLabel('light')).toBe('白天')
    expect(themeLabel('dark')).toBe('夜间')
  })
})

describe('本地存储', () => {
  it('读取已保存的主题', () => {
    expect(readStoredTheme({ getItem: () => 'light' })).toBe('light')
    expect(readStoredTheme({ getItem: () => 'dark' })).toBe('dark')
  })

  it('没有存储或取值失败时回退暗色', () => {
    expect(readStoredTheme(undefined)).toBe('dark')
    expect(
      readStoredTheme({
        getItem: () => {
          throw new Error('blocked')
        }
      })
    ).toBe('dark')
  })

  it('持久化主题并容忍写入失败', () => {
    const setItem = vi.fn()
    persistTheme('light', { setItem })
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light')

    expect(() =>
      persistTheme('dark', {
        setItem: () => {
          throw new Error('quota')
        }
      })
    ).not.toThrow()
  })
})
