import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { m } from 'motion/react'
import type { AgentCheckpointView } from '../../../../shared/ipc'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { friendlyMessage } from '../../lib/errors'

interface CheckpointSheetProps {
  sessionId: string
  running: boolean
  onClose: () => void
  notify: (text: string) => void
}

function timeLabel(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function CheckpointSheet({ sessionId, running, onClose, notify }: CheckpointSheetProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.agent
  const boxRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [items, setItems] = useState<AgentCheckpointView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    root?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    if (!api) {
      setError('当前环境没有 preload 桥')
      return
    }
    let alive = true
    void api
      .checkpoints(sessionId)
      .then((list) => {
        if (alive) setItems(list)
      })
      .catch((reason: unknown) => {
        if (alive) setError(friendlyMessage(reason, '检查点读取失败'))
      })
    return () => {
      alive = false
    }
  }, [api, sessionId])

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(null), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])

  const rollback = (checkpoint: AgentCheckpointView) => {
    if (!api || running || busy) return
    if (armed !== checkpoint.id) {
      setArmed(checkpoint.id)
      return
    }
    setArmed(null)
    setBusy(checkpoint.id)
    void api
      .rollback(checkpoint.id)
      .then((result) => {
        setItems((list) =>
          list.map((item) =>
            item.id === checkpoint.id ? { ...item, restoredAt: Date.now() } : item
          )
        )
        const failed = result.failed.length > 0 ? `，${result.failed.length} 个失败` : ''
        notify(`已回退：恢复 ${result.restored} 个，删除 ${result.removed} 个${failed}`)
      })
      .catch((reason: unknown) => setError(friendlyMessage(reason, '回退失败')))
      .finally(() => setBusy(null))
  }

  const content = (
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
        className="w1-wssheet"
        role="dialog"
        aria-modal="true"
        aria-label="会话检查点"
        tabIndex={-1}
        initial={{ opacity: 0, transform: 'translateY(10px) scale(0.99)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="w1-wshead">
          <div>
            <span className="w1-eyebrow">// CHECKPOINTS</span>
            <b>会话检查点</b>
            <p>文件写入前自动留底；回退只改工作区文件，不改对话记录。</p>
          </div>
          <div className="w1-wsactions">
            <button type="button" className="w1-fleetclose" onClick={onClose}>
              <kbd>Esc</kbd> 关闭
            </button>
          </div>
        </header>

        <div className="w1-cplist">
          {error ? <p className="w1-capnote">{error}</p> : null}
          {!error && items.length === 0 ? (
            <p className="w1-capnote">这个会话还没有检查点。Agent 写入文件后会自动出现。</p>
          ) : null}
          {items.map((checkpoint) => (
            <div
              className={`w1-cprow${checkpoint.restoredAt ? ' restored' : ''}`}
              key={checkpoint.id}
            >
              <div className="w1-cpmain">
                <b>{checkpoint.summary}</b>
                <span>
                  {timeLabel(checkpoint.createdAt)} · {checkpoint.files.length} 个文件
                  {checkpoint.restoredAt ? ' · 已回退' : ''}
                </span>
                <div className="w1-cpfiles">
                  {checkpoint.files.slice(0, 4).map((file) => (
                    <i key={file.path}>{file.path}</i>
                  ))}
                  {checkpoint.files.length > 4 ? <i>+{checkpoint.files.length - 4}</i> : null}
                </div>
              </div>
              <button
                className={`w1-cprollback${armed === checkpoint.id ? ' armed' : ''}`}
                type="button"
                disabled={running || busy !== null}
                title={running ? '会话运行中，先停止再回退' : '恢复这些文件到写入前'}
                onClick={() => rollback(checkpoint)}
              >
                {busy === checkpoint.id
                  ? '回退中…'
                  : armed === checkpoint.id
                    ? '确认回退'
                    : checkpoint.restoredAt
                      ? '再次回退'
                      : '回退'}
              </button>
            </div>
          ))}
        </div>

        <footer className="w1-wsfoot">
          <span>{items.length} 个检查点</span>
          <span>只保留工作区内文件；二进制与超大文件不可回退</span>
        </footer>
      </m.div>
    </m.div>
  )
  if (typeof document === 'undefined') return null
  return createPortal(content, document.querySelector('.w1') ?? document.body)
}
