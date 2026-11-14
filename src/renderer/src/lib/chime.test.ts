import { describe, expect, it } from 'vitest'
import { isChimeEnabled, setChimeEnabled } from './chime'

function mockStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    },
    dump: () => data
  }
}

describe('chime preference', () => {
  it('默认开启', () => {
    expect(isChimeEnabled(mockStorage())).toBe(true)
    expect(isChimeEnabled(undefined)).toBe(true)
  })
  it('off 时关闭', () => {
    expect(isChimeEnabled(mockStorage({ 'workstation.chime': 'off' }))).toBe(false)
  })
  it('setChimeEnabled 持久化', () => {
    const s = mockStorage()
    setChimeEnabled(false, s)
    expect(s.dump()['workstation.chime']).toBe('off')
    expect(isChimeEnabled(s)).toBe(false)
    setChimeEnabled(true, s)
    expect(isChimeEnabled(s)).toBe(true)
  })
})
