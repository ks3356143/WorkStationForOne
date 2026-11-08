import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { dateKey } from '../../../shared/date-key'
import { habitHeatmap, habitStats } from '../lib/habit-stats'
import { DURATION, EASE_OUT } from '../lib/motion'
import type { Habit } from '../types'

interface HabitStatsSheetProps {
  habits: Habit[]
  onClose: () => void
}

export function HabitStatsSheet({ habits, onClose }: HabitStatsSheetProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [today] = useState(() => dateKey())

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    boxRef.current?.focus()
    return () => previous?.focus()
  }, [])

  return (
    <m.div
      className="w1-modalbackdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.modalBackdrop }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <m.div
        ref={boxRef}
        tabIndex={-1}
        className="w1-modal w1-hstats"
        role="dialog"
        aria-modal="true"
        aria-label="习惯统计"
        initial={{ opacity: 0, transform: 'translateY(12px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="w1-modalhead">
          <span className="w1-eyebrow">// 习惯统计</span>
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="w1-hstatshead">
          <div>
            <h2>近 26 周。</h2>
            <p>
              {habits.length} 个习惯 · 截至 {today}
            </p>
          </div>
        </div>

        <div className="w1-hstatsbody">
          {habits.length === 0 ? (
            <div className="w1-hstatsempty">还没有习惯。先在今日页添加一个。</div>
          ) : (
            habits.map((habit) => <HabitStatsRow key={habit.id} habit={habit} today={today} />)
          )}
        </div>

        <div className="w1-hstatsfoot">
          <span>周一起始 · 近 26 周</span>
          <span>亮格为已打卡</span>
        </div>
      </m.div>
    </m.div>
  )
}

function HabitStatsRow({ habit, today }: { habit: Habit; today: string }) {
  const heatmap = habitHeatmap(habit, today)
  const stats = habitStats(habit, today)
  const rate = Math.round(stats.rate * 100)

  return (
    <section className="w1-hstatrow">
      <header className="w1-hstatrowhead">
        <b className="w1-hstatname">{habit.name}</b>
        <span className="w1-hstatmeta">
          <span>
            当前 <b>{stats.current}</b> 天
          </span>
          <span>
            最佳 <b>{stats.best}</b> 天
          </span>
          <span>
            近 30 天 <b>{rate}%</b>
          </span>
          <span>
            累计 <b>{stats.total}</b> 次
          </span>
        </span>
      </header>
      <div
        className="w1-hstatgrid"
        role="img"
        aria-label={`${habit.name}近 26 周打卡 ${heatmap.activeDays} 天`}
      >
        {heatmap.weeks.map((week, weekIndex) => (
          <div
            className="w1-hstatcol"
            key={week.days[0]?.key ?? `week-${weekIndex}`}
            style={{ animationDelay: `${weekIndex * 10}ms` }}
          >
            {week.days.map((day, dayIndex) =>
              day ? (
                <i
                  key={day.key}
                  className={`w1-hstatcell${day.done ? ' on' : ''}`}
                  title={`${day.key} · ${day.done ? '已打卡' : '未打卡'}`}
                />
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: 未来日期是固定位置的占位格，索引就是位置
                <i key={`empty-${dayIndex}`} className="w1-hstatcell is-empty" />
              )
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
