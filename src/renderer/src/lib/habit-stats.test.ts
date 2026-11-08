import { describe, expect, it } from 'vitest'
import type { Habit } from '../types'
import { habitHeatmap, habitStats } from './habit-stats'

const TODAY = '2026-11-06'

function habit(overrides: Partial<Habit> = {}): Habit {
  return { id: 'h', name: '阅读', checkins: [], ...overrides }
}

describe('habitHeatmap', () => {
  it('按周一起始铺满 26 周，未来日期留空', () => {
    const map = habitHeatmap(
      habit({
        checkins: [
          '2026-10-01',
          '2026-11-01',
          '2026-11-04',
          '2026-11-05',
          '2026-11-06',
          '2026-11-07'
        ]
      }),
      TODAY
    )

    expect(map.weeks).toHaveLength(26)
    expect(map.weeks.every((week) => week.days.length === 7)).toBe(true)
    const last = map.weeks[25].days
    expect(last[4]).toMatchObject({ key: '2026-11-06', done: true })
    expect(last[5]).toBeNull()
    expect(last[6]).toBeNull()
    expect(map.total).toBe(5)
    expect(map.activeDays).toBe(5)
    expect(map.end).toBe(TODAY)
  })

  it('空习惯也返回完整网格', () => {
    const map = habitHeatmap(habit(), TODAY)

    expect(map.weeks).toHaveLength(26)
    expect(map.total).toBe(0)
    expect(map.activeDays).toBe(0)
  })
})

describe('habitStats', () => {
  it('汇总当前与最佳连续、累计与近 30 天完成率', () => {
    const stats = habitStats(
      habit({
        checkins: [
          '2026-10-01',
          '2026-11-01',
          '2026-11-04',
          '2026-11-05',
          '2026-11-06',
          '2026-11-07'
        ]
      }),
      TODAY
    )

    expect(stats.current).toBe(3)
    expect(stats.best).toBe(3)
    expect(stats.total).toBe(5)
    expect(stats.last30Days).toBe(30)
    expect(stats.last30Done).toBe(4)
    expect(stats.rate).toBeCloseTo(4 / 30)
  })

  it('今天还没打卡时连续从昨天算', () => {
    expect(habitStats(habit({ checkins: ['2026-11-04', '2026-11-05'] }), TODAY).current).toBe(2)
  })

  it('空习惯返回零值', () => {
    expect(habitStats(habit(), TODAY)).toEqual({
      current: 0,
      best: 0,
      total: 0,
      last30Days: 30,
      last30Done: 0,
      rate: 0
    })
  })
})
