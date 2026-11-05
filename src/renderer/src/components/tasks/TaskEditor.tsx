import { useEffect, useState } from 'react'
import { addDaysKey } from '../../../../shared/date-key'
import type { TaskPatch } from '../../../../shared/ipc'
import type { Task } from '../../types'
import {
  buildRepeatRule,
  EVERY_MAX,
  EVERY_MIN,
  nextDueDate,
  parseRepeat,
  WEEKDAY_NAMES,
  type RepeatKind,
  type RepeatRule
} from '../../../../shared/repeat'
import { childrenOf, subtaskProgress } from '../../lib/subtasks'
import { taskToAgentPrompt } from '../../lib/agent-handoff'
import { ComboSelect } from '../fields/ComboSelect'
import { DatePicker } from '../fields/DatePicker'
import { TimePicker } from '../fields/TimePicker'

const ESTIMATES = [0, 15, 30, 60, 90, 120] as const

const REPEAT_OPTIONS: { kind: RepeatKind | null; label: string }[] = [
  { kind: null, label: '不重复' },
  { kind: 'daily', label: '每天' },
  { kind: 'weekly', label: '每周' },
  { kind: 'monthly', label: '每月' },
  { kind: 'weekday', label: '工作日' },
  { kind: 'every', label: '每 N 天' },
  { kind: 'monthlyNth', label: '每月第 N 个' }
]

const PRIORITIES: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: '无' },
  { value: 3, label: '低' },
  { value: 2, label: '中' },
  { value: 1, label: '高' }
]

interface TaskEditorProps {
  task: Task
  /** 全部任务：用来列出这条任务的子任务 */
  tasks: Task[]
  onAddSubtask: (title: string) => void
  onToggleSubtask: (id: string) => void
  lists: string[]
  today: string
  onSave: (patch: TaskPatch) => void
  onDelete: () => void
  onClose: () => void
  /** 把当前草稿交给 Agent：只预填输入栏，不自动发送 */
  onHandoff: (prompt: string) => void
}

