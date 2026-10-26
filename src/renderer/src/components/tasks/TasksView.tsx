import { useEffect, useState } from 'react'
import { addDaysKey, dateKey } from '../../../../shared/date-key'
import type { TaskDraft, TaskPatch } from '../../../../shared/ipc'
import type { TaskViewMode } from '../../types'
import {
  filterTasksByScope,
  groupTasksByDate,
  searchTasks,
  taskCounts,
  taskLists
} from '../../lib/todo'
import { useNow } from '../../lib/useNow'
import { useWorkstation } from '../../store/useWorkstation'
import { PlusIcon } from '../Glyphs'
import { QuickAdd } from './QuickAdd'
import { TaskItem } from './TaskItem'

const SMART_LISTS: { scope: TaskViewMode; label: string; key: string }[] = [
  { scope: 'inbox', label: '收集箱', key: '01' },
  { scope: 'today', label: '今天', key: '02' },
  { scope: 'upcoming', label: '即将到来', key: '03' },
  { scope: 'all', label: '全部任务', key: '04' },
  { scope: 'done', label: '已完成', key: '05' }
]

const EMPTY: Record<TaskViewMode, string> = {
  inbox: '收集箱是空的。',
  today: '今天没有待办。享受空白。',
  upcoming: '未来还没有排期。',
  all: '还没有任务。',
  done: '还没有完成记录。'
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function groupDateLabel(key: string, today: string): string {
  const [year, month, day] = key.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()]
  const prefix = key === addDaysKey(today, 1) ? '明天 · ' : ''
  const date = key.slice(0, 4) === today.slice(0, 4) ? key.slice(5) : key
  return `${prefix}${date} · 周${weekday}`
}

function dueDestination(key: string | undefined, today: string): string {
  if (!key) return ''
  if (key === today) return '今天'
  if (key === addDaysKey(today, 1)) return '明天'
  return key.slice(5)
}

interface TasksViewProps {
  notify: (text: string, action?: { label: string; run: () => void }, duration?: number) => void
}

let lastHandledComposeRequest = 0

