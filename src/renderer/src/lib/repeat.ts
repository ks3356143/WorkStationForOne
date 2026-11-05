import type { RepeatRule } from '../../../shared/ipc'
import { describeRepeat } from '../../../shared/repeat'

export type { RepeatKind, RepeatRule, RepeatSpec } from '../../../shared/repeat'
export {
  buildRepeatRule,
  describeRepeat,
  EVERY_MAX,
  EVERY_MIN,
  isRepeatRule,
  nextDueDate,
  parseRepeat,
  WEEKDAY_NAMES
} from '../../../shared/repeat'

/** 行内小标记：↻ 每天 / ↻ 工作日 / ↻ 每 3 天 / ↻ 每月第 2 个周二。 */
export function repeatLabel(rule: RepeatRule): string {
  const text = describeRepeat(rule)
  return text ? `↻ ${text}` : ''
}
