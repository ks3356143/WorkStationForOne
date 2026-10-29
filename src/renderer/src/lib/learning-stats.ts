import { addDaysKey, dateKey, daysBetweenKeys } from '../../../shared/date-key'
import type { LearningItemRecord, LearningRating, LearningReviewRecord } from '../../../shared/ipc'
import { retrievability } from '../../../shared/srs'
import { estimatedMinutes } from './learning'

export const FORECAST_DAYS = 7
export const REVIEW_HISTORY_DAYS = 14
export const MATURE_STABILITY_DAYS = 21

const RATING_LABELS: Record<LearningRating, string> = {
  1: '重来',
  2: '困难',
  3: '良好',
  4: '简单'
}

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

export interface ReviewDay {
  day: string
  label: string
  count: number
}

export interface RatingBucket {
  rating: LearningRating
  label: string
  count: number
  share: number
}

/** 只保留本地日期落在 time window 内的复习。 */
function reviewsInWindow(
  reviews: LearningReviewRecord[],
  today: string,
  days: number
): LearningReviewRecord[] {
  const start = addDaysKey(today, -(days - 1))
  return reviews.filter((review) => {
    const day = dateKey(new Date(review.reviewedAt))
    return day >= start && day <= today
  })
}

export function dailyReviewCounts(
  reviews: LearningReviewRecord[],
  today: string,
  days = REVIEW_HISTORY_DAYS
): ReviewDay[] {
  const counts = new Map<string, number>()
  for (const review of reviewsInWindow(reviews, today, days)) {
    const day = dateKey(new Date(review.reviewedAt))
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  return Array.from({ length: days }, (_, index) => {
    const day = addDaysKey(today, index - (days - 1))
    return {
      day,
      label: index === days - 1 ? '今天' : day.slice(5),
      count: counts.get(day) ?? 0
    }
  })
}

export function ratingDistribution(
  reviews: LearningReviewRecord[],
  today: string,
  days = REVIEW_HISTORY_DAYS
): RatingBucket[] {
  const counts: Record<LearningRating, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const review of reviewsInWindow(reviews, today, days)) {
    counts[review.rating] += 1
  }
  const total = counts[1] + counts[2] + counts[3] + counts[4]
  return ([1, 2, 3, 4] as const).map((rating) => ({
    rating,
    label: RATING_LABELS[rating],
    count: counts[rating],
    share: total > 0 ? counts[rating] / total : 0
  }))
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
