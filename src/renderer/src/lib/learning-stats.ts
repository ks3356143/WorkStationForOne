import { addDaysKey, daysBetweenKeys } from '../../../shared/date-key'
import type { LearningItemRecord } from '../../../shared/ipc'
import { retrievability } from '../../../shared/srs'
import { estimatedMinutes } from './learning'

export const FORECAST_DAYS = 7
export const MATURE_STABILITY_DAYS = 21

export interface ForecastDay {
  day: string
  label: string
  count: number
  minutes: number
}

export interface MasteryCounts {
  fresh: number
  learning: number
  mature: number
}

export interface LearningStatistics {
  forecast: ForecastDay[]
  /** 平均预测回忆概率；没有可估算的卡时为 null */
  retention: number | null
  reviewed: number
  mastery: MasteryCounts
  totalActive: number
}

function labelFor(day: string, today: string, index: number): string {
  if (index === 0) return '今天'
  if (day === addDaysKey(today, 1)) return '明天'
  return day.slice(5)
}

export function learningStats(items: LearningItemRecord[], today: string): LearningStatistics {
  const active = items.filter((item) => item.active)
  const days = Array.from({ length: FORECAST_DAYS }, (_, index) => {
    const day = addDaysKey(today, index)
    return { day, label: labelFor(day, today, index), count: 0, minutes: 0 }
  })

  for (const item of active) {
    if (item.nextReviewOn > addDaysKey(today, FORECAST_DAYS - 1)) continue
    const bucket =
      item.nextReviewOn <= today ? 0 : days.findIndex((day) => day.day === item.nextReviewOn)
    if (bucket >= 0) days[bucket].count += 1
  }
  for (const day of days) day.minutes = estimatedMinutes(day.count)

  const reviewedItems = active.filter(
    (item): item is LearningItemRecord & { stability: number; lastReviewOn: string } =>
      item.stability !== undefined && item.stability > 0 && item.lastReviewOn !== undefined
  )
  const retention =
    reviewedItems.length === 0
      ? null
      : reviewedItems.reduce((sum, item) => {
          const elapsed = Math.max(0, daysBetweenKeys(item.lastReviewOn, today))
          return sum + retrievability(elapsed, item.stability)
        }, 0) / reviewedItems.length

  const mastery: MasteryCounts = { fresh: 0, learning: 0, mature: 0 }
  for (const item of active) {
    if (item.stability === undefined && item.repetitions === 0) {
      mastery.fresh += 1
    } else if (item.stability !== undefined && item.stability >= MATURE_STABILITY_DAYS) {
      mastery.mature += 1
    } else {
      mastery.learning += 1
    }
  }

  return {
    forecast: days,
    retention,
    reviewed: reviewedItems.length,
    mastery,
    totalActive: active.length
  }
}
