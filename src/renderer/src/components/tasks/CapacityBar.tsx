import { formatMinutes, type DayCapacity } from '../../lib/capacity'

interface CapacityBarProps {
  capacity: DayCapacity
  compact?: boolean
}

export function CapacityBar({ capacity, compact = false }: CapacityBarProps) {
  const ratio = Math.min(1, capacity.ratio)

  return (
    <div className={`w1-cap ${capacity.state}${compact ? ' compact' : ''}`}>
      <div className="w1-captext">
        <span>今日容量</span>
        <b>{formatMinutes(capacity.planned)}</b>
        <span>/ {formatMinutes(capacity.available)}</span>
        {capacity.unestimated > 0 ? <em>{capacity.unestimated} 项未估时</em> : null}
      </div>
      <div
        className="w1-captrack"
        role="img"
        aria-label={`今日已排 ${formatMinutes(capacity.planned)}，可用 ${formatMinutes(capacity.available)}`}
      >
        <i style={{ transform: `scaleX(${ratio})` }} />
      </div>
    </div>
  )
}
