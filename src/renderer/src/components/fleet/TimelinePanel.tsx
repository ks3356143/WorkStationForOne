import { useEffect, useMemo, useState } from 'react'
import type { AgentRunRecord } from '../../../../shared/ipc'
import { buildTimeline, formatCost, formatDuration, groupTimelineByDay } from '../../lib/usage'

interface TimelinePanelProps {
  sessions: { id: string; title: string; agent: string }[]
  notify: (text: string) => void
  onOpened: () => void
  openSession: (sessionId: string) => void
}

/** 舰队活动时间轴：近 14 天运行按本地日期分组倒序，点击打开会话。数据加载内聚于此。 */
export function TimelinePanel({ sessions, notify, onOpened, openSession }: TimelinePanelProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.agent
  const [runs, setRuns] = useState<AgentRunRecord[] | null>(null)
  const [busy, setBusy] = useState(false)
  const days = useMemo(
    () => groupTimelineByDay(buildTimeline(runs ?? [], sessions)),
    [runs, sessions]
  )

  useEffect(() => {
    if (!api) return
    let alive = true
    setBusy(true)
    void api
      .usage(14)
      .then((list) => {
        if (alive) setRuns(list)
      })
      .catch((error: unknown) => {
        if (alive) notify(error instanceof Error ? error.message : '时间轴读取失败')
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [api, notify])

  return (
    <div className="w1-fleetusage">
      <div className="w1-fleetusagehead">
        <span>// 近 14 天活动时间轴</span>
        <span>只统计应用内运行</span>
      </div>
      {busy && !runs ? (
        <p className="w1-capnote">正在读取…</p>
      ) : days.length === 0 ? (
        <p className="w1-capnote">还没有运行记录。</p>
      ) : (
        <div className="w1-timeline">
          {days.map((day) => (
            <div className="w1-tlday" key={day.key}>
              <div className="w1-tldaykey">{day.key}</div>
              {day.entries.map((entry) => (
                <button
                  type="button"
                  className="w1-tlentry"
                  key={entry.id}
                  onClick={() => {
                    openSession(entry.sessionId)
                    onOpened()
                  }}
                >
                  <span className="w1-tltime">
                    {new Date(entry.startedAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  <span
                    className={`w1-tlstatus ${entry.cancelled ? 'cancel' : entry.ok ? 'ok' : 'fail'}`}
                    aria-hidden="true"
                  />
                  <span className="w1-tltitle">{entry.title}</span>
                  <span className="w1-tlmeta">
                    {entry.agent === 'codex' ? 'Codex' : 'Claude'} ·{' '}
                    {formatCost(entry.costUsd ?? 0)} · {formatDuration(entry.durationMs ?? 0)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
