import { dayProgress, yearProgress } from '../lib/time-progress'

const R = 15
const C = 2 * Math.PI * R

function Ring({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100)
  return (
    <span className="w1-tpring">
      <svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true">
        <circle className="w1-tpring-bg" cx="18" cy="18" r={R} />
        <circle
          className="w1-tpring-fg"
          cx="18"
          cy="18"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - value)}
        />
      </svg>
      <span className="w1-tpringtxt">
        <b>{pct}%</b>
        <i>{label}</i>
      </span>
    </span>
  )
}

/** 今日视图 ambient 进度环：今天 / 今年已过去的比例。 */
export function TimeProgress({ now }: { now: Date }) {
  const day = dayProgress(now)
  const year = yearProgress(now)
  return (
    <div
      className="w1-timeprog"
      role="img"
      aria-label={`今日已过 ${Math.round(day * 100)}%，今年已过 ${Math.round(year * 100)}%`}
    >
      <Ring value={day} label="今日" />
      <Ring value={year} label="今年" />
    </div>
  )
}
