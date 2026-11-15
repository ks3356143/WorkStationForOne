import type { MoodRecord } from '../../../shared/ipc'
import { addDaysKey } from '../../../shared/date-key'

export const MOOD_LEVELS = 5

const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' }
const MOOD_LABELS: Record<number, string> = {
  1: '低落',
  2: '有点低',
  3: '平静',
  4: '不错',
  5: '很棒'
}
const ENERGY_LABELS: Record<number, string> = {
  1: '疲惫',
  2: '偏低',
  3: '一般',
  4: '充足',
  5: '充沛'
}

/** 夹到 1–5 的整数；非数字回退到中位 3。 */
export function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 3
  return Math.min(MOOD_LEVELS, Math.max(1, Math.round(value)))
}

export function moodEmoji(mood: number): string {
  return MOOD_EMOJI[clampLevel(mood)]
}

export function moodLabel(mood: number): string {
  return MOOD_LABELS[clampLevel(mood)]
}

export function energyLabel(energy: number): string {
  return ENERGY_LABELS[clampLevel(energy)]
}

export interface MoodPoint {
  day: string
  mood: number | null
  energy: number | null
}

/** 以 today 结尾、由旧到新的 days 天序列；没有记录的日期补 null。 */
export function moodTrend(records: MoodRecord[], days: number, today: string): MoodPoint[] {
  const byDay = new Map(records.map((item) => [item.day, item]))
  const points: MoodPoint[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addDaysKey(today, -offset)
    const hit = byDay.get(day)
    points.push({ day, mood: hit ? hit.mood : null, energy: hit ? hit.energy : null })
  }
  return points
}

function average(records: MoodRecord[], pick: (item: MoodRecord) => number): number | null {
  if (records.length === 0) return null
  return records.reduce((sum, item) => sum + pick(item), 0) / records.length
}

export function averageMood(records: MoodRecord[]): number | null {
  return average(records, (item) => item.mood)
}

export function averageEnergy(records: MoodRecord[]): number | null {
  return average(records, (item) => item.energy)
}
