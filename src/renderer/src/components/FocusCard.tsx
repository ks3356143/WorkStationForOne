import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { dateKey } from '../../../shared/date-key'
import { summarizeFocus } from '../lib/focus-stats'
import { useFocus } from '../lib/use-focus'
import { useNow } from '../lib/useNow'
import { useWorkstation } from '../store/useWorkstation'
import { SpotlightLayer } from './effects/SpotlightLayer'
import { FocusStatsSheet } from './FocusStatsSheet'

export function FocusCard() {
  const startPomodoro = useWorkstation((state) => state.startPomodoro)
  const focus = useWorkstation((state) => state.focus)
  const { recent, refresh } = useFocus()
  const [statsOpen, setStatsOpen] = useState(false)
  const statsButtonRef = useRef<HTMLButtonElement>(null)
  const now = useNow(60_000)
  const today = dateKey(now)
  const summary = summarizeFocus(recent, today, 7)
  const max = Math.max(1, ...summary.dayBars.map((bar) => bar.minutes))

  // 专注会话结束（focus 归 null）后刷新统计，把刚落库的工时算进来。
  useEffect(() => {
    if (!focus) refresh()
  }, [focus, refresh])

  return (
    <>
      <section className="w1-card w1-focuscard" data-spotlight>
        <SpotlightLayer />
        <div className="w1-ct">
          <b>
            <em>//</em>今日专注
          </b>
          <div className="w1-ctmeta">
            <span>
              {summary.todayMinutes} 分钟 · {summary.todayCycles} 轮
            </span>
            <button
              ref={statsButtonRef}
              className="w1-hmanage"
              type="button"
              aria-label="专注统计"
              onClick={() => setStatsOpen(true)}
            >
              统计
            </button>
          </div>
        </div>

        <div className="w1-focusbody">
          <div className="w1-focusstat">
            <b>{summary.todayMinutes}</b>
            <span>分钟 · 今天</span>
          </div>
          <div className="w1-focusweek" role="img" aria-label="近 7 天专注分钟趋势">
            {summary.dayBars.map((bar) => (
              <i
                key={bar.day}
                className={`w1-focusdaybar${bar.minutes === 0 ? ' is-empty' : ''}`}
                style={{ height: `${Math.max(4, (bar.minutes / max) * 100)}%` }}
                title={`${bar.day} · ${bar.minutes} 分钟`}
              />
            ))}
          </div>
          <button
            className="w1-pb pri w1-focusstart"
            type="button"
            onClick={() => startPomodoro('深度工作')}
          >
            开始番茄钟
          </button>
        </div>
      </section>

      <AnimatePresence onExitComplete={() => statsButtonRef.current?.focus()}>
        {statsOpen ? <FocusStatsSheet onClose={() => setStatsOpen(false)} /> : null}
      </AnimatePresence>
    </>
  )
}
