import { addDaysKey, isDateKey } from '../../../shared/date-key'

export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

export const HOURS = Array.from({ length: 24 }, (_, index) => index)
export const MINUTE_STEPS = [0, 15, 30, 45] as const

export interface DayCell {
  key: string
  day: number
  inMonth: boolean
}

export interface YearMonth {
  year: number
  month: number
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 月份前后移动，跨年自动归一；month 为 1–12。 */
export function shiftMonth(year: number, month: number, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 }
}

/**
 * 6×7 月历网格，周一起始。固定 42 格让弹层的行数不随月份跳动。
 */
export function monthGrid({ year, month }: YearMonth): DayCell[] {
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
  const lead = addDaysKey(`${year}-${pad(month)}-01`, -firstWeekday)
  return Array.from({ length: 42 }, (_, index) => {
    const key = addDaysKey(lead, index)
    return {
      key,
      day: Number(key.slice(8)),
      inMonth: Number(key.slice(0, 4)) === year && Number(key.slice(5, 7)) === month
    }
  })
}

/** 周一起始的星期下标，0 = 周一。 */
export function weekdayIndex(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

export function weekdayLabel(key: string): string {
  return `周${WEEKDAYS[weekdayIndex(key)]}`
}

export function formatMonthTitle({ year, month }: YearMonth): string {
  return `${year}年${month}月`
}

function monthDay(key: string): string {
  return `${Number(key.slice(5, 7))}月${Number(key.slice(8))}日`
}

/** 触发按钮上的日期文案：今天/明天/昨天优先，同年省略年份。 */
export function formatDateLabel(key: string, today: string): string {
  if (key === today) return '今天'
  if (key === addDaysKey(today, 1)) return '明天'
  if (key === addDaysKey(today, -1)) return '昨天'
  return key.slice(0, 4) === today.slice(0, 4)
    ? monthDay(key)
    : `${key.slice(0, 4)}年${monthDay(key)}`
}

/** 弹层标题下的完整日期，含星期。 */
export function formatLongDate(key: string): string {
  return `${monthDay(key)} ${weekdayLabel(key)}`
}

export function parseMonth(key: string): YearMonth {
  if (!isDateKey(key)) return { year: 0, month: 0 }
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) }
}

/** 下一个周一的日期键；今天就是周一时返回今天。 */
export function nextMonday(today: string): string {
  const ahead = 7 - weekdayIndex(today)
  return addDaysKey(today, ahead === 7 ? 0 : ahead)
}

export function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function formatTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`
}

export function timeLabel(value: string): string {
  return parseTime(value) ? value : '未设置'
}

/** 任意分钟吸附到最近的 15 分钟刻度。 */
export function snapMinute(minute: number): number {
  const step = 15
  return Math.min(45, Math.round(minute / step) * step)
}
