import { useState, type DragEvent as ReactDragEvent } from 'react'
import type { Task } from '../../types'
import { WEEKDAY_CN } from '../../lib/date'
import { TASK_DRAG_TYPE } from '../../lib/dnd'
import { dayLoad, groupTasksByMonth, monthGrid, monthLabel, shiftMonth } from '../../lib/month'

interface MonthBoardProps {
  tasks: Task[]
  today: string
  onOpen: (taskId: string) => void
  onOpenDay: (date: string) => void
  onSchedule: (taskId: string, date: string, options?: { instant?: boolean }) => void
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function MonthBoard({ tasks, today, onOpen, onOpenDay, onSchedule }: MonthBoardProps) {
  const [cursor, setCursor] = useState(() => {
    const [year, month] = today.split('-').map(Number)
    return { year, month }
  })
  const [dragDate, setDragDate] = useState<string | null>(null)
  const cells = monthGrid(cursor.year, cursor.month)
  const groups = groupTasksByMonth(tasks, cells)
  const count = groups.reduce((total, group) => total + group.tasks.length, 0)

  const go = (delta: number) => setCursor(shiftMonth(cursor.year, cursor.month, delta))
  const goToday = () => {
    const [year, month] = today.split('-').map(Number)
    setCursor({ year, month })
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
    <section className="w1-monthview" aria-label="任务月视图">
      <div className="w1-weekhead">
        <span className="w1-eyebrow">// 月视图</span>
        <b className="w1-weekrange">{monthLabel(cursor.year, cursor.month)}</b>
        <span className="w1-weekcount">{count} 项</span>
        <span className="w1-weekspacer" />
        <button className="w1-wkbtn" type="button" aria-label="上个月" onClick={() => go(-1)}>
          ‹
        </button>
        <button className="w1-wkbtn" type="button" onClick={goToday}>
          本月
        </button>
        <button className="w1-wkbtn" type="button" aria-label="下个月" onClick={() => go(1)}>
          ›
        </button>
      </div>
      <p className="w1-weekhint">
        拖拽任务到某天改期；点日期查看当天清单。计划日期优先于截止日期。
      </p>

      <div className="w1-monthweekdays">
        {WEEKDAY_ORDER.map((weekday) => (
          <span key={weekday}>周{WEEKDAY_CN[weekday]}</span>
        ))}
      </div>

      <div className="w1-monthgrid">
        {groups.map((group) => {
          const load = dayLoad(group.tasks.length)
          return (
            <section
              key={group.day}
              className={[
                'w1-mday',
                group.inMonth ? '' : 'out',
                group.day === today ? 'today' : '',
                dragDate === group.day ? 'drop' : '',
                `load-${load}`
              ]
                .filter(Boolean)
                .join(' ')}
              data-month-date={group.day}
              {...dropProps(group.day)}
            >
              <button
                className="w1-mdaynum"
                type="button"
                aria-label={`${group.day} · ${group.tasks.length} 项，查看当天`}
                onClick={() => onOpenDay(group.day)}
              >
                <b>{Number(group.day.slice(8))}</b>
                {group.tasks.length > 0 ? <i>{group.tasks.length}</i> : null}
              </button>
              <div className="w1-mtasks">
                {group.tasks.slice(0, 2).map((task) => (
                  <button
                    key={task.id}
                    className={`w1-mtask${task.done ? ' done' : ''}${task.priority ? ` p${task.priority}` : ''}`}
                    type="button"
                    draggable
                    data-task-id={task.id}
                    title={task.title}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => onOpen(task.id)}
                  >
                    {task.title}
                  </button>
                ))}
                {group.tasks.length > 2 ? (
                  <span className="w1-mmore">+{group.tasks.length - 2}</span>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}
