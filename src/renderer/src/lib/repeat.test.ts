import { describe, expect, it } from 'vitest'
import { isRepeatRule, nextDueDate, repeatLabel } from './repeat'

describe('nextDueDate', () => {
  it('每天与每周按天数推进', () => {
    expect(nextDueDate('daily', '2026-10-28')).toBe('2026-10-29')
    expect(nextDueDate('weekly', '2026-10-28')).toBe('2026-11-04')
  })

  it('跨月与跨年都正确', () => {
    expect(nextDueDate('daily', '2026-10-31')).toBe('2026-11-01')
    expect(nextDueDate('weekly', '2026-12-28')).toBe('2027-01-04')
    expect(nextDueDate('monthly', '2026-12-15')).toBe('2027-01-15')
  })

  it('每月推进时本月没有对应日就收敛到月末', () => {
    expect(nextDueDate('monthly', '2026-01-31')).toBe('2026-02-28')
    expect(nextDueDate('monthly', '2028-01-31')).toBe('2028-02-29')
    expect(nextDueDate('monthly', '2026-03-31')).toBe('2026-04-30')
  })

  it('每月推动时不改变已有日期', () => {
    expect(nextDueDate('monthly', '2026-10-15')).toBe('2026-11-15')
  })
})

describe('isRepeatRule', () => {
  it('只认三种规则', () => {
    expect(isRepeatRule('daily')).toBe(true)
    expect(isRepeatRule('weekly')).toBe(true)
    expect(isRepeatRule('monthly')).toBe(true)
    expect(isRepeatRule('yearly')).toBe(false)
    expect(isRepeatRule('')).toBe(false)
    expect(isRepeatRule(null)).toBe(false)
  })
})

describe('repeatLabel', () => {
  it('中文标签带 ↻ 前缀', () => {
    expect(repeatLabel('daily')).toBe('↻ 每天')
    expect(repeatLabel('weekly')).toBe('↻ 每周')
    expect(repeatLabel('monthly')).toBe('↻ 每月')
  })
})
