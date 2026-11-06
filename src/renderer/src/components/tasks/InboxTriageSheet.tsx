import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { addDaysKey, dateKey } from '../../../../shared/date-key'
import type { TaskPatch, TaskPriority } from '../../../../shared/ipc'
import type { Task } from '../../types'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { filterTasksByScope, taskLists } from '../../lib/todo'
import { useWorkstation } from '../../store/useWorkstation'
import { ComboSelect } from '../fields/ComboSelect'
import { DatePicker } from '../fields/DatePicker'

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 0, label: '无' },
  { value: 3, label: '低' },
  { value: 2, label: '中' },
  { value: 1, label: '高' }
]

interface InboxTriageSheetProps {
  onClose: () => void
}

interface TriageStats {
  organized: number
  completed: number
  deleted: number
  skipped: number
}

export function InboxTriageSheet({ onClose }: InboxTriageSheetProps) {
  const tasks = useWorkstation((state) => state.tasks)
  const updateTask = useWorkstation((state) => state.updateTask)
  const toggleTask = useWorkstation((state) => state.toggleTask)
  const removeTask = useWorkstation((state) => state.removeTask)
  const boxRef = useRef<HTMLDivElement>(null)
  const [queue] = useState(() =>
    filterTasksByScope(tasks, 'inbox', dateKey()).map((task) => task.id)
  )
  const [index, setIndex] = useState(0)
  const [finished, setFinished] = useState(queue.length === 0)
  const [stats, setStats] = useState<TriageStats>({
    organized: 0,
    completed: 0,
    deleted: 0,
    skipped: 0
  })
  const current = tasks.find((task) => task.id === queue[index])
  const today = dateKey()

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    boxRef.current?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    if (finished || current) return
    if (index + 1 >= queue.length) setFinished(true)
    else setIndex(index + 1)
  }, [current, finished, index, queue.length])

  const advance = () => {
    if (index + 1 >= queue.length) setFinished(true)
    else setIndex(index + 1)
  }

  const save = (task: Task, patch: TaskPatch) => {
    if (Object.keys(patch).length > 0) updateTask(task.id, patch)
    setStats((value) => ({ ...value, organized: value.organized + 1 }))
    advance()
  }

  const complete = (task: Task) => {
    toggleTask(task.id)
    setStats((value) => ({ ...value, completed: value.completed + 1 }))
    advance()
  }

  const remove = (task: Task) => {
    removeTask(task.id)
    setStats((value) => ({ ...value, deleted: value.deleted + 1 }))
    advance()
  }

  const skip = () => {
    setStats((value) => ({ ...value, skipped: value.skipped + 1 }))
    advance()
  }

  const progress = queue.length === 0 ? 100 : Math.round((index / queue.length) * 100)
  const listNames = taskLists(tasks).map((item) => item.name)

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
        tabIndex={-1}
        className="w1-modal w1-triage"
        role="dialog"
        aria-modal="true"
        aria-label="收件箱整理"
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
          <span className="w1-eyebrow">// 收件箱整理</span>
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        {finished ? (
          <div className="w1-triagefinish">
            <div className="w1-modaltitle">
              {queue.length === 0 ? '收件箱是空的。' : '整理完成。'}
            </div>
            {queue.length === 0 ? (
              <p className="w1-triageempty">先捕获几条任务，再回来整理。</p>
            ) : (
              <>
                <p className="w1-triageempty">
                  整理 {stats.organized} 条 · 完成 {stats.completed} 条 · 删除 {stats.deleted} 条 ·
                  留到以后 {stats.skipped} 条
                </p>
                {stats.skipped > 0 ? (
                  <p className="w1-triagehint">留到以后的任务仍在收集箱，随时可以再整理。</p>
                ) : null}
              </>
            )}
            <button className="w1-pb pri" type="button" onClick={onClose}>
              完成
            </button>
          </div>
        ) : current ? (
          <>
            <div className="w1-triageprogress">
              <span>
                第 <b>{index + 1}</b> / {queue.length} 条
              </span>
              <span>设置后保存，或留到以后</span>
            </div>
            <div className="w1-triagebar" aria-hidden="true">
              <i style={{ width: `${Math.max(2, progress)}%` }} />
            </div>
            <TriageCard
              key={current.id}
              task={current}
              today={today}
              listNames={listNames}
              onSave={(patch) => save(current, patch)}
              onComplete={() => complete(current)}
              onDelete={() => remove(current)}
              onSkip={skip}
            />
          </>
        ) : null}
      </m.div>
    </m.div>
  )
}

