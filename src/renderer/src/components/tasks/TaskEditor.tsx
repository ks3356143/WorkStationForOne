import { useEffect, useState } from 'react'
import { addDaysKey } from '../../../../shared/date-key'
import type { TaskPatch } from '../../../../shared/ipc'
import type { Task } from '../../types'

const PRIORITIES: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: '无' },
  { value: 3, label: '低' },
  { value: 2, label: '中' },
  { value: 1, label: '高' }
]

interface TaskEditorProps {
  task: Task
  lists: string[]
  today: string
  onSave: (patch: TaskPatch) => void
  onDelete: () => void
  onClose: () => void
}

export function TaskEditor({ task, lists, today, onSave, onDelete, onClose }: TaskEditorProps) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [time, setTime] = useState(task.time === '—' ? '' : task.time)
  const [priority, setPriority] = useState<0 | 1 | 2 | 3>(task.priority ?? 0)
  const [list, setList] = useState(task.list ?? '')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  const save = () => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    onSave({
      title: nextTitle,
      notes,
      dueDate: dueDate || (time ? today : '') || null,
      time: time || '—',
      priority,
      list: list.trim() || null
    })
  }

  const setDate = (value: string) => {
    setDueDate(value)
    if (!value) setTime('')
  }

  const setClock = (value: string) => {
    setTime(value)
    if (value && !dueDate) setDueDate(today)
  }

  return (
    <form
      className="w1-todoedit"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === 'Enter') event.preventDefault()
          return
        }
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          save()
        }
      }}
    >
      <div className="w1-todoeditmain">
        <div className="w1-todofield">
          <label htmlFor={`todo-title-${task.id}`}>标题</label>
          <input
            id={`todo-title-${task.id}`}
            value={title}
            autoFocus
            maxLength={500}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="w1-todofield">
          <label htmlFor={`todo-notes-${task.id}`}>备注</label>
          <textarea
            id={`todo-notes-${task.id}`}
            value={notes}
            maxLength={20_000}
            placeholder="补上上下文、清单或下一步动作…"
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </div>

      <div className="w1-todoeditside">
        <div className="w1-todofield">
          <label htmlFor={`todo-date-${task.id}`}>截止日期</label>
          <input
            id={`todo-date-${task.id}`}
            type="date"
            value={dueDate}
            onChange={(event) => setDate(event.target.value)}
          />
          <div className="w1-tododatequick" role="group" aria-label="快捷日期">
            <button
              type="button"
              className={dueDate === today ? 'on' : ''}
              aria-pressed={dueDate === today}
              onClick={() => setDate(today)}
            >
              今天
            </button>
            <button
              type="button"
              className={dueDate === addDaysKey(today, 1) ? 'on' : ''}
              aria-pressed={dueDate === addDaysKey(today, 1)}
              onClick={() => setDate(addDaysKey(today, 1))}
            >
              明天
            </button>
            {dueDate ? (
              <button type="button" onClick={() => setDate('')}>
                清除
              </button>
            ) : null}
          </div>
        </div>
        <div className="w1-todofield">
          <label htmlFor={`todo-time-${task.id}`}>时间</label>
          <input
            id={`todo-time-${task.id}`}
            type="time"
            value={time}
            onChange={(event) => setClock(event.target.value)}
          />
        </div>
        <div className="w1-todofield">
          <span className="w1-todofieldlabel">优先级</span>
          <div className="w1-todoprirow" role="group" aria-label="任务优先级">
            {PRIORITIES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`w1-todopriopt${priority === item.value ? ' on' : ''}${
                  item.value ? ` p${item.value}` : ''
                }`}
                aria-pressed={priority === item.value}
                onClick={() => setPriority(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="w1-todofield">
          <label htmlFor={`todo-list-${task.id}`}>清单</label>
          <input
            id={`todo-list-${task.id}`}
            list="w1-todolists"
            value={list}
            maxLength={80}
            placeholder="无清单"
            onChange={(event) => setList(event.target.value)}
          />
        </div>
        <datalist id="w1-todolists">
          {lists.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      <div className="w1-todoactions">
        <button className="w1-todosave" type="submit" disabled={!title.trim()}>
          保存
        </button>
        <button className="w1-todocancel" type="button" onClick={onClose}>
          收起
        </button>
        <button
          className={`w1-tododelete${confirming ? ' confirming' : ''}`}
          type="button"
          onClick={() => {
            if (confirming) onDelete()
            else setConfirming(true)
          }}
        >
          {confirming ? '再次点击确认删除' : '删除任务'}
        </button>
      </div>
    </form>
  )
}
