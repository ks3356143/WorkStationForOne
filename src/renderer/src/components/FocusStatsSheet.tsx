import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { dateKey } from '../../../shared/date-key'
import { summarizeFocus } from '../lib/focus-stats'
import { useFocus } from '../lib/use-focus'
import { DURATION, EASE_OUT } from '../lib/motion'
import { persistPomodoroConfig, readPomodoroConfig, type PomodoroConfig } from '../lib/pomodoro'
import { browserStorage } from '../lib/theme'
import { useWorkstation } from '../store/useWorkstation'

interface FocusStatsSheetProps {
  onClose: () => void
}

const CONFIG_FIELDS: { key: keyof PomodoroConfig; label: string }[] = [
  { key: 'focusMin', label: '专注' },
  { key: 'shortBreakMin', label: '短休' },
  { key: 'longBreakMin', label: '长休' },
  { key: 'cyclesBeforeLong', label: '轮数' }
]

export function FocusStatsSheet({ onClose }: FocusStatsSheetProps) {
  const { recent, ready } = useFocus()
  const tasks = useWorkstation((state) => state.tasks)
  const boxRef = useRef<HTMLDivElement>(null)
  const [today] = useState(() => dateKey())
  const [config, setConfig] = useState<PomodoroConfig>(() => readPomodoroConfig(browserStorage()))
  const [saved, setSaved] = useState(false)
  const summary = summarizeFocus(recent, today, 7)
  const max = Math.max(1, ...summary.dayBars.map((bar) => bar.minutes))
  const titleOf = (taskId: string) => tasks.find((task) => task.id === taskId)?.title ?? taskId

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    boxRef.current?.focus()
    return () => previous?.focus()
  }, [])

  const saveConfig = () => {
    setConfig(persistPomodoroConfig(config, browserStorage()))
    setSaved(true)
  }

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
        className="w1-modal w1-focusstats"
        role="dialog"
        aria-modal="true"
        aria-label="专注统计"
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
          <span className="w1-eyebrow">// 专注统计</span>
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="w1-focusstatshead">
          <h2>近 7 天。</h2>
          <p>
            累计 <b>{summary.totalMinutes}</b> 分钟 · 今天 <b>{summary.todayMinutes}</b> 分钟 ·{' '}
            <b>{summary.todayCycles}</b> 轮
          </p>
        </div>

        <div className="w1-focusstatsbody">
          {!ready ? (
            <div className="w1-focusstatsempty">读取中…</div>
          ) : (
            <>
              <div className="w1-focuschart" role="img" aria-label="近 7 天专注分钟柱状图">
                {summary.dayBars.map((bar) => (
                  <div className="w1-focuscol" key={bar.day}>
                    <i
                      className={`w1-focusbar${bar.minutes === 0 ? ' is-empty' : ''}`}
                      style={{ height: `${Math.max(3, (bar.minutes / max) * 100)}%` }}
                      title={`${bar.day} · ${bar.minutes} 分钟`}
                    />
                    <span>{bar.day.slice(5)}</span>
                  </div>
                ))}
              </div>

              {summary.byTask.length > 0 ? (
                <div className="w1-focustasks">
                  <span className="w1-focuschartlabel">按任务</span>
                  {summary.byTask.slice(0, 6).map((item) => (
                    <div className="w1-focustaskrow" key={item.taskId}>
                      <span className="w1-focustaskname">{titleOf(item.taskId)}</span>
                      <b>{item.minutes} 分钟</b>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="w1-focusconfig">
                <span className="w1-focuschartlabel">番茄节奏（分钟 / 轮数）</span>
                <div className="w1-focusconfigrow">
                  {CONFIG_FIELDS.map((field) => (
                    <label className="w1-focusfield" key={field.key}>
                      <span>{field.label}</span>
                      <input
                        type="number"
                        min={1}
                        value={config[field.key]}
                        aria-label={`番茄钟${field.label}`}
                        onChange={(event) => {
                          setSaved(false)
                          setConfig((prev) => ({
                            ...prev,
                            [field.key]: Number(event.target.value)
                          }))
                        }}
                      />
                    </label>
                  ))}
                  <button className="w1-pb w1-focusconfigsave" type="button" onClick={saveConfig}>
                    {saved ? '已保存' : '保存'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="w1-focusstatsfoot">
          <span>专注段计入工时 · 休息不计</span>
          <span>截至 {today}</span>
        </div>
      </m.div>
    </m.div>
  )
}
