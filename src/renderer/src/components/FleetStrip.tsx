import type { FleetSummary } from '../lib/fleet'
import { useWorkstation } from '../store/useWorkstation'

interface FleetStripProps {
  summary: FleetSummary
}

export function FleetStrip({ summary }: FleetStripProps) {
  const setActiveSession = useWorkstation((state) => state.setActiveSession)
  const activeSessionId = useWorkstation((state) => state.activeSessionId)
  const waitingActive = summary.waitingSessionId !== null && summary.waitingSessionId === activeSessionId

  return (
    <div className="w1-fleet" role="group" aria-label="Agent 舰队状态">
      <div className="w1-frow">
        <span className="w1-fcell run">
          <b>{summary.running}</b>
          运行
        </span>
        <span className="w1-fcell wait">
          <b>{summary.waiting}</b>
          待确认
        </span>
        <span className="w1-fcell">
          <b>{summary.idle}</b>
          空闲
        </span>
        <span className="w1-fcell total">
          <b>{summary.total}</b>
          会话
        </span>
      </div>
      {summary.waitingSessionId && !waitingActive ? (
        <button
          className="w1-fjump"
          type="button"
          onClick={() => setActiveSession(summary.waitingSessionId!)}
        >
          <i />
          {summary.waiting} 个会话待确认 · 去处理
        </button>
      ) : null}
    </div>
  )
}
