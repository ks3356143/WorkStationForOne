import { describe, expect, it } from 'vitest'
import {
  FSRS_DECAY,
  FSRS_PARAMETERS,
  INTERVAL_MAX,
  retrievability,
  scheduleReview,
  type SrsState
} from './srs'

const today = '2026-10-27'
const fresh: SrsState = { repetitions: 0, intervalDays: 0 }
const mature: SrsState = {
  repetitions: 4,
  intervalDays: 10,
  stability: 10,
  difficulty: 5,
  lapses: 0,
  lastReviewOn: '2026-10-17'
}

describe('FSRS-6 参数', () => {
  it('使用 21 个默认参数与官方 decay', () => {
    expect(FSRS_PARAMETERS).toHaveLength(21)
    expect(FSRS_PARAMETERS[0]).toBe(0.212)
    expect(FSRS_PARAMETERS[20]).toBe(0.1542)
    expect(FSRS_DECAY).toBe(0.1542)
  })

  it('可提取性按遗忘曲线衰减，S 天时约为 0.9', () => {
    expect(retrievability(0, 10)).toBe(1)
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 2)
    expect(retrievability(30, 10)).toBeGreaterThan(0.7)
    expect(retrievability(100, 10)).toBeLessThan(0.7)
  })
})

describe('scheduleReview · 新卡', () => {
  it('良好：初始稳定度 2.3 天，排到后天', () => {
    const result = scheduleReview(fresh, 3, today)
    expect(result.stability).toBeCloseTo(2.3065, 3)
    expect(result.intervalDays).toBe(2)
    expect(result.nextReviewOn).toBe('2026-10-29')
    expect(result.repetitions).toBe(1)
    expect(result.lapses).toBe(0)
  })

  it('简单：初始稳定度 8.3 天，排到 8 天后', () => {
    const result = scheduleReview(fresh, 4, today)
    expect(result.stability).toBeCloseTo(8.2956, 3)
    expect(result.intervalDays).toBe(8)
    expect(result.nextReviewOn).toBe('2026-11-04')
  })

  it('困难：初始间隔 1 天', () => {
    const result = scheduleReview(fresh, 2, today)
    expect(result.intervalDays).toBe(1)
  })

  it('重来：留在今天，间隔归零并计一次失误', () => {
    const result = scheduleReview(fresh, 1, today)
    expect(result).toMatchObject({
      repetitions: 0,
      intervalDays: 0,
      nextReviewOn: today,
      lapses: 1
    })
    expect(result.stability).toBeGreaterThan(0)
  })
})

describe('scheduleReview · 已复习卡', () => {
  it('良好让稳定度增长，间隔超过原值', () => {
    const result = scheduleReview(mature, 3, today)
    expect(result.stability).toBeGreaterThan(10)
    expect(result.intervalDays).toBeGreaterThan(10)
    expect(result.repetitions).toBe(5)
  })

  it('评分越高间隔越长：困难 < 良好 < 简单', () => {
    const hard = scheduleReview(mature, 2, today).intervalDays
    const good = scheduleReview(mature, 3, today).intervalDays
    const easy = scheduleReview(mature, 4, today).intervalDays
    expect(hard).toBeLessThan(good)
    expect(good).toBeLessThan(easy)
  })

  it('重来降低稳定度、累计失误并留在今天', () => {
    const result = scheduleReview(mature, 1, today)
    expect(result.stability).toBeLessThan(10)
    expect(result.intervalDays).toBe(0)
    expect(result.nextReviewOn).toBe(today)
    expect(result.lapses).toBe(1)
    expect(result.repetitions).toBe(0)
  })

  it('当天重复复习走短期公式，不倒退', () => {
    const sameDay: SrsState = { ...mature, lastReviewOn: today }
    const result = scheduleReview(sameDay, 3, today)
    expect(result.stability).toBeGreaterThanOrEqual(10)
  })

  it('难度随重来上升、随简单下降并夹在 1–10', () => {
    const again = scheduleReview(mature, 1, today).difficulty
    const easy = scheduleReview(mature, 4, today).difficulty
    expect(again).toBeGreaterThan(5)
    expect(easy).toBeLessThan(5)

    const lowest = scheduleReview({ ...mature, difficulty: 1 }, 4, today).difficulty
    const highest = scheduleReview({ ...mature, difficulty: 10 }, 1, today).difficulty
    expect(lowest).toBeGreaterThanOrEqual(1)
    expect(highest).toBeLessThanOrEqual(10)
  })
})

describe('scheduleReview · 旧 SM-2 数据', () => {
  it('已有间隔的卡以原间隔为初始稳定度，不退回新卡', () => {
    const legacy: SrsState = { repetitions: 3, intervalDays: 12, lastReviewOn: '2026-10-20' }
    const result = scheduleReview(legacy, 3, today)
    expect(result.stability).toBe(12)
    expect(result.intervalDays).toBe(12)
    expect(result.repetitions).toBe(4)
  })
})

describe('scheduleReview · 边界', () => {
  it('稳定度上限对应 365 天间隔', () => {
    const result = scheduleReview(
      { ...mature, stability: 500, lastReviewOn: '2026-10-17' },
      3,
      today
    )
    expect(result.intervalDays).toBe(INTERVAL_MAX)
  })

  it('跨月与跨年推进日期', () => {
    expect(scheduleReview(fresh, 3, '2026-12-31').nextReviewOn).toBe('2027-01-02')
  })

  it('不修改传入状态', () => {
    const state: SrsState = { ...mature }
    scheduleReview(state, 2, today)
    expect(state).toEqual(mature)
  })
})
