import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../lib/motion'
import { useWorkstation } from '../store/useWorkstation'

export function QuickNoteModal() {
  const addNote = useWorkstation((state) => state.addNote)
  const closeQuickNote = useWorkstation((state) => state.closeQuickNote)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [])

  const save = () => {
    if (!text.trim()) return
    addNote(text)
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
        if (event.target === event.currentTarget) closeQuickNote()
      }}
    >
      <m.div
        ref={boxRef}
        className="w1-modal"
        role="dialog"
        aria-modal="true"
        aria-label="快速笔记"
        initial={{ opacity: 0, transform: 'translateY(12px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const root = boxRef.current
          if (!root) return
          const nodes = Array.from(
            root.querySelectorAll<HTMLElement>(
              'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            )
          )
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
        <div className="w1-modalhead">
          <span className="w1-eyebrow">// 快速笔记 [^N]</span>
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={closeQuickNote}>
            ×
          </button>
        </div>
        <div className="w1-modaltitle">记下这一刻。</div>
        <textarea
          ref={inputRef}
          className="w1-noteinput"
          value={text}
          rows={5}
          placeholder="想法、结论、待会儿要处理的事…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.ctrlKey || event.metaKey) &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault()
              save()
            }
          }}
        />
        <div className="w1-modalmeta">
          <span className="w1-modalchip">想法</span>
          <span>仅保存在本地</span>
          <span className="sp" />
          <span>{text.length} 字</span>
        </div>
        <div className="w1-modalacts">
          <button className="w1-pb" type="button" onClick={closeQuickNote}>
            取消
          </button>
          <button className="w1-pb pri" type="button" disabled={!text.trim()} onClick={save}>
            保存笔记 <span>^↵</span>
          </button>
        </div>
      </m.div>
    </m.div>
  )
}
