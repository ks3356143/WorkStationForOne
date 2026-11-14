const DAY_MS = 86_400_000

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 本地当天已过去的比例（0..1）。 */
export function dayProgress(now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return clamp01((now.getTime() - start.getTime()) / DAY_MS)
}

/** 本地当年已过去的比例（0..1），按实际天数（闰年 366）。 */
export function yearProgress(now: Date): number {
  const year = now.getFullYear()
  const start = new Date(year, 0, 1)
  const end = new Date(year + 1, 0, 1)
  return clamp01((now.getTime() - start.getTime()) / (end.getTime() - start.getTime()))
}