export function TaskEditor({
  task,
  tasks,
  lists,
  today,
  onSave,
  onDelete,
  onClose,
  onAddSubtask,
  onToggleSubtask,
  onHandoff
}: TaskEditorProps) {
  const children = childrenOf(tasks, task.id)
  const progress = subtaskProgress(tasks, task.id)
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [time, setTime] = useState(task.time === '—' ? '' : task.time)
  const [priority, setPriority] = useState<0 | 1 | 2 | 3>(task.priority ?? 0)
  const [list, setList] = useState(task.list ?? '')
  const [plannedFor, setPlannedFor] = useState(task.plannedFor ?? '')
  const [estimate, setEstimate] = useState(task.estimateMinutes ?? 0)
  const initialRepeat = parseRepeat(task.repeat ?? null)
  const [repeatKind, setRepeatKind] = useState<RepeatKind | null>(initialRepeat?.kind ?? null)
  const [repeatEvery, setRepeatEvery] = useState(initialRepeat?.every ?? 3)
  const [repeatNth, setRepeatNth] = useState(initialRepeat?.nth ?? 1)
  const [repeatWeekday, setRepeatWeekday] = useState(initialRepeat?.weekday ?? 1)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  const repeatValue: RepeatRule | null = repeatKind
    ? buildRepeatRule({
        kind: repeatKind,
        every: repeatEvery,
        nth: repeatNth,
        weekday: repeatWeekday
      })
    : null
  const repeatNext = repeatValue ? nextDueDate(repeatValue, dueDate || today) : ''

  const save = () => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    onSave({
      title: nextTitle,
      notes,
      dueDate: dueDate || (time ? today : '') || null,
      time: time || '—',
      priority,
      list: list.trim() || null,
      plannedFor: plannedFor || null,
      estimateMinutes: estimate,
      repeat: repeatValue
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
          <span className="w1-todofieldlabel">截止日期</span>
          <DatePicker
            id={`todo-date-${task.id}`}
            value={dueDate}
            today={today}
            label="截止日期"
            onChange={setDate}
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
          <span className="w1-todofieldlabel">时间</span>
          <TimePicker id={`todo-time-${task.id}`} value={time} label="时间" onChange={setClock} />
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
          <span className="w1-todofieldlabel">计划于</span>
          <div className="w1-tododatequick" role="group" aria-label="计划日期">
            <button
              type="button"
              className={plannedFor === today ? 'on' : ''}
              aria-pressed={plannedFor === today}
              onClick={() => setPlannedFor(today)}
            >
              今天
            </button>
            <button
              type="button"
              className={plannedFor === addDaysKey(today, 1) ? 'on' : ''}
              aria-pressed={plannedFor === addDaysKey(today, 1)}
              onClick={() => setPlannedFor(addDaysKey(today, 1))}
            >
              明天
            </button>
            {plannedFor ? (
              <button type="button" onClick={() => setPlannedFor('')}>
                清除
              </button>
            ) : null}
          </div>
        </div>
        <div className="w1-todofield">
          <span className="w1-todofieldlabel">重复</span>
          <div className="w1-todoprirow" role="group" aria-label="重复规则">
            {REPEAT_OPTIONS.map((option) => (
              <button
                key={option.kind ?? 'none'}
                type="button"
                className={`w1-todopriopt${repeatKind === option.kind ? ' on' : ''}`}
                aria-pressed={repeatKind === option.kind}
                onClick={() => setRepeatKind(option.kind)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {repeatKind === 'every' ? (
            <div className="w1-todorepeatparams">
              <span>每</span>
              <input
                className="w1-todorepeatnum"
                type="number"
                min={EVERY_MIN}
                max={EVERY_MAX}
                value={repeatEvery}
                aria-label="重复间隔天数"
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next)) {
                    setRepeatEvery(Math.min(EVERY_MAX, Math.max(EVERY_MIN, Math.trunc(next))))
                  }
                }}
              />
              <span>天重复一次</span>
            </div>
          ) : null}
          {repeatKind === 'monthlyNth' ? (
            <>
              <div className="w1-todoprirow" role="group" aria-label="每月第几个">
                {[1, 2, 3, 4].map((nth) => (
                  <button
                    key={nth}
                    type="button"
                    className={`w1-todopriopt${repeatNth === nth ? ' on' : ''}`}
                    aria-pressed={repeatNth === nth}
                    onClick={() => setRepeatNth(nth)}
                  >
                    第 {nth} 个
                  </button>
                ))}
              </div>
              <div className="w1-todoprirow" role="group" aria-label="星期几">
                {WEEKDAY_NAMES.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    className={`w1-todopriopt${repeatWeekday === index ? ' on' : ''}`}
                    aria-pressed={repeatWeekday === index}
                    onClick={() => setRepeatWeekday(index)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {repeatValue ? (
            <p className="w1-todorepeatnext">
              下次：{repeatNext}
              {dueDate ? '' : '（无截止日期，按今天算）'}
            </p>
          ) : null}
        </div>
        <div className="w1-todofield">
          <span className="w1-todofieldlabel">预计时长</span>
          <div className="w1-todoprirow" role="group" aria-label="预计时长">
            {ESTIMATES.map((value) => (
              <button
                key={value}
                type="button"
                className={`w1-todopriopt${estimate === value ? ' on' : ''}`}
                aria-pressed={estimate === value}
                onClick={() => setEstimate(value)}
              >
                {value === 0 ? '未估' : `${value}m`}
              </button>
            ))}
          </div>
        </div>
        <div className="w1-todofield">
          <span className="w1-todofieldlabel">清单</span>
          <ComboSelect
            id={`todo-list-${task.id}`}
            value={list}
            label="清单"
            placeholder="无清单"
            options={lists}
            maxLength={80}
            emptyLabel="无清单"
            onChange={setList}
          />
        </div>
      </div>

      <div className="w1-todosubs">
        <span className="w1-todofieldlabel">
          子任务 {progress.total > 0 ? `${progress.done}/${progress.total}` : ''}
        </span>
        {children.map((child) => (
          <div className="w1-todosubrow" key={child.id}>
            <button
              type="button"
              className={`w1-todocb small${child.done ? ' on' : ''}`}
              role="checkbox"
              aria-checked={child.done}
              aria-label={`${child.title} · ${child.done ? '标记未完成' : '完成'}`}
              onClick={() => onToggleSubtask(child.id)}
            >
              {child.done ? '✓' : ''}
            </button>
            <span className={child.done ? 'done' : ''}>{child.title}</span>
          </div>
        ))}
        <div className="w1-todosubadd">
          <input
            value={subtaskDraft}
            maxLength={200}
            placeholder="添加子任务，Enter 确认"
            aria-label="添加子任务"
            onChange={(event) => setSubtaskDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') {
                event.preventDefault()
                const title = subtaskDraft.trim()
                if (!title) return
                onAddSubtask(title)
                setSubtaskDraft('')
              }
            }}
          />
        </div>
      </div>

      <div className="w1-todoactions">
        <button className="w1-todosave" type="submit" disabled={!title.trim()}>
          保存
        </button>
        <button
          className="w1-todohand"
          type="button"
          disabled={!title.trim()}
          onClick={() =>
            onHandoff(
              taskToAgentPrompt({
                title,
                notes,
                dueDate: dueDate || undefined,
                time,
                priority,
                list,
                estimateMinutes: estimate
              })
            )
          }
        >
          交给 Agent
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
