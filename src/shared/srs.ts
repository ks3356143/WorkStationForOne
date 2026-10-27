import { addDaysKey } from './date-key'

export interface SrsState {
  repetitions: number
  intervalDays: number
  ease: number
}

export interface SrsResult extends SrsState {
  nextReviewOn: string
}

export type SrsRating = 1 | 2 | 3 | 4

export const EASE_MIN = 1.3
export const EASE_MAX = 3.0
export const INTERVAL_MAX = 365

function clampEase(value: number): number {
  return Math.min(EASE_MAX, Math.max(EASE_MIN, Math.round(value * 100) / 100))
}

function clampInterval(value: number): number {
  return Math.min(INTERVAL_MAX, Math.max(1, Math.round(value)))
}

/**
 * 间隔重复调度：今天评分，返回下一次复习日。
 * 评分为 1 时留在今天的到期队列，不产生跨天排期。
 */
export function scheduleReview(state: SrsState, rating: SrsRating, today: string): SrsResult {
  if (rating === 1) {
    return {
      repetitions: 0,
      intervalDays: 0,
      ease: clampEase(state.ease - 0.2),
      nextReviewOn: today
    }
  }

  const repetitions = state.repetitions + 1
  const ease = clampEase(state.ease + (rating === 4 ? 0.1 : rating === 2 ? -0.14 : 0))
  const first = repetitions === 1
  const second = repetitions === 2

  let intervalDays: number
  if (rating === 4) {
    if (first) intervalDays = 2
    else if (second) intervalDays = 8
    else intervalDays = clampInterval(state.intervalDays * ease * 1.3)
  } else if (rating === 2) {
    if (first) intervalDays = 1
    else if (second) intervalDays = 6
    else intervalDays = clampInterval(state.intervalDays * 1.2)
  } else {
    if (first) intervalDays = 1
    else if (second) intervalDays = 6
    else intervalDays = clampInterval(state.intervalDays * ease)
  }

  return {
    repetitions,
    intervalDays,
    ease,
    nextReviewOn: addDaysKey(today, intervalDays)
  }
}
