import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import type { Habit } from '../types'
import { DURATION, EASE_OUT } from '../lib/motion'

interface HabitManageSheetProps {
  habits: Habit[]
  onClose: () => void
  onAdd: (name: string) => void
  onRename: (habitId: string, name: string) => void
  onRemove: (habitId: string) => void
}

export function HabitManageSheet({
  habits,
  onClose,
  onAdd,
  onRename,
  onRemove
}: HabitManageSheetProps) {
  const [draft, setDraft] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(habits.map((habit) => [habit.id, habit.name]))
  )
  const [confirming, setConfirming] = useState<string | null>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const confirmTimer = useRef<number | null>(null)

  useEffect(() => {
    addRef.current?.focus()
  }, [])

  useEffect(() => {
    setEdits((current) => {
      const next = { ...current }
      for (const habit of habits) {
        if (!(habit.id in next)) next[habit.id] = habit.name
      }
      for (const id of Object.keys(next)) {
        if (!habits.some((habit) => habit.id === id)) delete next[id]
      }
      return next
    })
  }, [habits])

  useEffect(
    () => () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    },
    []
  )

  const commit = (habit: Habit) => {
    const name = (edits[habit.id] ?? habit.name).trim()
    if (!name) {
      setEdits((current) => ({ ...current, [habit.id]: habit.name }))
      return
    }
    if (name !== habit.name) onRename(habit.id, name)
  }

  const requestRemove = (habitId: string) => {
    if (confirming === habitId) {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
      setConfirming(null)
      onRemove(habitId)
      return
    }
    setConfirming(habitId)
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    confirmTimer.current = window.setTimeout(() => setConfirming(null), 4000)
  }

  const add = () => {
    const name = draft.trim()
    if (!name) return
    onAdd(name)
    setDraft('')
    window.requestAnimationFrame(() => addRef.current?.focus())
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
        className="w1-modal w1-habitmanage"
        role="dialog"
        aria-modal="true"
        aria-label="管理习惯"
        initial={{ opacity: 0, transform: 'translateY(12px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="w1-modalhead">
          <span className="w1-eyebrow">// 习惯管理</span>
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="w1-habitmanage-add">
          <input
            ref={addRef}
            value={draft}
            maxLength={40}
            placeholder="新习惯，例如 阅读 20 分钟"
            aria-label="新习惯名称"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            }}
          />
          <button
            className="w1-habitmanage-addbtn"
            type="button"
            disabled={!draft.trim()}
            onClick={add}
          >
            添加
          </button>
        </div>

        <div className="w1-habitmanage-list" role="list" aria-label="习惯列表">
          {habits.map((habit) => (
            <div className="w1-habitmanage-row" key={habit.id} role="listitem">
              <input
                value={edits[habit.id] ?? habit.name}
                maxLength={40}
                aria-label={`习惯名称：${habit.name}`}
                onChange={(event) =>
                  setEdits((current) => ({ ...current, [habit.id]: event.target.value }))
                }
                onBlur={() => commit(habit)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commit(habit)
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setEdits((current) => ({ ...current, [habit.id]: habit.name }))
                    event.currentTarget.blur()
                  }
                }}
              />
              <button
                className={`w1-habitmanage-del${confirming === habit.id ? ' confirming' : ''}`}
                type="button"
                onClick={() => requestRemove(habit.id)}
                onBlur={() => {
                  if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
                  setConfirming(null)
                }}
              >
                {confirming === habit.id ? '确认删除' : '删除'}
              </button>
            </div>
          ))}
          {habits.length === 0 ? <div className="w1-habitmanage-empty">还没有习惯。</div> : null}
        </div>

        <div className="w1-habitmanage-foot">过去日期可在今日习惯卡上直接补打卡</div>
      </m.div>
    </m.div>
  )
}
