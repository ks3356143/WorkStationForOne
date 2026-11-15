import { describe, expect, it } from 'vitest'
import type { FocusRecord } from '../../../shared/ipc'
import { summarizeFocus } from './focus-stats'

function at(day: string): number {
  return new Date(`${day}T10:00:00`).getTime()
}

function record(partial: Partial<FocusRecord> & { startedAt: number }): FocusRecord {
  return {
    id: Math.random().toString(36),
    taskId: null,
    label: '专注',
    kind: 'focus',
    minutes: 25,
    completedAt: partial.startedAt,
    ...partial
  }
}

describe('summarizeFocus', () => {
  it('空记录返回零值与指定天数空柱', () => {
    const summary = summarizeFocus([], '2026-11-15', 7)
    expect(summary.todayMinutes).toBe(0)
    expect(summary.todayCycles).toBe(0)
    expect(summary.totalMinutes).toBe(0)
    expect(summary.dayBars).toHaveLength(7)
    expect(summary.dayBars.every((bar) => bar.minutes === 0)).toBe(true)
    expect(summary.byTask).toEqual([])
  })

  it('今日分钟与轮次只算今天的专注段', () => {
    const records = [
      record({ startedAt: at('2026-11-15'), minutes: 25 }),
      record({ startedAt: at('2026-11-15'), minutes: 10 }),
      record({ startedAt: at('2026-11-14'), minutes: 50 })
    ]
    const summary = summarizeFocus(records, '2026-11-15', 7)
    expect(summary.todayMinutes).toBe(35)
    expect(summary.todayCycles).toBe(2)
    expect(summary.totalMinutes).toBe(85)
  })

  it('休息段不计入工时', () => {
    const records = [
      record({ startedAt: at('2026-11-15'), minutes: 25 }),
      record({ startedAt: at('2026-11-15'), minutes: 5, kind: 'break' })
    ]
    const summary = summarizeFocus(records, '2026-11-15', 7)
    expect(summary.todayMinutes).toBe(25)
    expect(summary.todayCycles).toBe(1)
  })

  it('按本地日期分柱，由旧到新', () => {
    const records = [
      record({ startedAt: at('2026-11-13'), minutes: 20 }),
      record({ startedAt: at('2026-11-15'), minutes: 30 })
    ]
    const summary = summarizeFocus(records, '2026-11-15', 3)
    expect(summary.dayBars.map((bar) => bar.day)).toEqual([
      '2026-11-13',
      '2026-11-14',
      '2026-11-15'
    ])
    expect(summary.dayBars.map((bar) => bar.minutes)).toEqual([20, 0, 30])
  })

  it('按任务汇总并降序，忽略无任务段', () => {
    const records = [
      record({ startedAt: at('2026-11-15'), minutes: 25, taskId: 'a' }),
      record({ startedAt: at('2026-11-15'), minutes: 40, taskId: 'b' }),
      record({ startedAt: at('2026-11-15'), minutes: 10, taskId: 'a' }),
      record({ startedAt: at('2026-11-15'), minutes: 99, taskId: null })
    ]
    const summary = summarizeFocus(records, '2026-11-15', 7)
    expect(summary.byTask).toEqual([
      { taskId: 'b', minutes: 40 },
      { taskId: 'a', minutes: 35 }
    ])
  })
})
