import { AnimatePresence, m } from 'motion/react'
import type { TaskPatch } from '../../../../shared/ipc'
import type { Task } from '../../types'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { taskDueLabel } from '../../lib/todo'
import { CheckIcon } from '../Glyphs'
import { TaskEditor } from './TaskEditor'

const PRIORITY_LABEL: Record<1 | 2 | 3, string> = { 1: '高', 2: '中', 3: '低' }

interface TaskItemProps {
  task: Task
  today: string
  lists: string[]
  expanded: boolean
  highlight?: boolean
  onToggle: () => void
  onExpand: () => void
  onSave: (patch: TaskPatch) => void
  onDelete: () => void
  onCollapse: () => void
}

export function TaskItem({
  task,
  today,
  lists,
  expanded,
  highlight = false,
  onToggle,
  onExpand,
  onSave,
  onDelete,
  onCollapse
}: TaskItemProps) {
  const due = taskDueLabel(task, today)
  const overdue = Boolean(task.dueDate && task.dueDate < today && !task.done)
  const priority = task.priority ?? 0
  const editorId = `todo-edit-${task.id}`

  return (
    <div
      className={`w1-todorowwrap${task.done ? ' done' : ''}${highlight ? ' landing' : ''}`}
      role="listitem"
    >
      <div className="w1-todorowmain">
        <button
          className={`w1-todocb${task.done ? ' on' : ''}`}
          type="button"
          role="checkbox"
          aria-checked={task.done}
          aria-label={`${task.title} · ${task.done ? '标记未完成' : '完成'}`}
          onClick={onToggle}
        >
          {task.done ? <CheckIcon width={9} height={9} /> : null}
        </button>

        <button
          className="w1-todobody"
          type="button"
          id={`todo-row-${task.id}`}
          aria-expanded={expanded}
          aria-controls={expanded ? editorId : undefined}
          onClick={onExpand}
        >
          <span className="w1-todotitletext">{task.title}</span>
          {task.list ? <span className="w1-todolisttag">#{task.list}</span> : null}
          {priority ? <span className={`w1-todopri p${priority}`}>{PRIORITY_LABEL[priority]}</span> : null}
          {task.tag ? <span className={`w1-tag${task.tone ? ` ${task.tone}` : ''}`}>{task.tag}</span> : null}
          {task.notes ? (
            <span className="w1-todonote" aria-label="有备注">
              备注
            </span>
          ) : null}
        </button>

        <span className={`w1-tododue${overdue ? ' overdue' : task.dueDate === today ? ' today' : ''}`}>
          {due ?? ''}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <m.div
            key="editor"
            id={editorId}
            className="w1-todoeditorwrap"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
          >
            <div className="w1-todoeditorinner">
              <TaskEditor
                task={task}
                lists={lists}
                today={today}
                onSave={onSave}
                onDelete={onDelete}
                onClose={onCollapse}
              />
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
