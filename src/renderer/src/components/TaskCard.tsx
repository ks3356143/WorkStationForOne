import { dateKey } from '../../../shared/date-key'
import { filterTasks, useWorkstation } from '../store/useWorkstation'
import { tasksForTodayCard } from '../lib/todo'
import { useNow } from '../lib/useNow'
import type { TaskFilter } from '../types'
import { CheckIcon, SparkIcon } from './Glyphs'

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'todo', label: '待办' },
  { id: 'done', label: '已完成' }
]

interface TaskCardProps {
  nextTaskId?: string
}

export function TaskCard({ nextTaskId }: TaskCardProps) {
  const tasks = useWorkstation((state) => state.tasks)
  const filter = useWorkstation((state) => state.taskFilter)
  const setFilter = useWorkstation((state) => state.setFilter)
  const setView = useWorkstation((state) => state.setView)
  const toggleTask = useWorkstation((state) => state.toggleTask)
  const resolution = useWorkstation((state) => state.resolution)
  const now = useNow(60_000)
  const today = dateKey(now)
  const todayTasks = tasksForTodayCard(tasks, today)

  const doneCount = todayTasks.filter((task) => task.done).length
  const todoCount = todayTasks.length - doneCount
  const visible = filterTasks(todayTasks, filter)
  const half = Math.ceil(visible.length / 2)
  const columns = [visible.slice(0, half), visible.slice(half)]

  const countFor = (id: TaskFilter) =>
    id === 'all' ? todayTasks.length : id === 'todo' ? todoCount : doneCount

  return (
    <section className="w1-card w1-tasks">
      <div className="w1-ct">
        <b>
          <em>//</em>任务与日程
        </b>
        <div className="w1-ctmeta">
          <span>
            {todayTasks.length} 项 · {doneCount} 完成
          </span>
          <button className="w1-ctlink" type="button" onClick={() => setView('tasks')}>
            任务工作区 ›
          </button>
        </div>
      </div>

      <div className="w1-filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`w1-filter${filter === item.id ? ' on' : ''}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label} {countFor(item.id)}
          </button>
        ))}
      </div>

      <div className="w1-tprog">
        <span>进度</span>
        <div className="w1-tbar">
          <i style={{ transform: `scaleX(${todayTasks.length ? doneCount / todayTasks.length : 0})` }} />
        </div>
        <b>
          {doneCount} / {todayTasks.length}
        </b>
      </div>

      <div className="w1-taskgrid">
        {visible.length === 0 ? <div className="w1-tempty">没有符合条件的任务。享受空白。</div> : null}
        {columns.map((column, columnIndex) => (
          <div className="w1-taskcol" key={columnIndex}>
            {column.map((task) => (
              <button
                key={task.id}
                type="button"
                role="checkbox"
                aria-checked={task.done}
                className={`w1-task${task.done ? ' done' : ''}`}
                onClick={() => toggleTask(task.id)}
              >
                <span className="w1-time">{task.time}</span>
                <span className={`w1-cb${task.done ? ' on' : ''}`}>
                  {task.done ? <CheckIcon width={8} height={8} /> : null}
                </span>
                <span className="w1-ttext">{task.title}</span>
                {!task.done && task.id === nextTaskId ? (
                  <span className="w1-tag hot">下一段</span>
                ) : task.tag ? (
                  <span className={`w1-tag${task.tone ? ` ${task.tone}` : ''}`}>{task.tag}</span>
                ) : (
                  <span />
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="w1-anote">
        <SparkIcon width={12} height={12} />
        {resolution === 'allowed' ? (
          <>
            <b>Claude</b> 已顺延 3 项任务，20:30 提醒你复习
            <span className="w1-anote-status ok">完成</span>
          </>
        ) : resolution === 'denied' ? (
          <>
            <b>Claude</b> 变更已拒绝，任务保持原样
            <span className="w1-anote-status deny">已拒绝</span>
          </>
        ) : (
          <>
            <b>Claude</b> 建议顺延 3 项未完成任务，等你确认
            <span className="w1-anote-status pend">待确认</span>
          </>
        )}
      </div>
    </section>
  )
}