export function TasksView({ notify }: TasksViewProps) {
  const tasks = useWorkstation((state) => state.tasks)
  const scope = useWorkstation((state) => state.taskScope)
  const setScope = useWorkstation((state) => state.setTaskScope)
  const composeTask = useWorkstation((state) => state.composeTask)
  const taskComposerRequest = useWorkstation((state) => state.taskComposerRequest)
  const lastAddedTaskId = useWorkstation((state) => state.lastAddedTaskId)
  const clearLastAddedTask = useWorkstation((state) => state.clearLastAddedTask)
  const toggleTask = useWorkstation((state) => state.toggleTask)
  const addTask = useWorkstation((state) => state.addTask)
  const updateTask = useWorkstation((state) => state.updateTask)
  const removeTask = useWorkstation((state) => state.removeTask)
  const undoRemoveTask = useWorkstation((state) => state.undoRemoveTask)

  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const now = useNow(60_000)
  const today = dateKey(now)

  const counts = taskCounts(tasks, today)
  const activeList = scope.startsWith('list:') ? scope.slice('list:'.length) : undefined
  const lists = taskLists(tasks, activeList)
  const listNames = lists.map((item) => item.name)
  const searching = query.trim().length > 0
  const visible = searching ? searchTasks(tasks, query) : filterTasksByScope(tasks, scope, today)
  const completedVisible = visible.reduce((count, task) => count + (task.done ? 1 : 0), 0)
  const title = activeList ?? SMART_LISTS.find((item) => item.scope === scope)?.label ?? '任务'

  useEffect(() => {
    setExpandedId(null)
  }, [scope, query])

  useEffect(() => {
    if (taskComposerRequest === lastHandledComposeRequest) return
    lastHandledComposeRequest = taskComposerRequest
    setQuery('')
    if (scope === 'done') setScope('today')
  }, [taskComposerRequest, scope, setScope])

  useEffect(() => {
    if (!lastAddedTaskId) return
    const timer = window.setTimeout(clearLastAddedTask, 900)
    return () => window.clearTimeout(timer)
  }, [lastAddedTaskId, clearLastAddedTask])

  const focusRow = (taskId: string) => {
    requestAnimationFrame(() => document.getElementById(`todo-row-${taskId}`)?.focus())
  }

  const handleAdd = (draft: TaskDraft) => {
    addTask(draft)
    const destination =
      [draft.list ? `#${draft.list}` : '', dueDestination(draft.dueDate, today), draft.time ?? '']
        .filter(Boolean)
        .join(' · ') || '收集箱'
    const label = draft.title.length > 24 ? `${draft.title.slice(0, 24)}…` : draft.title
    notify(`已添加「${label}」 · ${destination}`)
  }

  const countFor = (target: TaskViewMode) => counts[target]

  const groups = searching
    ? [{ key: 'search', label: '', tasks: visible }]
    : scope === 'upcoming'
      ? groupTasksByDate(visible).map((group) => ({
          key: group.date,
          label: groupDateLabel(group.date, today),
          tasks: group.tasks
        }))
      : [{ key: scope, label: '', tasks: visible }]

  return (
    <section className="w1-workspace w1-todos" aria-label="任务工作区">
      <aside className="w1-todorail" aria-label="任务视图与清单">
        <div className="w1-todorailhead">
          <span className="w1-eyebrow">// 视图</span>
          <button className="w1-todonew" type="button" onClick={composeTask}>
            <PlusIcon width={10} height={10} />
            新建
          </button>
        </div>

        <div className="w1-todonav" role="group" aria-label="智能清单">
          {SMART_LISTS.map((item) => (
            <button
              key={item.scope}
              type="button"
              className={`w1-todorow${scope === item.scope ? ' on' : ''}`}
              aria-pressed={scope === item.scope}
              onClick={() => {
                setQuery('')
                setScope(item.scope)
              }}
            >
              <span className="w1-todokey">{item.key}</span>
              <span className="w1-todolabel">{item.label}</span>
              <span className="w1-todocount">{countFor(item.scope)}</span>
            </button>
          ))}
        </div>

        {lists.length > 0 ? (
          <div className="w1-todogroup">
            <span className="w1-todogrouplabel">// 清单</span>
            {lists.map((item) => {
              const target = `list:${item.name}` as const
              return (
                <button
                  key={item.name}
                  type="button"
                  className={`w1-todorow${scope === target ? ' on' : ''}`}
                  aria-pressed={scope === target}
                  onClick={() => {
                    setQuery('')
                    setScope(target)
                  }}
                >
                  <span className="w1-todokey">#</span>
                  <span className="w1-todolabel">{item.name}</span>
                  <span className="w1-todocount">{item.count}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="w1-todorailfoot">
          <kbd>^⇧N</kbd>
          <span>随时捕获新任务</span>
        </div>
      </aside>

      <div className="w1-todomain">
        <header className="w1-todohead">
          <div>
            <div className="w1-date">
              <i>//</i> 任务
            </div>
            <h1 className="w1-todotitle">
              {title}
              <span>.</span>
            </h1>
            <div className="w1-todosub">
              {searching ? (
                <>
                  搜索 <b>{visible.length}</b> 项
                </>
              ) : (
                <>
                  <span className="w1-subtag">今日</span>
                  <b>{counts.today}</b> 项 · 未完成 <b>{counts.all}</b> · 已完成 <b>{counts.done}</b>
                </>
              )}
            </div>
          </div>

          <div className="w1-todosearch">
            <span aria-hidden="true">&gt;</span>
            <input
              value={query}
              placeholder="搜索任务、备注与清单…"
              aria-label="搜索任务"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault()
                  setQuery('')
                }
              }}
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="清空任务搜索">
                清空
              </button>
            ) : null}
          </div>
        </header>

        {scope !== 'done' && !searching ? (
          <QuickAdd scope={scope} today={today} focusSignal={taskComposerRequest} onAdd={handleAdd} />
        ) : null}

        <div className="w1-todoscroll" key={scope}>
          {groups.map((group) => (
            <div
              className="w1-todogroupblock"
              key={group.key}
              role="list"
              aria-label={searching ? '搜索结果' : group.label || title}
            >
              {group.label ? (
                <div className="w1-todogroupdate">
                  <span>{group.label}</span>
                  <small>{group.tasks.length}</small>
                </div>
              ) : null}

              {group.tasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  today={today}
                  lists={listNames}
                  expanded={expandedId === task.id}
                  highlight={task.id === lastAddedTaskId}
                  onToggle={() => toggleTask(task.id)}
                  onExpand={() => setExpandedId((current) => (current === task.id ? null : task.id))}
                  onSave={(patch: TaskPatch) => {
                    updateTask(task.id, patch)
                    setExpandedId(null)
                    focusRow(task.id)
                  }}
                  onDelete={() => {
                    removeTask(task.id)
                    setExpandedId(null)
                    notify(`已删除「${task.title}」`, { label: '撤销', run: undoRemoveTask }, 6000)
                    requestAnimationFrame(() =>
                      document.querySelector<HTMLInputElement>('.w1-todosearch input')?.focus()
                    )
                  }}
                  onCollapse={() => {
                    setExpandedId(null)
                    focusRow(task.id)
                  }}
                />
              ))}
            </div>
          ))}

          {visible.length === 0 ? (
            <div className="w1-todoempty">
              <b>{searching ? '没有匹配的任务。' : EMPTY[scope as TaskViewMode] ?? '这个清单还是空的。'}</b>
              <span>
                {searching
                  ? '换个关键词，或清空搜索回到当前视图。'
                  : scope === 'done'
                    ? '完成任务后会出现在这里。'
                    : '在下方输入一行，Enter 即可添加。'}
              </span>
            </div>
          ) : (
            <div className="w1-todoend">
              <span>// END</span>
              <b>
                {visible.length} 项
                {completedVisible > 0 ? ` · ${completedVisible} 完成` : ''}
              </b>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
