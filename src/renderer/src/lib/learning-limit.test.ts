import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LEARNING_NEW_PER_DAY,
  LEARNING_NEW_PER_DAY_KEY,
  describeNewPerDay,
  normalizeNewPerDay,
  persistNewPerDay,
  readStoredNewPerDay,
  type StorageLike
} from './learning-limit'

function storage(value: string | null = null): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>()
  if (value !== null) values.set(LEARNING_NEW_PER_DAY_KEY, value)
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => {
      values.set(key, next)
    }
  }
}

describe('learning new-card limit', () => {
  it('缺省与非法值回落到 20', () => {
    expect(DEFAULT_LEARNING_NEW_PER_DAY).toBe(20)
    expect(normalizeNewPerDay(undefined)).toBe(20)
    expect(normalizeNewPerDay('99')).toBe(20)
    expect(normalizeNewPerDay(30.5)).toBe(20)
  })

  it('接受预设档位，0 表示不限', () => {
    expect(normalizeNewPerDay('30')).toBe(30)
    expect(normalizeNewPerDay('0')).toBe(0)
  })

  it('从存储读取并使用同一套校验', () => {
    expect(readStoredNewPerDay(storage())).toBe(20)
    expect(readStoredNewPerDay(storage('50'))).toBe(50)
    expect(readStoredNewPerDay(storage('0'))).toBe(0)
    expect(readStoredNewPerDay(storage('bad'))).toBe(20)
    expect(readStoredNewPerDay(null)).toBe(20)
  })

  it('保存为字符串，读取错误时不影响应用', () => {
    const fake = storage()
    persistNewPerDay(fake, 10)
    expect(fake.values.get(LEARNING_NEW_PER_DAY_KEY)).toBe('10')
    expect(
      readStoredNewPerDay({
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {}
      })
    ).toBe(20)
    expect(() =>
      persistNewPerDay(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('blocked')
          }
        },
        20
      )
    ).not.toThrow()
  })

  it('标签文案区分不限与具体张数', () => {
    expect(describeNewPerDay(0)).toBe('不限')
    expect(describeNewPerDay(20)).toBe('20 张')
  })
})
