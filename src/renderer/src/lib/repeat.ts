import type { RepeatRule } from '../../../shared/ipc'

export type { RepeatRule }
export { isRepeatRule, nextDueDate } from '../../../shared/repeat'

export const REPEAT_LABELS: Record<RepeatRule, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月'
}

/** 行内小标记：↻ 每天 / ↻ 每周 / ↻ 每月。 */
export function repeatLabel(rule: RepeatRule): string {
  return `↻ ${REPEAT_LABELS[rule]}`
}
