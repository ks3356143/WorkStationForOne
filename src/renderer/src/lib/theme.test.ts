import { describe, expect, it, vi } from 'vitest'
import {
  SKIN_STORAGE_KEY,
  THEME_STORAGE_KEY,
  normalizeSkin,
  normalizeTheme,
  otherSkin,
  otherTheme,
  persistSkin,
  persistTheme,
  readStoredSkin,
  readStoredTheme,
  skinLabel,
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

describe('皮肤取值', () => {
  it('只把 classic 视为经典皮肤，其余回退到棱镜', () => {
    expect(normalizeSkin('classic')).toBe('classic')
    expect(normalizeSkin('prism')).toBe('prism')
    expect(normalizeSkin('aurora')).toBe('prism')
    expect(normalizeSkin(null)).toBe('prism')
    expect(normalizeSkin(undefined)).toBe('prism')
  })

  it('在两套皮肤之间互转', () => {
    expect(otherSkin('prism')).toBe('classic')
    expect(otherSkin('classic')).toBe('prism')
  })

  it('返回中文皮肤名', () => {
    expect(skinLabel('prism')).toBe('棱镜')
    expect(skinLabel('classic')).toBe('经典')
  })
})

describe('皮肤本地存储', () => {
  it('读取已保存的皮肤', () => {
    expect(readStoredSkin({ getItem: () => 'classic' })).toBe('classic')
    expect(readStoredSkin({ getItem: () => 'prism' })).toBe('prism')
  })

  it('没有存储或取值失败时回退棱镜', () => {
    expect(readStoredSkin(undefined)).toBe('prism')
    expect(
      readStoredSkin({
        getItem: () => {
          throw new Error('blocked')
        }
      })
    ).toBe('prism')
  })

  it('持久化皮肤并容忍写入失败', () => {
    const setItem = vi.fn()
    persistSkin('classic', { setItem })
    expect(setItem).toHaveBeenCalledWith(SKIN_STORAGE_KEY, 'classic')

    expect(() =>
      persistSkin('prism', {
        setItem: () => {
          throw new Error('quota')
        }
      })
    ).not.toThrow()
  })

  it('皮肤与主题使用不同的存储键', () => {
    expect(SKIN_STORAGE_KEY).not.toBe(THEME_STORAGE_KEY)
  })
})
