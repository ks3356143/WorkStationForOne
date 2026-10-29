const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function parts(key: string): [number, number, number] {
  const match = DATE_KEY.exec(key)
  if (!match) throw new RangeError(`无效日期键：${key}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`无效日期键：${key}`)
  }
  return [year, month, day]
}

export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    parts(value)
    return true
  } catch {
    return false
  }
}

export function addDaysKey(key: string, days: number): string {
  const [year, month, day] = parts(key)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

/** 两个日期键之间的日历天数，to 晚于 from 时为正。 */
export function daysBetweenKeys(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = parts(from)
  const [toYear, toMonth, toDay] = parts(to)
  const start = Date.UTC(fromYear, fromMonth - 1, fromDay)
  const end = Date.UTC(toYear, toMonth - 1, toDay)
  return Math.round((end - start) / 86_400_000)
}