interface TriageCardProps {
  task: Task
  today: string
  listNames: string[]
  onSave: (patch: TaskPatch) => void
  onComplete: () => void
  onDelete: () => void
  onSkip: () => void
}

function TriageCard({
  task,
  today,
  listNames,
  onSave,
  onComplete,
  onDelete,
  onSkip
}: TriageCardProps) {
  const [list, setList] = useState(task.list ?? '')
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task.priority ?? 0)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deleteTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
    },
    []
  )

  const patch: TaskPatch = {}
  const nextList = list.trim()
  if (nextList !== (task.list ?? '')) patch.list = nextList || null
  if (dueDate !== (task.dueDate ?? '')) patch.dueDate = dueDate || null
  if (priority !== (task.priority ?? 0)) patch.priority = priority
  const changed = Object.keys(patch).length > 0

  const requestDelete = () => {
    if (confirmingDelete) {
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
      setConfirmingDelete(false)
      onDelete()
      return
    }
    setConfirmingDelete(true)
    if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
    deleteTimer.current = window.setTimeout(() => setConfirmingDelete(false), 4000)
  }

  return (
    <div className="w1-triagecard">
      <div className="w1-triagetitle">{task.title}</div>
      {task.notes ? <p className="w1-triagenotes">{task.notes}</p> : null}

      <div className="w1-triagegrid">
        <div className="w1-todofield">
          <label htmlFor="triage-list">清单</label>
          <ComboSelect
            id="triage-list"
            value={list}
            label="清单"
            placeholder="留空则留在收集箱"
            options={listNames}
            emptyLabel="留在收集箱"
            onChange={setList}
          />
        </div>
        <div className="w1-todofield">
          <span className="w1-todofieldlabel">截止日期</span>
          <DatePicker
            id="triage-date"
            value={dueDate}
            today={today}
            label="截止日期"
            onChange={setDueDate}
          />
          <div className="w1-tododatequick" role="group" aria-label="快捷截止日期">
            <button
              type="button"
              className={dueDate === today ? 'on' : ''}
              aria-pressed={dueDate === today}
              onClick={() => setDueDate(today)}
            >
              今天
            </button>
            <button
              type="button"
              className={dueDate === addDaysKey(today, 1) ? 'on' : ''}
              aria-pressed={dueDate === addDaysKey(today, 1)}
              onClick={() => setDueDate(addDaysKey(today, 1))}
            >
              明天
            </button>
            <button type="button" onClick={() => setDueDate('')}>
              清除
            </button>
          </div>
        </div>
      </div>

      <div className="w1-todofield w1-triagepriority">
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

      <div className="w1-triageactions">
        <button className="w1-pb" type="button" onClick={onComplete}>
          标记完成
        </button>
        <button
          className={`w1-tododelete${confirmingDelete ? ' confirming' : ''}`}
          type="button"
          onClick={requestDelete}
          onBlur={() => {
            if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
            setConfirmingDelete(false)
          }}
        >
          {confirmingDelete ? '再次点击确认删除' : '删除'}
        </button>
        <span className="w1-triagegrow" />
        <button className="w1-pb" type="button" onClick={onSkip}>
          留到以后
        </button>
        <button className="w1-pb pri" type="button" onClick={() => onSave(patch)}>
          {changed ? '保存并下一条' : '下一条'}
        </button>
      </div>
    </div>
  )
}
