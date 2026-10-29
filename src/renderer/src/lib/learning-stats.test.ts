import { describe, expect, it } from 'vitest'
import type { LearningItemRecord } from '../../../shared/ipc'
import { learningStats } from './learning-stats'

function card(overrides: Partial<LearningItemRecord> = {}): LearningItemRecord {
  return {
    id: 'l1',
    subject: '英语二',
    title: 'analyze',
    repetitions: 0,
    intervalDays: 0,
    ease: 2.5,
    nextReviewOn: '2026-10-29',
    active: true,
    ...overrides
  }
}

const today = '2026-10-29'

describe('learningStats · 未来负载', () => {
  it('逾期归今天，未来 7 天按复习日分桶', () => {
    const stats = learningStats(
      [
        card({ id: 'a', nextReviewOn: '2026-10-29' }),
        card({ id: 'b', nextReviewOn: '2026-10-25' }),
        card({ id: 'c', nextReviewOn: '2026-10-30' }),
        card({ id: 'd', nextReviewOn: '2026-11-05' })
      ],
      today
    )

    expect(stats.forecast).toHaveLength(7)
    expect(stats.forecast[0]).toMatchObject({ day: '2026-10-29', count: 2 })
    expect(stats.forecast[1]).toMatchObject({ day: '2026-10-30', count: 1 })
    expect(stats.forecast.reduce((sum, day) => sum + day.count, 0)).toBe(3)
  })

  it('分钟数与卡片数同口径，停用卡完全排除', () => {
    const stats = learningStats(
      [card({ id: 'a' }), card({ id: 'b' }), card({ id: 'off', active: false })],
      today
    )
    expect(stats.forecast[0]).toMatchObject({ count: 2, minutes: 3 })
    expect(stats.totalActive).toBe(2)
  })
})

describe('learningStats · 保持率与掌握度', () => {
  it('只统计有 FSRS 状态的启用卡', () => {
    const stats = learningStats(
      [
        card({ id: 'a', stability: 10, lastReviewOn: '2026-10-19', repetitions: 2 }),
        card({ id: 'b', stability: 30, lastReviewOn: '2026-10-01', repetitions: 3 }),
        card({ id: 'new', stability: undefined }),
        card({ id: 'legacy', repetitions: 4 })
      ],
      today
    )

    expect(stats.retention).toBeCloseTo(0.9, 2)
    expect(stats.reviewed).toBe(2)
  })

  it('没有可估算的卡时保持率为 null', () => {
    expect(learningStats([card()], today).retention).toBeNull()
  })

  it('新卡 / 学习中 / 成熟卡按 21 天分档', () => {
    const stats = learningStats(
      [
        card({ id: 'fresh' }),
        card({ id: 'legacy', repetitions: 2 }),
        card({ id: 'young', stability: 10, lastReviewOn: '2026-10-20' }),
        card({ id: 'mature', stability: 21, lastReviewOn: '2026-09-20' }),
        card({ id: 'old', stability: 60, lastReviewOn: '2026-09-01' })
      ],
      today
    )

    expect(stats.mastery).toEqual({ fresh: 1, learning: 2, mature: 2 })
  })

  it('空库返回零值', () => {
    const stats = learningStats([], today)
    expect(stats.retention).toBeNull()
    expect(stats.mastery).toEqual({ fresh: 0, learning: 0, mature: 0 })
    expect(stats.forecast.every((day) => day.count === 0)).toBe(true)
  })
})
