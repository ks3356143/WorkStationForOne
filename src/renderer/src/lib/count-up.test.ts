import { describe, expect, it } from 'vitest'
import { countUpValue, easeOutCubic } from './count-up'

describe('easeOutCubic', () => {
  it('端点为 0 和 1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })
  it('中点 0.875', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 5)
  })
  it('夹住越界输入', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
  })
})

describe('countUpValue', () => {
  it('起止取整', () => {
    expect(countUpValue(0, 100, 0)).toBe(0)
    expect(countUpValue(0, 100, 1)).toBe(100)
  })
  it('中点按缓动插值', () => {
    expect(countUpValue(0, 100, 0.5)).toBe(88)
  })
  it('单调递增', () => {
    let prev = -1
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const v = countUpValue(0, 50, t)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})
