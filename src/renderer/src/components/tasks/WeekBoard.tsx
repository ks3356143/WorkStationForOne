import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import type { Task } from '../../types'
import { addDaysKey } from '../../../../shared/date-key'
import { WEEKDAY_CN } from '../../lib/date'
import { TASK_DRAG_TYPE } from '../../lib/dnd'
import {
  groupTasksByWeek,
  shiftWeek,
  startOfWeekKey,
  weekBacklog,
  weekDayKeys
} from '../../lib/week'

interface WeekBoardProps {
  tasks: Task[]
  today: string
  onOpen: (taskId: string) => void
  onSchedule: (taskId: string, date: string, options?: { instant?: boolean }) => void
}

function weekdayOf(key: string): number {
  const [year, month, date] = key.split('-').map(Number)
  return new Date(year, month - 1, date).getDay()
}

export function WeekBoard({ tasks, today, onOpen, onSchedule }: WeekBoardProps) {
  const [start, setStart] = useState(() => startOfWeekKey(today))
  const [dragDate, setDragDate] = useState<string | null>(null)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  const [movedTaskId, setMovedTaskId] = useState<string | null>(null)
  const boardRef = useRef<HTMLElement>(null)
  const moveTimer = useRef<number | null>(null)
  const groups = groupTasksByWeek(tasks, start)
  const backlog = weekBacklog(tasks)
  const days = weekDayKeys(start)
  const count = groups.reduce((total, group) => total + group.tasks.length, 0)
  const range = `${start.slice(5).replace('-', '.')} – ${days[6]?.slice(5).replace('-', '.')}`

  // 跨周移动后重新挂载的是另一列里的按钮，渲染完成再把焦点还给同一任务。
  // biome-ignore lint/correctness/useExhaustiveDependencies: start/tasks 用于跨周或列表刷新后重新尝试聚焦
  useEffect(() => {
    if (!focusTaskId) return
    const target = boardRef.current?.querySelector<HTMLElement>(`[data-task-id="${focusTaskId}"]`)
    if (!target) return
    target.focus()
    setFocusTaskId(null)
  }, [focusTaskId, start, tasks])

  useEffect(
    () => () => {
      if (moveTimer.current) window.clearTimeout(moveTimer.current)
    },
    []
  )

  const flashMoved = (taskId: string) => {
    setMovedTaskId(taskId)
    if (moveTimer.current) window.clearTimeout(moveTimer.current)
    moveTimer.current = window.setTimeout(() => setMovedTaskId(null), 620)
  }

  const moveTask = (taskId: string, date: string, delta: number) => {
    const next = addDaysKey(date, delta)
    onSchedule(taskId, next, { instant: true })
    const nextStart = startOfWeekKey(next)
    if (nextStart !== start) setStart(nextStart)
    setFocusTaskId(taskId)
    flashMoved(taskId)
  }

  const scheduleBacklog = (taskId: string) => {
    onSchedule(taskId, days[0] ?? start, { instant: true })
    setFocusTaskId(taskId)
    flashMoved(taskId)
  }

  const dropProps = (date: string) => ({
    onDragOver: (event: ReactDragEvent) => {
      if (!event.dataTransfer.types.includes(TASK_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDragDate((current) => (current === date ? current : date))
    },
    onDragLeave: () => setDragDate((current) => (current === date ? null : current)),
    onDrop: (event: ReactDragEvent) => {
      event.preventDefault()
      setDragDate(null)
      const taskId = event.dataTransfer.getData(TASK_DRAG_TYPE)
      if (taskId) onSchedule(taskId, date)
    }
  })

  return (
    <section className="w1-weekview" aria-label="任务周视图" ref={boardRef}>
      <div className="w1-weekhead">
        <span className="w1-eyebrow">// 周视图</span>
        <b className="w1-weekrange">{range}</b>
        <span className="w1-weekcount">{count} 项</span>
        <span className="w1-weekspacer" />
        <button
          className="w1-wkbtn"
          type="button"
          aria-label="上一周"
          onClick={() => setStart(shiftWeek(start, -1))}
        >
          ‹
        </button>
        <button className="w1-wkbtn" type="button" onClick={() => setStart(startOfWeekKey(today))}>
          今天
        </button>
        <button
          className="w1-wkbtn"
          type="button"
          aria-label="下一周"
          onClick={() => setStart(shiftWeek(start, 1))}
        >
          ›
        </button>
      </div>
      <p className="w1-weekhint">
        拖拽或 Alt + ←/→ 改期；未排期按 Alt + → 排到本周一。计划日期优先于截止日期。
      </p>

      {backlog.length > 0 ? (
        <div className="w1-weekbacklog">
          <span className="w1-weekbackloglabel">// 未排期</span>
          <div className="w1-weekbackloglist">
            {backlog.slice(0, 12).map((task) => (
              <button
                key={task.id}
                className={`w1-wkchip${movedTaskId === task.id ? ' moved' : ''}`}
                type="button"
                draggable
                data-task-id={task.id}
                aria-keyshortcuts="Alt+ArrowRight"
                title={`${task.title} · Alt+→ 排到本周一`}
                onDragStart={(event) => {
                  event.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => onOpen(task.id)}
                onKeyDown={(event) => {
                  if (!event.altKey || event.key !== 'ArrowRight') return
                  event.preventDefault()
                  scheduleBacklog(task.id)
                }}
              >
                {task.title}
              </button>
            ))}
            {backlog.length > 12 ? <i>+{backlog.length - 12}</i> : null}
          </div>
        </div>
      ) : null}

      <div className="w1-weekgrid">
        {groups.map((group) => {
          const weekday = weekdayOf(group.date)
          const weekend = weekday === 0 || weekday === 6
          return (
            <section
              key={group.date}
              className={[
                'w1-wkday',
                group.date === today ? 'today' : '',
                weekend ? 'weekend' : '',
                dragDate === group.date ? 'drop' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              data-week-date={group.date}
              {...dropProps(group.date)}
            >
              <header className="w1-wkdayhead">
                <span>周{WEEKDAY_CN[weekday]}</span>
                <b>{group.date.slice(5)}</b>
                <i>{group.tasks.length}</i>
              </header>
              {group.tasks.map((task) => (
                <button
                  key={task.id}
                  className={`w1-wktask${task.done ? ' done' : ''}${task.priority ? ` p${task.priority}` : ''}${movedTaskId === task.id ? ' moved' : ''}`}
                  type="button"
                  draggable
                  data-task-id={task.id}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  title={`${task.title} · Alt+←/→ 移动一天`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={() => onOpen(task.id)}
                  onKeyDown={(event) => {
                    if (!event.altKey) return
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    moveTask(task.id, group.date, event.key === 'ArrowLeft' ? -1 : 1)
                  }}
                >
                  {task.time !== '—' ? <time>{task.time}</time> : null}
                  <span className="w1-wktitle">{task.title}</span>
                  {task.tag ? <i>{task.tag}</i> : null}
                </button>
              ))}
              {group.tasks.length === 0 ? <p className="w1-wkempty">拖到这里</p> : null}
            </section>
          )
        })}
      </div>
    </section>
  )
}
