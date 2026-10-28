import { describe, expect, it } from 'vitest'
import type { Habit } from '../types'
import {
  bestStreak,
  currentStreak,
  habitsDoneToday,
  isCheckedOn,
  toggleCheckin,
  weekFlags,
  weekKeys
} from './habits'

const TODAY = '2026-10-28' // 周三
const habit = (checkins: string[]): Habit => ({ id: 'h1', name: '喝水', checkins })

describe('weekKeys', () => {
  it('周一起始，覆盖到周日', () => {
    expect(weekKeys(TODAY)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01'
    ])
  })

  it('周日取当周，不跳到下一周', () => {
    expect(weekKeys('2026-11-01')[0]).toBe('2026-10-26')
  })

  it('跨月的周仍然连续', () => {
    expect(weekKeys('2026-10-01')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04'
    ])
  })
})

describe('weekFlags', () => {
  it('按日期映射到七格，未来留空', () => {
    const flags = weekFlags(habit(['2026-10-26', '2026-10-30', '2026-11-01']), TODAY)
    // 10-30 与 11-01 在本周但还没到，必须留空
    expect(flags).toEqual([true, false, false, false, false, false, false])
  })

  it('今天的打卡能看见', () => {
    expect(weekFlags(habit([TODAY]), TODAY)[2]).toBe(true)
  })

  it('上周的记录不影响本周', () => {
    expect(weekFlags(habit(['2026-10-20']), TODAY)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false
    ])
  })
})

describe('toggleCheckin', () => {
  it('今天未打卡则加上', () => {
    expect(toggleCheckin(habit([]), TODAY, TODAY).checkins).toEqual([TODAY])
  })

  it('已打卡则取消', () => {
    expect(toggleCheckin(habit([TODAY]), TODAY, TODAY).checkins).toEqual([])
  })

  it('未来日期不写记录', () => {
    expect(toggleCheckin(habit([]), '2026-10-30', TODAY).checkins).toEqual([])
  })

  it('过去的日期允许补卡，结果按日期排序', () => {
    expect(toggleCheckin(habit(['2026-10-26']), '2026-10-27', TODAY).checkins).toEqual([
      '2026-10-26',
      '2026-10-27'
    ])
  })

  it('不改原对象', () => {
    const source = habit([])
    toggleCheckin(source, TODAY, TODAY)
    expect(source.checkins).toEqual([])
  })
})

describe('isCheckedOn 与 habitsDoneToday', () => {
  it('按日期判断与计数', () => {
    const habits = [habit([TODAY]), { id: 'h2', name: '阅读', checkins: [] }]
    expect(isCheckedOn(habits[0], TODAY)).toBe(true)
    expect(habitsDoneToday(habits, TODAY)).toBe(1)
  })
})

describe('currentStreak', () => {
  const habit = (checkins: string[]) => ({ id: 'h1', name: '喝水', checkins })

  it('今天打过卡就从今天往前数', () => {
    expect(currentStreak(habit(['2026-10-26', '2026-10-27', '2026-10-28']), '2026-10-28')).toBe(3)
  })

  it('今天还没打卡时从昨天数，不算断', () => {
    expect(currentStreak(habit(['2026-10-26', '2026-10-27']), '2026-10-28')).toBe(2)
  })

  it('中间断一天就只算到断点', () => {
    expect(currentStreak(habit(['2026-10-20', '2026-10-26', '2026-10-27']), '2026-10-28')).toBe(2)
  })

  it('完全没打过卡是 0', () => {
    expect(currentStreak(habit([]), '2026-10-28')).toBe(0)
    expect(currentStreak(habit(['2026-09-01']), '2026-10-28')).toBe(0)
  })

  it('跨月连续也算', () => {
    expect(currentStreak(habit(['2026-09-30', '2026-10-01']), '2026-10-01')).toBe(2)
  })
})

describe('bestStreak', () => {
  const habit = (checkins: string[]) => ({ id: 'h1', name: '喝水', checkins })

  it('找出历史最长的一段', () => {
    expect(
      bestStreak(habit(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06']))
    ).toBe(3)
  })

  it('重复日期不会把连续算多', () => {
    expect(bestStreak(habit(['2026-10-01', '2026-10-01', '2026-10-02']))).toBe(2)
  })

  it('空记录是 0，单天是 1', () => {
    expect(bestStreak(habit([]))).toBe(0)
    expect(bestStreak(habit(['2026-10-01']))).toBe(1)
  })
})
