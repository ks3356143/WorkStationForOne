import { SpotlightLayer } from './effects/SpotlightLayer'
import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { dateKey } from '../../../shared/date-key'
import { getTodayIndex, getWeekdayCn } from '../lib/date'
import { currentStreak, habitsDoneToday, weekFlags, weekKeys } from '../lib/habits'
import { useNow } from '../lib/useNow'
import { useWorkstation } from '../store/useWorkstation'
import type { Habit } from '../types'
import { HabitManageSheet } from './HabitManageSheet'

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function HabitCard() {
  const habits = useWorkstation((state) => state.habits)
  const toggleHabitDay = useWorkstation((state) => state.toggleHabitDay)
  const addHabit = useWorkstation((state) => state.addHabit)
  const renameHabit = useWorkstation((state) => state.renameHabit)
  const removeHabit = useWorkstation((state) => state.removeHabit)
  const [manageOpen, setManageOpen] = useState(false)
  const now = useNow(60_000)
  const today = getTodayIndex(now)
  const todayKey = dateKey(now)
  const week = weekKeys(todayKey)
  const doneCount = habitsDoneToday(habits, todayKey)
  const flagsOf = (habit: Habit) => weekFlags(habit, todayKey)

  return (
    <>
      <section className="w1-card" data-spotlight>
        <SpotlightLayer />
        <div className="w1-ct">
          <b>
            <em>//</em>习惯打卡
          </b>
          <div className="w1-ctmeta">
            <span>
              {doneCount} / {habits.length} · {getWeekdayCn(now)}
            </span>
            <button
              className="w1-hmanage"
              type="button"
              aria-label="管理习惯"
              onClick={() => setManageOpen(true)}
            >
              管理
            </button>
          </div>
        </div>

        <div className="w1-habits">
          <div className="w1-hrow">
            <span />
            {DAY_LABELS.map((label, index) => (
              <span key={label} className={`w1-hday${index === today ? ' today' : ''}`}>
                {label}
              </span>
            ))}
          </div>
          {habits.map((habit) => (
            <div className="w1-hrow" key={habit.id}>
              <span className="w1-hname">
                {habit.name}
                {currentStreak(habit, todayKey) > 0 ? (
                  <em
                    className={`w1-hstreak${currentStreak(habit, todayKey) >= 3 ? ' hot' : ''}`}
                    title={`连续 ${currentStreak(habit, todayKey)} 天`}
                  >
                    {currentStreak(habit, todayKey)}
                  </em>
                ) : null}
              </span>
              {flagsOf(habit).map((done, index) => {
                const label = DAY_LABELS[index]
                const day = week[index]
                const future = index > today
                return (
                  <button
                    key={label}
                    type="button"
                    className={[
                      'w1-hdot',
                      done ? 'on' : index < today ? 'miss' : '',
                      index === today ? 'today' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={future}
                    aria-label={`${habit.name} · ${day}${done ? ' · 已完成' : ' · 未完成'}`}
                    aria-pressed={done}
                    title={future ? '未来日期' : done ? '取消打卡' : '打卡 / 补打卡'}
                    onClick={() => toggleHabitDay(habit.id, day)}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </section>

      <AnimatePresence>
        {manageOpen ? (
          <HabitManageSheet
            habits={habits}
            onClose={() => setManageOpen(false)}
            onAdd={addHabit}
            onRename={renameHabit}
            onRemove={removeHabit}
          />
        ) : null}
      </AnimatePresence>
    </>
  )
}
