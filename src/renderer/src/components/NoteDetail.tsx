import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import type { NotePatch } from '../../../shared/ipc'
import { DURATION, EASE_OUT } from '../lib/motion'

export interface NoteDetailValue {
  id: string
  text: string
  tag?: string
  pinned?: boolean
  time: string
}

interface NoteDetailProps {
  note: NoteDetailValue
  onSave: (patch: NotePatch) => void
  onDelete: () => void
  onClose: () => void
  onMakeCard: (text: string) => void
}

const MAX_TAG = 40

export function NoteDetail({ note, onSave, onDelete, onClose, onMakeCard }: NoteDetailProps) {
  const [text, setText] = useState(note.text)
  const [tag, setTag] = useState(note.tag ?? '')
  const [confirming, setConfirming] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    textRef.current?.focus()
    textRef.current?.setSelectionRange(note.text.length, note.text.length)
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [note.text])

  const dirty = text.trim() !== note.text || (note.tag ?? '') !== tag.trim()

  const save = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    const patch: NotePatch = {}
    if (trimmed !== note.text) patch.text = trimmed
    if (tag.trim() !== (note.tag ?? '')) patch.tag = tag.trim()
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    onSave(patch)
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
        className="w1-modal w1-notedetail"
        role="dialog"
        aria-modal="true"
        aria-label="笔记详情"
        tabIndex={-1}
        initial={{ opacity: 0, transform: 'translateY(12px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="w1-modalhead">
          <span className="w1-eyebrow">// 笔记 · {note.time}</span>
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <textarea
          ref={textRef}
          className="w1-noteinput w1-notedetail-text"
          value={text}
          rows={8}
          maxLength={4000}
          aria-label="笔记正文"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              save()
            }
          }}
        />

        <div className="w1-notedetail-meta">
          <input
            className="w1-notedetail-tag"
            value={tag}
            maxLength={MAX_TAG}
            placeholder="标签（留空即无标签）"
            aria-label="笔记标签"
            onChange={(event) => setTag(event.target.value)}
          />
          <span className="w1-notedetail-count">{text.length} 字</span>
        </div>

        <div className="w1-modalacts">
          <button className="w1-pb" type="button" onClick={onClose}>
            取消
          </button>
          <button className="w1-notedetail-card" type="button" onClick={() => onMakeCard(text)}>
            变成卡片
          </button>
          <button
            className="w1-notedetail-del"
            type="button"
            onClick={() => (confirming ? onDelete() : setConfirming(true))}
            onBlur={() => setConfirming(false)}
          >
            {confirming ? '再次点击确认删除' : '删除'}
          </button>
          <button
            className="w1-pb pri"
            type="button"
            disabled={!dirty || !text.trim()}
            onClick={save}
          >
            保存修改 <span>^↵</span>
          </button>
        </div>
      </m.div>
    </m.div>
  )
}
