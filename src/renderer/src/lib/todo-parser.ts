import { addDaysKey, dateKey, isDateKey } from '../../../shared/date-key'

export type ParsedPriority = 1 | 2 | 3

export type TokenKind = 'date' | 'time' | 'priority' | 'list'

export interface TokenSpan {
  start: number
  end: number
  kind: TokenKind
}

export interface ParsedTaskInput {
  title: string
  dueDate?: string
  time?: string
  priority?: ParsedPriority
  list?: string
}

export interface TokenizedTaskInput extends ParsedTaskInput {
  spans: TokenSpan[]
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

// 数词片段：阿拉伯数字或中文数字（含「两」「零」）。
const NUM = '(?:\\d{1,2}|[零一二两三四五六七八九十]{1,3})'

// 截止语后缀：「前/之前/以前」，且「前」后不能再接字，避免吞掉「前台」「前面」。
const DEADLINE_SUFFIX = '(之前|以前|前(?![台面往后边]))?'

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

/** 把「三」「十五」「二十三」这类数词转成整数；无法转成 0–99 时返回 null。 */
export function parseNumberToken(token: string): number | null {
  if (/^\d+$/.test(token)) {
    const value = Number(token)
    return Number.isInteger(value) ? value : null
  }
  if (!/^[零一二两三四五六七八九十]+$/.test(token)) return null

  const tenIndex = token.indexOf('十')
  if (tenIndex === -1) {
    // 纯个位：可能是「零」「三」这样的一位数。
    if (token.length !== 1) return null
    return CHINESE_DIGITS[token] ?? null
  }
  // 只处理一个「十」：十五、二十、二十三、十。
  if (token.lastIndexOf('十') !== tenIndex) return null
  const head = token.slice(0, tenIndex)
  const tail = token.slice(tenIndex + 1)
  if (head.length > 1 || tail.length > 1) return null
  const tens = head ? CHINESE_DIGITS[head] : 1
  const ones = tail ? CHINESE_DIGITS[tail] : 0
  if (tens === undefined || ones === undefined) return null
  return tens * 10 + ones
}

/**
 * 「一点」「两点」在中文里更常是量词（有一点问题、两点意见），
 * 只有带时段前缀、或跟在明确的时间单位后，才当作钟点。
 */
function isAmbiguousHour(token: string): boolean {
  return token === '一' || token === '两' || token === '二'
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

/**
 * 用等长空白覆盖命中片段：长度不变，后续正则的 index 仍然映射到原始输入，
 * 才能把区间交回给高亮层。拼空格的边界语义与原先「删掉再补一个空格」一致。
 */
function blank(rest: string, length: number, index: number): string {
  return `${rest.slice(0, index)}${' '.repeat(length)}${rest.slice(index + length)}`
}

export function tokenizeTaskInput(input: string, today = dateKey()): TokenizedTaskInput {
  let rest = input
  let dueDate: string | undefined
  let time: string | undefined
  let priority: ParsedPriority | undefined
  let list: string | undefined
  const spans: TokenSpan[] = []

  const take = (match: RegExpExecArray, kind: TokenKind) => {
    // 正则里的 \s* 会把尾随空格吃进匹配（如「下午三点 交周报」），
    // 高亮框不该跟着拖出一截空格，所以记录区间时裁掉首尾空白；
    // 覆盖仍按完整匹配进行，解析结果与旧实现保持一致。
    let start = match.index
    let end = match.index + match[0].length
    while (start < end && /\s/.test(input[start])) start += 1
    while (end > start && /\s/.test(input[end - 1])) end -= 1
    spans.push({ start, end, kind })
    rest = blank(rest, match[0].length, match.index)
  }

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(rest)
  if (iso && isDateKey(iso[0])) {
    dueDate = iso[0]
    take(iso, 'date')
  }

  if (!dueDate) {
    // 日期后紧跟的「前/之前/以前」是截止语，需一并吃掉，否则会残留在标题里；
    // 「前」后不能再接字，避免吞掉「前台」「前面」这类词。
    const chineseDate = /(\d{1,2})月(\d{1,2})日(之前|以前|前(?![台面往后边]))?/.exec(rest)
    if (chineseDate) {
      const year = Number(today.slice(0, 4))
      let candidate = validKey(year, Number(chineseDate[1]), Number(chineseDate[2]))
      if (candidate) {
        if (candidate < today)
          candidate = validKey(year + 1, Number(chineseDate[1]), Number(chineseDate[2]))
        if (candidate) {
          dueDate = candidate
          take(chineseDate, 'date')
        }
      }
    }
  }

  if (!dueDate) {
    // 「N 天后 / N 周后」：中文数字与阿拉伯数字都接受，前面必须是独立的数词，
    // 避免「关注天后现象」这类标题被误判。
    const offsetDate = new RegExp(
      `(?<![\\d零一二两三四五六七八九十])(${NUM})\\s*(天|周|星期)后${DEADLINE_SUFFIX}`
    ).exec(rest)
    if (offsetDate) {
      const count = parseNumberToken(offsetDate[1])
      if (count !== null) {
        const days = offsetDate[2] === '天' ? count : count * 7
        dueDate = addDaysKey(today, days)
        take(offsetDate, 'date')
      }
    }
  }

  if (!dueDate) {
    // 日期后紧跟的「前/之前/以前」是截止语，需一并吃掉，否则会残留在标题里；
    // 用「前」后不能再接字的边界，避免吞掉「前台」「前面」这类词。
    const relative = /(今天|明天|后天)(之前|以前|前(?![台面往后边]))?/.exec(rest)
    if (relative) {
      const offset = relative[1] === '今天' ? 0 : relative[1] === '明天' ? 1 : 2
      dueDate = addDaysKey(today, offset)
      take(relative, 'date')
    }
  }

  if (!dueDate) {
    const weekday = /(下周|周|星期)([一二三四五六日天])(之前|以前|前(?![台面往后边]))?/.exec(rest)
    if (weekday) {
      const target = WEEKDAYS[weekday[2]]
      const index = weekdayIndex(today)
      const offset = weekday[1] === '下周' ? 7 - index + target : (target - index + 7) % 7
      dueDate = addDaysKey(today, offset)
      take(weekday, 'date')
    }
  }

  const clock = /(\d{1,2}):(\d{2})/.exec(rest)
  if (clock) {
    const hour = Number(clock[1])
    const minute = Number(clock[2])
    if (hour < 24 && minute < 60) {
      time = `${pad(hour)}:${pad(minute)}`
      take(clock, 'time')
    }
  }

  if (!time) {
    // 数字与「点」「分」之间、时段与数字之间都允许空格：中文输入时常会打空格。
    // 分钟同样接受中文数字（九点十五分）。
    const chineseTime = new RegExp(
      `(凌晨|早上|上午|中午|下午|傍晚|晚上|今晚)?\\s*(${NUM})\\s*点\\s*(半|一刻|三刻|(${NUM})\\s*分?)?`
    ).exec(rest)
    if (chineseTime) {
      const period = chineseTime[1]
      const hourToken = chineseTime[2]
      const parsedHour = parseNumberToken(hourToken)
      const minuteText = chineseTime[3]
      const parsedMinute = chineseTime[4] ? parseNumberToken(chineseTime[4]) : 0
      const minute =
        minuteText === '半'
          ? 30
          : minuteText === '一刻'
            ? 15
            : minuteText === '三刻'
              ? 45
              : parsedMinute
      // 无时段前缀时，「一点」「两点」多半是量词（有一点问题、两点意见），不当时钟。
      const ambiguous = !period && isAmbiguousHour(hourToken)
      if (parsedHour !== null && minute !== null && !ambiguous) {
        let hour = parsedHour
        // 「晚上/今晚/凌晨的 12 点」口语指零点；中午与下午的 12 点仍是中午。
        if ((period === '晚上' || period === '今晚' || period === '凌晨') && hour === 12) hour = 0
        else if (
          (period === '下午' || period === '晚上' || period === '今晚' || period === '傍晚') &&
          hour < 12
        )
          hour += 12
        if (period === '中午' && hour < 11) hour += 12
        if ((period === '上午' || period === '早上') && hour === 12) hour = 0
        if (hour < 24 && minute < 60) {
          time = `${pad(hour)}:${pad(minute)}`
          take(chineseTime, 'time')
        }
      }
    }
  }

  const priorityMatch = /!(高|中|低)/.exec(rest)
  if (priorityMatch) {
    priority = PRIORITIES[priorityMatch[1]]
    take(priorityMatch, 'priority')
  }

  const listMatch = /(?<![\w])#([^\s#]+)/.exec(rest)
  if (listMatch) {
    list = listMatch[1]
    take(listMatch, 'list')
  }

  return {
    title: rest.replace(/\s+/g, ' ').trim(),
    ...(dueDate ? { dueDate } : {}),
    ...(time ? { time } : {}),
    ...(priority ? { priority } : {}),
    ...(list ? { list } : {}),
    spans: spans.sort((a, b) => a.start - b.start)
  }
}

export function parseTaskInput(input: string, today = dateKey()): ParsedTaskInput {
  const { spans: _spans, ...parsed } = tokenizeTaskInput(input, today)
  return parsed
}
