import { describe, expect, it } from 'vitest'
import {
  buildRepeatRule,
  describeRepeat,
  isRepeatRule,
  nextDueDate,
  parseRepeat,
  repeatLabel
} from './repeat'

describe('nextDueDate', () => {
  it('每天与每周按天数推进', () => {
    expect(nextDueDate('daily', '2026-10-28')).toBe('2026-10-29')
    expect(nextDueDate('weekly', '2026-10-28')).toBe('2026-11-04')
  })

  it('工作日跳过周末', () => {
    expect(nextDueDate('weekday', '2026-11-06')).toBe('2026-11-09')
    expect(nextDueDate('weekday', '2026-11-07')).toBe('2026-11-09')
    expect(nextDueDate('weekday', '2026-11-08')).toBe('2026-11-09')
    expect(nextDueDate('weekday', '2026-11-09')).toBe('2026-11-10')
  })

  it('每 N 天按天数推进并跨月', () => {
    expect(nextDueDate('every:3', '2026-10-30')).toBe('2026-11-02')
    expect(nextDueDate('every:14', '2026-12-25')).toBe('2027-01-08')
  })

  it('每月第 N 个周几按下一个匹配日推进', () => {
    // 2026-11-03 是 11 月第一个周二，下一个「第 2 个周二」是 11-10
    expect(nextDueDate('monthly-nth:2:2', '2026-11-03')).toBe('2026-11-10')
    expect(nextDueDate('monthly-nth:2:2', '2026-11-10')).toBe('2026-12-08')
    // 2027-01-01 是周五，第一个周日是 01-03
    expect(nextDueDate('monthly-nth:1:0', '2026-12-20')).toBe('2027-01-03')
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

describe('parseRepeat / buildRepeatRule', () => {
  it('历史规则与带参数规则都能解析', () => {
    expect(parseRepeat('daily')).toEqual({ kind: 'daily' })
    expect(parseRepeat('weekday')).toEqual({ kind: 'weekday' })
    expect(parseRepeat('every:3')).toEqual({ kind: 'every', every: 3 })
    expect(parseRepeat('monthly-nth:2:1')).toEqual({
      kind: 'monthlyNth',
      nth: 2,
      weekday: 1
    })
  })

  it('拒绝越界与畸形规则', () => {
    expect(parseRepeat('every:1')).toBeNull()
    expect(parseRepeat('every:31')).toBeNull()
    expect(parseRepeat('every:3.5')).toBeNull()
    expect(parseRepeat('monthly-nth:5:1')).toBeNull()
    expect(parseRepeat('monthly-nth:2:7')).toBeNull()
    expect(parseRepeat('yearly')).toBeNull()
    expect(isRepeatRule(null)).toBe(false)
    expect(isRepeatRule('every:3')).toBe(true)
  })

  it('buildRepeatRule 序列化并做范围校验', () => {
    expect(buildRepeatRule({ kind: 'every', every: 3 })).toBe('every:3')
    expect(buildRepeatRule({ kind: 'every', every: 1 })).toBeNull()
    expect(buildRepeatRule({ kind: 'monthlyNth', nth: 2, weekday: 1 })).toBe('monthly-nth:2:1')
    expect(buildRepeatRule({ kind: 'monthlyNth', nth: 5, weekday: 1 })).toBeNull()
    expect(buildRepeatRule({ kind: 'weekday' })).toBe('weekday')
  })
})

describe('repeatLabel', () => {
  it('中文标签带 ↻ 前缀', () => {
    expect(repeatLabel('daily')).toBe('↻ 每天')
    expect(repeatLabel('weekly')).toBe('↻ 每周')
    expect(repeatLabel('monthly')).toBe('↻ 每月')
    expect(repeatLabel('weekday')).toBe('↻ 工作日')
    expect(repeatLabel('every:3')).toBe('↻ 每 3 天')
    expect(repeatLabel('monthly-nth:2:2')).toBe('↻ 每月第 2 个周二')
  })

  it('未知规则不产出标记', () => {
    expect(describeRepeat('yearly')).toBe('')
  })
})
