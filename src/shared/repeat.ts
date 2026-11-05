import { addDaysKey } from './date-key'

export type RepeatKind = 'daily' | 'weekly' | 'monthly' | 'weekday' | 'every' | 'monthlyNth'

/**
 * 存在 `tasks.repeat` 里的文本规则。前三种是历史值，原样保留；
 * 带参数的规则用紧凑格式编码，不新增列也不需要迁移。
 */
export type RepeatRule =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'weekday'
  | `every:${number}`
  | `monthly-nth:${number}:${number}`

export interface RepeatSpec {
  kind: RepeatKind
  /** every：间隔天数（2–30） */
  every?: number
  /** monthlyNth：每月第几个（1–4） */
  nth?: number
  /** monthlyNth：星期几（0=周日 … 6=周六） */
  weekday?: number
}

export const EVERY_MIN = 2
export const EVERY_MAX = 30
export const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function parseRepeat(value: unknown): RepeatSpec | null {
  if (value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'weekday') {
    return { kind: value }
  }
  if (typeof value !== 'string') return null
  const every = /^every:(\d{1,2})$/.exec(value)
  if (every) {
    const days = Number(every[1])
    return days >= EVERY_MIN && days <= EVERY_MAX ? { kind: 'every', every: days } : null
  }
  const nth = /^monthly-nth:([1-4]):([0-6])$/.exec(value)
  if (nth) return { kind: 'monthlyNth', nth: Number(nth[1]), weekday: Number(nth[2]) }
  return null
}

export function isRepeatRule(value: unknown): value is RepeatRule {
  return parseRepeat(value) !== null
}

export function buildRepeatRule(spec: RepeatSpec): RepeatRule | null {
  if (spec.kind === 'every') {
    const days = Math.trunc(spec.every ?? 0)
    return days >= EVERY_MIN && days <= EVERY_MAX ? `every:${days}` : null
  }
  if (spec.kind === 'monthlyNth') {
    const nth = Math.trunc(spec.nth ?? 0)
    const weekday = Math.trunc(spec.weekday ?? -1)
    return nth >= 1 && nth <= 4 && weekday >= 0 && weekday <= 6
      ? `monthly-nth:${nth}:${weekday}`
      : null
  }
  return spec.kind
}

/** 行内标签（不带 ↻ 前缀）；未知规则返回空串。 */
export function describeRepeat(rule: string): string {
  const spec = parseRepeat(rule)
  if (!spec) return ''
  if (spec.kind === 'daily') return '每天'
  if (spec.kind === 'weekly') return '每周'
  if (spec.kind === 'monthly') return '每月'
  if (spec.kind === 'weekday') return '工作日'
  if (spec.kind === 'every') return `每 ${spec.every} 天`
  return `每月第 ${spec.nth} 个${WEEKDAY_NAMES[spec.weekday ?? 1]}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 某年某月的第 n 个星期几；不存在（第 5 个）时返回 null。 */
function nthWeekdayKey(year: number, month: number, nth: number, weekday: number): string | null {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7
  if (day > daysInMonth(year, month)) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

/** 严格晚于 from 的下一个「每月第 n 个星期几」。 */
function nextNthWeekday(from: string, nth: number, weekday: number): string {
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  for (let step = 0; step < 24; step += 1) {
    const key = nthWeekdayKey(year, month, nth, weekday)
    if (key && key > from) return key
    if (month === 12) {
      month = 1
      year += 1
    } else {
      month += 1
    }
  }
  return from
}

/** 下一个工作日：周五 → 周一，周六 / 周日 → 周一。 */
function nextWeekday(from: string): string {
  let next = addDaysKey(from, 1)
  for (let step = 0; step < 7; step += 1) {
    const weekday = new Date(`${next}T00:00:00Z`).getUTCDay()
    if (weekday !== 0 && weekday !== 6) return next
    next = addDaysKey(next, 1)
  }
  return next
}

/**
 * 下一轮的截止日期。
 * 以「本次到期日」为基准向后推，而不是以完成日为基准——
 * 晚了三天才完成的周任务，下一轮仍落在原本那周，不会越拖越偏。
 * 本月没有对应日（1 月 31 日 + 1 月）时收敛到当月最后一天。
 */
export function nextDueDate(rule: RepeatRule, from: string): string {
  const spec = parseRepeat(rule)
  if (!spec) return from
  if (spec.kind === 'daily') return addDaysKey(from, 1)
  if (spec.kind === 'weekly') return addDaysKey(from, 7)
  if (spec.kind === 'every') return addDaysKey(from, spec.every ?? 1)
  if (spec.kind === 'weekday') return nextWeekday(from)
  if (spec.kind === 'monthlyNth') {
    return nextNthWeekday(from, spec.nth ?? 1, spec.weekday ?? 1)
  }

  const [year, month, day] = from.split('-').map(Number)
  const targetMonth = month === 12 ? 1 : month + 1
  const targetYear = month === 12 ? year + 1 : year
  const nextDay = Math.min(day, daysInMonth(targetYear, targetMonth))
  return `${targetYear}-${pad(targetMonth)}-${pad(nextDay)}`
}
