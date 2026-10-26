import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../lib/motion'
import type { FocusSession } from '../types'

interface FocusOverlayProps {
  focus: FocusSession
  onClose: () => void
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function FocusOverlay({ focus, onClose }: FocusOverlayProps) {
  const total = focus.minutes * 60
  const [remaining, setRemaining] = useState(total)
  const [paused, setPaused] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const pauseRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const done = remaining <= 0

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    pauseRef.current?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    if (paused || done) return
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [paused, done])

  const progress = total === 0 ? 0 : remaining / total

  return (
    <m.div
      className="w1-focus"
      role="dialog"
      aria-modal="true"
      aria-label="专注模式"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.focusBackdrop }}
    >
      <div className="w1-focus-aurora" aria-hidden="true" />
      <m.div
        ref={boxRef}
        className={`w1-focus-box${done ? ' done' : ''}`}
        initial={{ opacity: 0, transform: 'translateY(14px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.focus, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const root = boxRef.current
          if (!root) return
          const nodes = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'))
          if (nodes.length === 0) {
            event.preventDefault()
            return
          }
          const first = nodes[0]
          const last = nodes[nodes.length - 1]
          const active = document.activeElement
          if (!root.contains(active)) {
            event.preventDefault()
            const next = event.shiftKey ? last : first
            next.focus()
          } else if (event.shiftKey && active === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && active === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <span className="w1-focus-glow" aria-hidden="true" />
        <div className="w1-focus-head">
          <span>// 专注模式</span>
          <span>{paused ? 'PAUSED' : done ? 'DONE' : 'FOCUS'}</span>
        </div>
        <div className="w1-focus-label">{focus.label}</div>
        <div className={`w1-focus-time${done ? ' done' : ''}`}>{formatCountdown(remaining)}</div>
        <div className="w1-focus-track">
          <i style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="w1-focus-meta">
          <span>单任务 · 本地 · 不发送上下文</span>
          <span>{done ? '本轮完成' : `${focus.minutes} 分钟`}</span>
        </div>
        <div className="w1-focus-acts">
          <button
            ref={pauseRef}
            className="w1-pb"
            type="button"
            onClick={() => setPaused((value) => !value)}
            disabled={done}
          >
            {paused ? '继续' : '暂停'}
          </button>
          <button className="w1-pb pri" type="button" onClick={onClose}>
            {done ? '收下这一轮' : '结束专注'}
          </button>
        </div>
      </m.div>
      <div className="w1-focus-foot">// ESC 退出 · 计时仅在本机运行</div>
    </m.div>
  )
}
