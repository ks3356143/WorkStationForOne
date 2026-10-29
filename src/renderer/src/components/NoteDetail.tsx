import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { noteLinkName } from '../../../shared/note-links'
import type { NoteLinks, NotePatch, NoteRecord } from '../../../shared/ipc'
import { applyLink, linkTrigger } from '../lib/note-link-input'
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
  onOpenNote: (note: NoteDetailValue) => void
}

const MAX_TAG = 40
const SUGGEST_LIMIT = 8

function toDetail(record: NoteRecord): NoteDetailValue {
  return {
    id: record.id,
    text: record.text,
    tag: record.tag,
    pinned: record.pinned,
    time: record.time
  }
}

export function NoteDetail({
  note,
  onSave,
  onDelete,
  onClose,
  onMakeCard,
  onOpenNote
}: NoteDetailProps) {
  const [text, setText] = useState(note.text)
  const [tag, setTag] = useState(note.tag ?? '')
  const [confirming, setConfirming] = useState(false)
  const [links, setLinks] = useState<NoteLinks | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [active, setActive] = useState(0)
  const [trigger, setTrigger] = useState<{ start: number; caret: number; query: string } | null>(
    null
  )
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const suggestSeq = useRef(0)
  const suggestTimer = useRef<number | null>(null)

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

  const api = typeof window === 'undefined' ? undefined : window.ws?.notes

  useEffect(() => {
    if (!api) return
    let cancelled = false
    api
      .links(note.id)
      .then((next) => {
        if (!cancelled) setLinks(next)
      })
      .catch((cause) => console.error('[notes] 读取链接失败', cause))
    return () => {
      cancelled = true
    }
  }, [api, note.id])

  useEffect(
    () => () => {
      if (suggestTimer.current) window.clearTimeout(suggestTimer.current)
    },
    []
  )

  const closeSuggestions = () => {
    suggestSeq.current += 1
    if (suggestTimer.current) window.clearTimeout(suggestTimer.current)
    setSuggestions([])
    setTrigger(null)
  }

  const syncTrigger = (value: string, caret: number) => {
    const found = api ? linkTrigger(value, caret) : null
    if (!found) {
      closeSuggestions()
      return
    }
    setTrigger({ start: found.start, caret, query: found.query })
    setActive(0)
    if (suggestTimer.current) window.clearTimeout(suggestTimer.current)
    const seq = ++suggestSeq.current
    suggestTimer.current = window.setTimeout(() => {
      void api
        ?.titles(found.query, SUGGEST_LIMIT, note.id)
        .then((names) => {
          if (seq === suggestSeq.current) setSuggestions(names)
        })
        .catch((cause) => {
          console.error('[notes] 读取补全失败', cause)
          if (seq === suggestSeq.current) setSuggestions([])
        })
    }, 120)
  }

  const choose = (title: string) => {
    if (!trigger) return
    const result = applyLink(
      text,
      { start: trigger.start, query: trigger.query },
      trigger.caret,
      title
    )
    setText(result.text)
    closeSuggestions()
    window.requestAnimationFrame(() => {
      const node = textRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(result.caret, result.caret)
    })
  }

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
          onChange={(event) => {
            const value = event.target.value
            setText(value)
            syncTrigger(value, event.target.selectionStart ?? value.length)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (suggestions.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((index) => (index + 1) % suggestions.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => (index - 1 + suggestions.length) % suggestions.length)
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                choose(suggestions[active] ?? suggestions[0])
                return
              }
              if (event.key === 'Escape') {
                event.stopPropagation()
                closeSuggestions()
                return
              }
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              save()
            }
          }}
        />

        {suggestions.length > 0 ? (
          <div className="w1-nlsuggest" role="listbox" aria-label="链接笔记建议">
            {suggestions.map((name, index) => (
              <button
                key={name}
                className={index === active ? 'on' : ''}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(name)}
              >
                <i>[[</i>
                {name}
                <i>]]</i>
              </button>
            ))}
          </div>
        ) : null}

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

        <div className="w1-nllinks">
          {links && links.outgoing.length > 0 ? (
            <div className="w1-nlgroup">
              <span className="w1-nllabel">引用</span>
              <div className="w1-nlchips">
                {links.outgoing.map((link) => {
                  const target = link.status === 'ok' ? link.target : undefined
                  if (target) {
                    return (
                      <button
                        key={link.title}
                        className="w1-nlchip"
                        type="button"
                        onClick={() => onOpenNote(toDetail(target))}
                      >
                        [[{link.title}]]
                      </button>
                    )
                  }
                  return (
                    <span
                      key={link.title}
                      className="w1-nlchip bad"
                      title={
                        link.status === 'ambiguous'
                          ? '有多篇同名笔记，不建立链接'
                          : '找不到同名笔记'
                      }
                    >
                      [[{link.title}]] · {link.status === 'ambiguous' ? '重名' : '未找到'}
                    </span>
                  )
                })}
              </div>
            </div>
          ) : null}

          {links && links.backlinks.length > 0 ? (
            <div className="w1-nlgroup">
              <span className="w1-nllabel">被引用 · {links.backlinks.length}</span>
              <div className="w1-nlbacklist">
                {links.backlinks.map((row) => (
                  <button
                    key={row.id}
                    className="w1-nlback"
                    type="button"
                    onClick={() => onOpenNote(toDetail(row))}
                  >
                    <span>{noteLinkName(row.text) || row.text.slice(0, 24)}</span>
                    <small>{row.time}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {links && links.outgoing.length === 0 && links.backlinks.length === 0 ? (
            <span className="w1-nlhint">输入 [[笔记首行]] 引用另一篇笔记</span>
          ) : null}
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
