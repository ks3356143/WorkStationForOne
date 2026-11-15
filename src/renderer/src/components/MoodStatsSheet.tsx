import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { dateKey } from '../../../shared/date-key'
import { averageEnergy, averageMood, moodEmoji, moodTrend, type MoodPoint } from '../lib/mood'
import { DURATION, EASE_OUT } from '../lib/motion'
import { useMood } from '../lib/use-mood'

interface MoodStatsSheetProps {
  onClose: () => void
}

function formatAvg(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

export function MoodStatsSheet({ onClose }: MoodStatsSheetProps) {
  const { recent, ready } = useMood()
  const boxRef = useRef<HTMLDivElement>(null)
  const [today] = useState(() => dateKey())
  const trend = moodTrend(recent, 30, today)
  const avgMood = averageMood(recent)
  const avgEnergy = averageEnergy(recent)

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
        className="w1-modal w1-moodstats"
        role="dialog"
        aria-modal="true"
        aria-label="心情趋势"
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
          <span className="w1-eyebrow">// 心情趋势</span>
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="w1-moodstatshead">
          <h2>近 30 天。</h2>
          <p>
            平均心情 <b>{formatAvg(avgMood)}</b>{' '}
            {avgMood !== null ? moodEmoji(Math.round(avgMood)) : ''} · 平均精力{' '}
            <b>{formatAvg(avgEnergy)}</b> · 已记录 <b>{recent.length}</b> 天
          </p>
        </div>

        <div className="w1-moodstatsbody">
          {!ready ? (
            <div className="w1-moodstatsempty">读取中…</div>
          ) : recent.length === 0 ? (
            <div className="w1-moodstatsempty">还没有记录。先在今日页记下今天的心情。</div>
          ) : (
            <>
              <MoodChart label="心情" points={trend} pick={(point) => point.mood} kind="mood" />
              <MoodChart label="精力" points={trend} pick={(point) => point.energy} kind="energy" />
            </>
          )}
        </div>

        <div className="w1-moodstatsfoot">
          <span>由旧到新 · 截至 {today}</span>
          <span>空格为未记录</span>
        </div>
      </m.div>
    </m.div>
  )
}

function MoodChart({
  label,
  points,
  pick,
  kind
}: {
  label: string
  points: MoodPoint[]
  pick: (point: MoodPoint) => number | null
  kind: 'mood' | 'energy'
}) {
  return (
    <section className="w1-moodchartrow">
      <span className="w1-moodchartlabel">{label}</span>
      <div className={`w1-moodchart ${kind}`} role="img" aria-label={`近 30 天${label}趋势`}>
        {points.map((point) => {
          const value = pick(point)
          return (
            <i
              key={point.day}
              className={`w1-moodbar${value === null ? ' is-empty' : ''}`}
              style={value === null ? undefined : { height: `${(value / 5) * 100}%` }}
              title={`${point.day} · ${value === null ? '未记录' : `${label} ${value}`}`}
            />
          )
        })}
      </div>
    </section>
  )
}
