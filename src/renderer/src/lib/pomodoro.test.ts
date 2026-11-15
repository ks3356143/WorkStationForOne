import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POMODORO,
  clampConfig,
  nextPhase,
  phaseLabel,
  phaseMinutes,
  type PomodoroState
} from './pomodoro'

describe('phaseMinutes', () => {
  it('各阶段取对应分钟数', () => {
    expect(phaseMinutes('focus', DEFAULT_POMODORO)).toBe(25)
    expect(phaseMinutes('shortBreak', DEFAULT_POMODORO)).toBe(5)
    expect(phaseMinutes('longBreak', DEFAULT_POMODORO)).toBe(15)
  })
})

describe('phaseLabel', () => {
  it('中文标签', () => {
    expect(phaseLabel('focus')).toBe('专注')
    expect(phaseLabel('shortBreak')).toBe('短休息')
    expect(phaseLabel('longBreak')).toBe('长休息')
  })
})

describe('nextPhase 状态机', () => {
  const start: PomodoroState = { phase: 'focus', completedFocus: 0 }

  it('专注完成后进入短休息并计数', () => {
    const next = nextPhase(start, DEFAULT_POMODORO)
    expect(next.phase).toBe('shortBreak')
    expect(next.completedFocus).toBe(1)
  })

  it('短休息结束回到专注，计数不变', () => {
    const next = nextPhase({ phase: 'shortBreak', completedFocus: 1 }, DEFAULT_POMODORO)
    expect(next.phase).toBe('focus')
    expect(next.completedFocus).toBe(1)
  })

  it('第 4 个专注完成后进入长休息', () => {
    const next = nextPhase({ phase: 'focus', completedFocus: 3 }, DEFAULT_POMODORO)
    expect(next.phase).toBe('longBreak')
    expect(next.completedFocus).toBe(4)
  })

  it('长休息结束回到专注', () => {
    const next = nextPhase({ phase: 'longBreak', completedFocus: 4 }, DEFAULT_POMODORO)
    expect(next.phase).toBe('focus')
    expect(next.completedFocus).toBe(4)
  })

  it('自定义轮数生效', () => {
    const config = { ...DEFAULT_POMODORO, cyclesBeforeLong: 2 }
    const next = nextPhase({ phase: 'focus', completedFocus: 1 }, config)
    expect(next.phase).toBe('longBreak')
    expect(next.completedFocus).toBe(2)
  })
})

describe('clampConfig', () => {
  it('夹住各字段范围并取整', () => {
    const config = clampConfig({
      focusMin: 0,
      shortBreakMin: 100,
      longBreakMin: -5,
      cyclesBeforeLong: 99
    })
    expect(config.focusMin).toBe(1)
    expect(config.shortBreakMin).toBe(60)
    expect(config.longBreakMin).toBe(1)
    expect(config.cyclesBeforeLong).toBe(12)
  })
  it('非法值回退默认', () => {
    const config = clampConfig({
      focusMin: Number.NaN,
      shortBreakMin: Number.NaN,
      longBreakMin: Number.NaN,
      cyclesBeforeLong: Number.NaN
    })
    expect(config).toEqual(DEFAULT_POMODORO)
  })
})
