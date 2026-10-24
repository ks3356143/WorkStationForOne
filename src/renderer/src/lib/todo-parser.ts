import { addDaysKey, dateKey, isDateKey } from '../../../shared/date-key'

export type ParsedPriority = 1 | 2 | 3

export interface ParsedTaskInput {
  title: string
  dueDate?: string
  time?: string
  priority?: ParsedPriority
  list?: string
}

const WEEKDAYS: Record<string, number> = {
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  日: 6,
  天: 6
}

const PRIORITIES: Record<string, ParsedPriority> = {
  高: 1,
  中: 2,
  低: 3
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function weekdayIndex(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return (new Date(year, month - 1, day).getDay() + 6) % 7
}

function validKey(year: number, month: number, day: number): string | undefined {
  const key = `${year}-${pad(month)}-${pad(day)}`
  return isDateKey(key) ? key : undefined
}

function remove(rest: string, match: RegExpExecArray): string {
  return `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`
}

export function parseTaskInput(input: string, today = dateKey()): ParsedTaskInput {
  let rest = input
  let dueDate: string | undefined
  let time: string | undefined
  let priority: ParsedPriority | undefined
  let list: string | undefined

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(rest)
  if (iso && isDateKey(iso[0])) {
    dueDate = iso[0]
    rest = remove(rest, iso)
  }

  if (!dueDate) {
    const chineseDate = /(\d{1,2})月(\d{1,2})日/.exec(rest)
    if (chineseDate) {
      let year = Number(today.slice(0, 4))
      let candidate = validKey(year, Number(chineseDate[1]), Number(chineseDate[2]))
      if (candidate) {
        if (candidate < today) candidate = validKey(year + 1, Number(chineseDate[1]), Number(chineseDate[2]))
        if (candidate) {
          dueDate = candidate
          rest = remove(rest, chineseDate)
        }
      }
    }
  }

  if (!dueDate) {
    const relative = /(今天|明天|后天)/.exec(rest)
    if (relative) {
      const offset = relative[1] === '今天' ? 0 : relative[1] === '明天' ? 1 : 2
      dueDate = addDaysKey(today, offset)
      rest = remove(rest, relative)
    }
  }

  if (!dueDate) {
    const weekday = /(下周|周|星期)([一二三四五六日天])/.exec(rest)
    if (weekday) {
      const target = WEEKDAYS[weekday[2]]
      const index = weekdayIndex(today)
      const offset = weekday[1] === '下周' ? 7 - index + target : (target - index + 7) % 7
      dueDate = addDaysKey(today, offset)
      rest = remove(rest, weekday)
    }
  }

  const clock = /(\d{1,2}):(\d{2})/.exec(rest)
  if (clock) {
    const hour = Number(clock[1])
    const minute = Number(clock[2])
    if (hour < 24 && minute < 60) {
      time = `${pad(hour)}:${pad(minute)}`
      rest = remove(rest, clock)
    }
  }

  if (!time) {
    const chineseTime = /(上午|早上|中午|下午|晚上|今晚)?\s*(\d{1,2})点(半|(\d{1,2})分?)?/.exec(rest)
    if (chineseTime) {
      const period = chineseTime[1]
      let hour = Number(chineseTime[2])
      const minute = chineseTime[3] === '半' ? 30 : chineseTime[4] ? Number(chineseTime[4]) : 0
      if ((period === '下午' || period === '晚上' || period === '今晚') && hour < 12) hour += 12
      if (period === '中午' && hour < 11) hour += 12
      if ((period === '上午' || period === '早上') && hour === 12) hour = 0
      if (hour < 24 && minute < 60) {
        time = `${pad(hour)}:${pad(minute)}`
        rest = remove(rest, chineseTime)
      }
    }
  }

  const priorityMatch = /!(高|中|低)/.exec(rest)
  if (priorityMatch) {
    priority = PRIORITIES[priorityMatch[1]]
    rest = remove(rest, priorityMatch)
  }

  const listMatch = /(?<![\w])#([^\s#]+)/.exec(rest)
  if (listMatch) {
    list = listMatch[1]
    rest = remove(rest, listMatch)
  }

  return {
    title: rest.replace(/\s+/g, ' ').trim(),
    ...(dueDate ? { dueDate } : {}),
    ...(time ? { time } : {}),
    ...(priority ? { priority } : {}),
    ...(list ? { list } : {})
  }
}
