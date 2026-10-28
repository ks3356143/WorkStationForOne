import { dateKey } from '../../../../shared/date-key'
import { weekKeys } from '../../lib/habits'
import type { Habit } from '../../types'

/** 把「本周哪几天打卡」的模板转成日期键，只保留今天及以前。 */
function weekCheckins(pattern: boolean[], today = dateKey()): string[] {
  return weekKeys(today).filter((key, index) => pattern[index] === true && key <= today)
}

export function createSeedHabits(): Habit[] {
  return [
    { id: 'h1', name: '早起 07:30', checkins: weekCheckins([true, true, true, true, true]) },
    { id: 'h2', name: '喝水 2 L', checkins: weekCheckins([true, false, true, true, true]) },
    { id: 'h3', name: '运动 30 分钟', checkins: weekCheckins([true, true]) },
    { id: 'h4', name: '阅读 20 分钟', checkins: weekCheckins([false, true, true, true, true]) },
    { id: 'h5', name: '23:30 前睡', checkins: weekCheckins([true, true, true, true]) },
    { id: 'h6', name: '冥想 10 分钟', checkins: weekCheckins([false, true, true, true, true]) }
  ]
}
