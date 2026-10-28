import { addDaysKey } from './date-key'

export type RepeatRule = 'daily' | 'weekly' | 'monthly'

export function isRepeatRule(value: unknown): value is RepeatRule {
  return value === 'daily' || value === 'weekly' || value === 'monthly'
}

/**
 * 下一轮的截止日期。
 * 以「本次到期日」为基准向后推，而不是以完成日为基准——
 * 晚了三天才完成的周任务，下一轮仍落在原本那周，不会越拖越偏。
 * 本月没有对应日（1 月 31 日 + 1 月）时收敛到当月最后一天。
 */
export function nextDueDate(rule: RepeatRule, from: string): string {
  if (rule === 'daily') return addDaysKey(from, 1)
  if (rule === 'weekly') return addDaysKey(from, 7)

  const [year, month, day] = from.split('-').map(Number)
  const targetMonth = month === 12 ? 1 : month + 1
  const targetYear = month === 12 ? year + 1 : year
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  const nextDay = Math.min(day, lastDay)
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`
}
