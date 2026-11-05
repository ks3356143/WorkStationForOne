import { useEffect, useMemo, useState } from 'react'
import type { AgentCheckpointView, AgentRollbackResult } from '../../../../shared/ipc'
import { friendlyMessage } from '../../lib/errors'
import { summarizeTurnChanges } from '../../lib/turn-changes'
import type { ToolCall } from '../../types'

interface TurnChangesProps {
  tools?: ToolCall[]
  checkpoint?: AgentCheckpointView
  rollbackEnabled: boolean
  running: boolean
  notify: (text: string) => void
  onRollback?: (checkpoint: AgentCheckpointView) => Promise<AgentRollbackResult>
}

export function TurnChanges({
  tools,
  checkpoint,
  rollbackEnabled,
  running,
  notify,
  onRollback
}: TurnChangesProps) {
  const summary = useMemo(() => summarizeTurnChanges(tools), [tools])
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])

  if (!summary) return null

  const canRollback = Boolean(checkpoint && rollbackEnabled && onRollback && !checkpoint.restoredAt)

  const rollback = () => {
    if (!checkpoint || !onRollback || running || busy) return
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    setBusy(true)
    setError(null)
    void onRollback(checkpoint)
      .then((result) => {
        const failed = result.failed.length > 0 ? `，${result.failed.length} 个失败` : ''
        notify(`已回退：恢复 ${result.restored} 个，删除 ${result.removed} 个${failed}`)
      })
      .catch((reason: unknown) => setError(friendlyMessage(reason, '回退失败')))
      .finally(() => setBusy(false))
  }

  return (
    <div className="w1-turnchanges">
      <div className="w1-tc-head">
        <span className="w1-tc-label">本轮改动</span>
        <span className="w1-tc-total">
          {summary.files.length} 个文件
          <b className="add">+{summary.additions}</b>
          <b className="del">−{summary.deletions}</b>
          {summary.partial ? <i>部分片段</i> : summary.truncated ? <i>已截断</i> : null}
        </span>
        <span className="w1-tc-actions">
          {canRollback ? (
            <button
              className={`w1-tc-rollback${armed ? ' armed' : ''}`}
              type="button"
              disabled={running || busy}
              title={running ? '运行中不能回退' : '把本轮写过的文件恢复到开始前'}
              onClick={rollback}
            >
              {busy ? '回退中…' : armed ? '再次点击确认' : '回退本轮'}
            </button>
          ) : checkpoint ? (
            <span className="w1-tc-note">{checkpoint.restoredAt ? '已回退' : '已有后续改动'}</span>
          ) : null}
        </span>
      </div>
      <div className="w1-tc-files">
        {summary.files.map((file) => (
          <span className="w1-tc-file" key={file.path} title={file.path}>
            <em>{file.path}</em>
            <b className="add">+{file.additions}</b>
            <b className="del">−{file.deletions}</b>
            {file.edits > 1 ? <i>{file.edits} 次</i> : null}
            {file.truncated ? <i>截断</i> : file.partial ? <i>片段</i> : null}
          </span>
        ))}
      </div>
      {error ? <span className="w1-tc-error">{error}</span> : null}
    </div>
  )
}
