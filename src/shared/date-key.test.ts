import { describe, expect, it } from 'vitest'
import { addDaysKey, dateKey, isDateKey } from './date-key'

describe('dateKey', () => {
  it('按本地日期分量格式化', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(dateKey(new Date(2026, 9, 24, 0, 1))).toBe('2026-10-24')
  })
})

describe('addDaysKey', () => {
  it('跨月与跨年按日历日加减', () => {
    expect(addDaysKey('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysKey('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('拒绝非法日期键', () => {
    expect(() => addDaysKey('2026-02-30', 1)).toThrow(RangeError)
    expect(() => addDaysKey('not-a-date', 1)).toThrow(RangeError)
  })
})

describe('isDateKey', () => {
  it('接受真实存在的日期', () => {
    expect(isDateKey('2026-10-24')).toBe(true)
    expect(isDateKey('2028-02-29')).toBe(true)
  })

  it('拒绝格式错误或不存在日期', () => {
    expect(isDateKey('2026-02-29')).toBe(false)
    expect(isDateKey('2026-2-1')).toBe(false)
    expect(isDateKey('nope')).toBe(false)
    expect(isDateKey(20261024)).toBe(false)
  })
})
