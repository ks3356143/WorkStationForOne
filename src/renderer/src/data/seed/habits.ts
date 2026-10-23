import { getTodayIndex } from '../../lib/date'
import type { Habit } from '../../types'

function weekDays(flags: boolean[], todayIndex = getTodayIndex()): boolean[] {
  return flags.map((value, index) => (index <= todayIndex ? value : false))
}

export function createSeedHabits(): Habit[] {
  return [
    { id: 'h1', name: '早起 07:30', days: weekDays([true, true, true, true, true, false, false]) },
    { id: 'h2', name: '喝水 2 L', days: weekDays([true, false, true, true, true, false, false]) },
    { id: 'h3', name: '运动 30 分钟', days: weekDays([true, true, false, false, false, false, false]) },
    { id: 'h4', name: '阅读 20 分钟', days: weekDays([false, true, true, true, true, false, false]) },
    { id: 'h5', name: '23:30 前睡', days: weekDays([true, true, true, true, false, false, false]) },
    { id: 'h6', name: '冥想 10 分钟', days: weekDays([false, true, true, true, true, false, false]) }
  ]
}
