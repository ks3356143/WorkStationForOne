import { describe, expect, it } from 'vitest'
import { dayProgress, yearProgress } from './time-progress'

describe('dayProgress', () => {
  it('正午为 0.5', () => {
    expect(dayProgress(new Date(2026, 0, 1, 12, 0, 0))).toBeCloseTo(0.5, 5)
  })
  it('零点为 0', () => {
    expect(dayProgress(new Date(2026, 0, 1, 0, 0, 0))).toBe(0)
  })
  it('夹在 0..1', () => {
    expect(dayProgress(new Date(2026, 0, 1, 23, 59, 59))).toBeLessThan(1)
    expect(dayProgress(new Date(2026, 0, 1, 23, 59, 59))).toBeGreaterThan(0.99)
  })
})

describe('yearProgress', () => {
  it('元旦零点为 0', () => {
    expect(yearProgress(new Date(2026, 0, 1, 0, 0, 0))).toBe(0)
  })
  it('7 月 1 日约半年（非闰年 181/365）', () => {
    expect(yearProgress(new Date(2026, 6, 1, 0, 0, 0))).toBeCloseTo(181 / 365, 5)
  })
  it('闰年按 366 天计', () => {
    expect(yearProgress(new Date(2024, 6, 1, 0, 0, 0))).toBeCloseTo(182 / 366, 5)
  })
  it('年末接近 1 但不到 1', () => {
    const p = yearProgress(new Date(2026, 11, 31, 23, 59, 59))
    expect(p).toBeGreaterThan(0.99)
    expect(p).toBeLessThan(1)
  })
})
