import { addDaysKey, dateKey, daysBetweenKeys } from './date-key'

/**
 * FSRS-6（py-fsrs 6.x 默认参数）。本应用按「天」调度，不跑分钟级 learning steps：
 * 评分 1 留在今天，其余按稳定度排出下一次复习日。
 */
export const FSRS_PARAMETERS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
] as const

export const FSRS_DECAY = FSRS_PARAMETERS[20]
export const FSRS_RETENTION = 0.9
export const INTERVAL_MAX = 365

const NEG_DECAY = -FSRS_DECAY
const FACTOR = FSRS_RETENTION ** (1 / NEG_DECAY) - 1
const MIN_STABILITY = 0.001

export interface SrsState {
  repetitions: number
  intervalDays: number
  /** FSRS 稳定度（天）；旧数据没有这个值，按原间隔初始化。 */
  stability?: number
  difficulty?: number
  lapses?: number
  lastReviewOn?: string
  lastReviewedAt?: number
}

export interface SrsResult {
  repetitions: number
  intervalDays: number
  stability: number
  difficulty: number
  lapses: number
  nextReviewOn: string
}

export type SrsRating = 1 | 2 | 3 | 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampDifficulty(value: number): number {
  return clamp(value, 1, 10)
}

function clampStability(value: number): number {
  return Math.max(MIN_STABILITY, value)
}

function initialStability(rating: SrsRating): number {
  return clampStability(FSRS_PARAMETERS[rating - 1])
}

function initialDifficultyRaw(rating: SrsRating): number {
  return FSRS_PARAMETERS[4] - Math.exp(FSRS_PARAMETERS[5] * (rating - 1)) + 1
}

function initialDifficulty(rating: SrsRating): number {
  return clampDifficulty(initialDifficultyRaw(rating))
}

function nextDifficulty(difficulty: number, rating: SrsRating): number {
  const delta = -(FSRS_PARAMETERS[6] * (rating - 3))
  const damped = difficulty + ((10 - difficulty) * delta) / 9
  const reverted = FSRS_PARAMETERS[7] * initialDifficultyRaw(4) + (1 - FSRS_PARAMETERS[7]) * damped
  return clampDifficulty(reverted)
}

/** 任意时刻的回忆概率：S 天时约 0.9。 */
export function retrievability(elapsedDays: number, stability: number): number {
  const safeStability = Math.max(stability, MIN_STABILITY)
  return (1 + (FACTOR * Math.max(0, elapsedDays)) / safeStability) ** NEG_DECAY
}

function recallStability(
  difficulty: number,
  stability: number,
  recall: number,
  rating: SrsRating
): number {
  const hardPenalty = rating === 2 ? FSRS_PARAMETERS[15] : 1
  const easyBonus = rating === 4 ? FSRS_PARAMETERS[16] : 1
  const growth =
    Math.exp(FSRS_PARAMETERS[8]) *
    (11 - difficulty) *
    stability ** -FSRS_PARAMETERS[9] *
    (Math.exp((1 - recall) * FSRS_PARAMETERS[10]) - 1) *
    hardPenalty *
    easyBonus
  return clampStability(stability * (1 + growth))
}

function forgetStability(difficulty: number, stability: number, recall: number): number {
  const longTerm =
    FSRS_PARAMETERS[11] *
    difficulty ** -FSRS_PARAMETERS[12] *
    ((stability + 1) ** FSRS_PARAMETERS[13] - 1) *
    Math.exp((1 - recall) * FSRS_PARAMETERS[14])
  const shortTerm = stability / Math.exp(FSRS_PARAMETERS[17] * FSRS_PARAMETERS[18])
  return clampStability(Math.min(longTerm, shortTerm))
}

/** 当天重复复习走短期公式；非重来的评分至少不降低稳定度。 */
function shortTermStability(stability: number, rating: SrsRating): number {
  let increase =
    Math.exp(FSRS_PARAMETERS[17] * (rating - 3 + FSRS_PARAMETERS[18])) *
    stability ** -FSRS_PARAMETERS[19]
  if (rating !== 1) increase = Math.max(1, increase)
  return clampStability(stability * increase)
}

function nextInterval(stability: number): number {
  const raw = (stability / FACTOR) * (FSRS_RETENTION ** (1 / NEG_DECAY) - 1)
  return clamp(Math.round(raw), 1, INTERVAL_MAX)
}

/**
 * 今天评分，返回下一次复习日。
 * 新卡与旧 SM-2 数据都没有 FSRS 状态：新卡用初始参数，旧卡沿用原间隔作为稳定度，
 * 不伪造复习历史。评分 1 留在今天的到期队列，不产生跨天排期。
 */
export function scheduleReview(state: SrsState, rating: SrsRating, today: string): SrsResult {
  const repetitions = Math.max(0, state.repetitions)
  const lapses = Math.max(0, state.lapses ?? 0)
  const lastReviewOn =
    state.lastReviewOn ??
    (state.lastReviewedAt ? dateKey(new Date(state.lastReviewedAt)) : undefined)
  const hasState = state.stability !== undefined && state.stability > 0

  if (!hasState) {
    const legacyInterval = Math.max(0, state.intervalDays)
    const stability = Math.max(
      repetitions > 0 && legacyInterval > 0 ? legacyInterval : 0,
      initialStability(rating)
    )
    const interval = rating === 1 ? 0 : nextInterval(stability)
    return {
      repetitions: rating === 1 ? 0 : repetitions + 1,
      intervalDays: interval,
      stability,
      difficulty: initialDifficulty(rating),
      lapses: lapses + (rating === 1 ? 1 : 0),
      nextReviewOn: rating === 1 ? today : addDaysKey(today, interval)
    }
  }

  const stability = Math.max(state.stability ?? 0, MIN_STABILITY)
  const difficulty = clampDifficulty(state.difficulty ?? initialDifficulty(3))
  const elapsed = lastReviewOn ? Math.max(0, daysBetweenKeys(lastReviewOn, today)) : 0
  const recall = retrievability(elapsed, stability)

  let nextStability: number
  if (elapsed === 0) nextStability = shortTermStability(stability, rating)
  else if (rating === 1) nextStability = forgetStability(difficulty, stability, recall)
  else nextStability = recallStability(difficulty, stability, recall, rating)

  const interval = rating === 1 ? 0 : nextInterval(nextStability)
  return {
    repetitions: rating === 1 ? 0 : repetitions + 1,
    intervalDays: interval,
    stability: nextStability,
    difficulty: nextDifficulty(difficulty, rating),
    lapses: lapses + (rating === 1 ? 1 : 0),
    nextReviewOn: rating === 1 ? today : addDaysKey(today, interval)
  }
}
