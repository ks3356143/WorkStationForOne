export const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'] as const

export function getTodayIndex(date = new Date()): number {
  return (date.getDay() + 6) % 7
}

export function getWeekdayCn(date = new Date()): string {
  return `周${WEEKDAY_CN[date.getDay()]}`
}

export function getIsoWeek(date = new Date()): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

export function formatDateLine(date = new Date()): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${getWeekdayCn(date)} · ${date.getFullYear()}.${mm}.${dd} · 第 ${getIsoWeek(date)} 周`
}

export function formatClock(date = new Date()): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

export function formatHM(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function toMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function getTimeMarkerPercent(date = new Date()): number {
  const minutes = date.getHours() * 60 + date.getMinutes()
  const start = 9 * 60
  const end = 22 * 60
  return Math.min(0.98, Math.max(0.02, (minutes - start) / (end - start)))
}
