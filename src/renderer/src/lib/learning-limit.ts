export const LEARNING_NEW_PER_DAY_KEY = 'workstation.learningNewPerDay'
export const DEFAULT_LEARNING_NEW_PER_DAY = 20
export const LEARNING_NEW_PER_DAY_OPTIONS = [10, 20, 30, 50, 0] as const

export interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function normalizeNewPerDay(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  const options: readonly number[] = LEARNING_NEW_PER_DAY_OPTIONS
  return options.includes(parsed) ? parsed : DEFAULT_LEARNING_NEW_PER_DAY
}

export function readStoredNewPerDay(
  storage: StorageLike | null | undefined = defaultStorage()
): number {
  if (!storage) return DEFAULT_LEARNING_NEW_PER_DAY
  try {
    return normalizeNewPerDay(storage.getItem(LEARNING_NEW_PER_DAY_KEY))
  } catch {
    return DEFAULT_LEARNING_NEW_PER_DAY
  }
}

export function persistNewPerDay(storage: StorageLike | null | undefined, value: number): void {
  if (!storage) return
  try {
    storage.setItem(LEARNING_NEW_PER_DAY_KEY, String(normalizeNewPerDay(value)))
  } catch {
    // 存储被禁用不影响当前设置
  }
}

export function describeNewPerDay(value: number): string {
  return value === 0 ? '不限' : `${value} 张`
}

function defaultStorage(): StorageLike | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
