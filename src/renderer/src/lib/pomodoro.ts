export interface PomodoroConfig {
  focusMin: number
  shortBreakMin: number
  longBreakMin: number
  cyclesBeforeLong: number
}

export const DEFAULT_POMODORO: PomodoroConfig = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  cyclesBeforeLong: 4
}

export const POMODORO_STORAGE_KEY = 'workstation.pomodoro'

export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak'

export interface PomodoroState {
  phase: PomodoroPhase
  /** 已完成的专注段数 */
  completedFocus: number
}

const RANGES: Record<keyof PomodoroConfig, [number, number]> = {
  focusMin: [1, 90],
  shortBreakMin: [1, 60],
  longBreakMin: [1, 60],
  cyclesBeforeLong: [1, 12]
}

export function phaseMinutes(phase: PomodoroPhase, config: PomodoroConfig): number {
  if (phase === 'focus') return config.focusMin
  if (phase === 'shortBreak') return config.shortBreakMin
  return config.longBreakMin
}

export function phaseLabel(phase: PomodoroPhase): string {
  if (phase === 'focus') return '专注'
  if (phase === 'shortBreak') return '短休息'
  return '长休息'
}

/** 一段结束后的下一段：专注完成计数，每 cyclesBeforeLong 段进长休息，休息结束回专注。 */
export function nextPhase(state: PomodoroState, config: PomodoroConfig): PomodoroState {
  if (state.phase === 'focus') {
    const completedFocus = state.completedFocus + 1
    const phase = completedFocus % config.cyclesBeforeLong === 0 ? 'longBreak' : 'shortBreak'
    return { phase, completedFocus }
  }
  return { phase: 'focus', completedFocus: state.completedFocus }
}

function clampField(value: number, key: keyof PomodoroConfig): number {
  if (!Number.isFinite(value)) return DEFAULT_POMODORO[key]
  const [min, max] = RANGES[key]
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampConfig(config: PomodoroConfig): PomodoroConfig {
  return {
    focusMin: clampField(config.focusMin, 'focusMin'),
    shortBreakMin: clampField(config.shortBreakMin, 'shortBreakMin'),
    longBreakMin: clampField(config.longBreakMin, 'longBreakMin'),
    cyclesBeforeLong: clampField(config.cyclesBeforeLong, 'cyclesBeforeLong')
  }
}

export function readPomodoroConfig(storage?: Pick<Storage, 'getItem'>): PomodoroConfig {
  if (!storage) return DEFAULT_POMODORO
  try {
    const raw = storage.getItem(POMODORO_STORAGE_KEY)
    if (!raw) return DEFAULT_POMODORO
    const parsed = JSON.parse(raw) as Partial<PomodoroConfig>
    return clampConfig({ ...DEFAULT_POMODORO, ...parsed })
  } catch {
    return DEFAULT_POMODORO
  }
}

export function persistPomodoroConfig(
  config: PomodoroConfig,
  storage?: Pick<Storage, 'setItem'>
): PomodoroConfig {
  const clamped = clampConfig(config)
  if (storage) {
    try {
      storage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(clamped))
    } catch {
      // 存储不可用时仍返回夹取后的配置，只是不跨启动保留。
    }
  }
  return clamped
}
