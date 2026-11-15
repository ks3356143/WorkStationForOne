import { describe, expect, it } from 'vitest'
import type { MoodRecord } from '../../../shared/ipc'
import {
  averageEnergy,
  averageMood,
  clampLevel,
  energyLabel,
  moodEmoji,
  moodLabel,
  moodTrend
} from './mood'

function record(day: string, mood: number, energy: number): MoodRecord {
  return { day, mood, energy, note: '', updatedAt: 0 }
}

describe('clampLevel', () => {
  it('夹到 1–5 并取整', () => {
    expect(clampLevel(0)).toBe(1)
    expect(clampLevel(6)).toBe(5)
    expect(clampLevel(3.4)).toBe(3)
    expect(clampLevel(3.6)).toBe(4)
  })
  it('非数字回退到 3', () => {
    expect(clampLevel(Number.NaN)).toBe(3)
  })
})

describe('心情/精力标签', () => {
  it('心情 emoji 与文案', () => {
    expect(moodEmoji(1)).toBe('😞')
    expect(moodEmoji(5)).toBe('😄')
    expect(moodLabel(3)).toBe('平静')
  })
  it('精力文案', () => {
    expect(energyLabel(1)).toBe('疲惫')
    expect(energyLabel(5)).toBe('充沛')
  })
  it('越界夹住后仍有标签', () => {
    expect(moodEmoji(9)).toBe('😄')
    expect(energyLabel(0)).toBe('疲惫')
  })
})

describe('moodTrend', () => {
  it('返回指定天数且以今天结尾、由旧到新', () => {
    const trend = moodTrend([], 7, '2026-11-15')
    expect(trend).toHaveLength(7)
    expect(trend[0].day).toBe('2026-11-09')
    expect(trend[6].day).toBe('2026-11-15')
  })
  it('缺失日期补 null', () => {
    const trend = moodTrend([record('2026-11-15', 4, 3)], 3, '2026-11-15')
    expect(trend[0]).toEqual({ day: '2026-11-13', mood: null, energy: null })
    expect(trend[2]).toEqual({ day: '2026-11-15', mood: 4, energy: 3 })
  })
  it('跨月正确', () => {
    const trend = moodTrend([], 3, '2026-11-01')
    expect(trend.map((point) => point.day)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01'])
  })
  it('窗口外的记录不进入', () => {
    const trend = moodTrend([record('2026-10-01', 5, 5)], 7, '2026-11-15')
    expect(trend.every((point) => point.mood === null)).toBe(true)
  })
})

describe('averageMood / averageEnergy', () => {
  it('空列表返回 null', () => {
    expect(averageMood([])).toBeNull()
    expect(averageEnergy([])).toBeNull()
  })
  it('计算均值', () => {
    const records = [record('2026-11-13', 2, 4), record('2026-11-14', 4, 2)]
    expect(averageMood(records)).toBe(3)
    expect(averageEnergy(records)).toBe(3)
  })
})
