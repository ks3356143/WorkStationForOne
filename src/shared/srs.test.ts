import { describe, expect, it } from 'vitest'
import { EASE_MAX, EASE_MIN, INTERVAL_MAX, scheduleReview, type SrsState } from './srs'

const fresh: SrsState = { repetitions: 0, intervalDays: 0, ease: 2.5 }
const today = '2026-10-27'

describe('scheduleReview · 首次与二次', () => {
  it('良好：首次 1 天，二次 6 天', () => {
    const first = scheduleReview(fresh, 3, today)
    expect(first).toMatchObject({ repetitions: 1, intervalDays: 1, nextReviewOn: '2026-10-28' })

    const second = scheduleReview(first, 3, '2026-10-28')
    expect(second).toMatchObject({ repetitions: 2, intervalDays: 6, nextReviewOn: '2026-11-03' })
  })

  it('简单：首次 2 天，二次 8 天，并抬高 ease', () => {
    const first = scheduleReview(fresh, 4, today)
    expect(first).toMatchObject({ repetitions: 1, intervalDays: 2, ease: 2.6 })
    expect(first.nextReviewOn).toBe('2026-10-29')

    const second = scheduleReview(first, 4, today)
    expect(second).toMatchObject({ repetitions: 2, intervalDays: 8, ease: 2.7 })
  })

  it('困难：首次 1 天、二次 6 天，并降低 ease', () => {
    const first = scheduleReview(fresh, 2, today)
    expect(first).toMatchObject({ repetitions: 1, intervalDays: 1, ease: 2.36 })

    const second = scheduleReview(first, 2, today)
    expect(second).toMatchObject({ repetitions: 2, intervalDays: 6, ease: 2.22 })
  })
})

describe('scheduleReview · 后续间隔', () => {
  const mature: SrsState = { repetitions: 3, intervalDays: 10, ease: 2.5 }

  it('良好按 ease 相乘', () => {
    const result = scheduleReview(mature, 3, today)
    expect(result).toMatchObject({ repetitions: 4, intervalDays: 25, ease: 2.5 })
    expect(result.nextReviewOn).toBe('2026-11-21')
  })

  it('困难按 1.2 倍增长，不受 ease 影响', () => {
    const result = scheduleReview(mature, 2, today)
    expect(result).toMatchObject({ repetitions: 4, intervalDays: 12 })
  })

  it('简单在 ease 基础上再乘 1.3', () => {
    const result = scheduleReview(mature, 4, today)
    expect(result).toMatchObject({ repetitions: 4, intervalDays: 34, ease: 2.6 })
  })
})

describe('scheduleReview · 重来', () => {
  it('间隔归零并留在今天', () => {
    const result = scheduleReview({ repetitions: 5, intervalDays: 60, ease: 2.5 }, 1, today)
    expect(result).toEqual({
      repetitions: 0,
      intervalDays: 0,
      ease: 2.3,
      nextReviewOn: today
    })
  })

  it('重来后再次良好回到 1 天', () => {
    const reset = scheduleReview({ repetitions: 4, intervalDays: 40, ease: 2.5 }, 1, today)
    expect(scheduleReview(reset, 3, today).intervalDays).toBe(1)
  })
})

describe('scheduleReview · 边界', () => {
  it('ease 不超过上限', () => {
    let state: SrsState = { repetitions: 0, intervalDays: 0, ease: EASE_MAX - 0.05 }
    state = scheduleReview(state, 4, today)
    expect(state.ease).toBe(EASE_MAX)
  })

  it('ease 不低于下限', () => {
    let state: SrsState = { repetitions: 2, intervalDays: 6, ease: EASE_MIN + 0.1 }
    state = scheduleReview(state, 2, today)
    expect(state.ease).toBe(EASE_MIN)
    state = scheduleReview(state, 2, today)
    expect(state.ease).toBe(EASE_MIN)
  })

  it('间隔上限 365 天', () => {
    const result = scheduleReview({ repetitions: 9, intervalDays: 360, ease: 3 }, 4, today)
    expect(result.intervalDays).toBe(INTERVAL_MAX)
  })

  it('间隔至少 1 天', () => {
    const result = scheduleReview({ repetitions: 3, intervalDays: 1, ease: EASE_MIN }, 3, today)
    expect(result.intervalDays).toBe(1)
  })

  it('跨月与跨年推进日期', () => {
    expect(scheduleReview(fresh, 3, '2026-12-31').nextReviewOn).toBe('2027-01-01')
    expect(
      scheduleReview({ repetitions: 3, intervalDays: 10, ease: 3 }, 4, '2027-02-25')
    ).toMatchObject({ intervalDays: 39, nextReviewOn: '2027-04-05' })
  })

  it('不修改传入状态', () => {
    const state: SrsState = { repetitions: 1, intervalDays: 1, ease: 2.5 }
    scheduleReview(state, 1, today)
    expect(state).toEqual({ repetitions: 1, intervalDays: 1, ease: 2.5 })
  })
})
