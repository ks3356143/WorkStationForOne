import { useEffect, useRef } from 'react'
import { m } from 'motion/react'
import type { Task } from '../types'
import { DURATION, EASE_OUT } from '../lib/motion'
import { reminderBuckets, snoozeTime } from '../lib/reminder-center'
import { useNow } from '../lib/useNow'
import { useWorkstation } from '../store/useWorkstation'
import { StatePlaceholder } from './StatePlaceholder'

interface ReminderSheetProps {
  onClose: () => void
  onOpenTask: (taskId: string) => void
}

function ReminderRow({
  task,
  kind,
  onOpen,
  onDone,
  onSnooze
}: {
  task: Task
  kind: 'missed' | 'upcoming'
  onOpen: () => void
  onDone: () => void
  onSnooze: () => void
}) {
  return (
    <div className={`w1-reminderrow ${kind}`}>
      <button className="w1-reminderopen" type="button" onClick={onOpen}>
        <time>{task.time}</time>
        <span className="w1-reminderrowmain">
          <b>{task.title}</b>
          <span>{[task.list, task.tag].filter(Boolean).join(' · ') || '今天'}</span>
        </span>
        <i>{kind === 'missed' ? '已过' : '待提醒'}</i>
      </button>
      <span className="w1-reminderacts">
        <button type="button" className="w1-reminderact" onClick={onDone}>
          完成
        </button>
        <button type="button" className="w1-reminderact" onClick={onSnooze}>
          +10 分
        </button>
      </span>
    </div>
  )
}

export function ReminderSheet({ onClose, onOpenTask }: ReminderSheetProps) {
  const tasks = useWorkstation((state) => state.tasks)
  const tasksReady = useWorkstation((state) => state.tasksReady)
  const toggleTask = useWorkstation((state) => state.toggleTask)
  const updateTask = useWorkstation((state) => state.updateTask)
  const now = useNow(30_000)
  const { missed, upcoming } = reminderBuckets(tasks, now)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    boxRef.current?.focus()
  }, [])

  const open = (task: Task) => {
    onOpenTask(task.id)
    onClose()
  }

  const complete = (task: Task) => toggleTask(task.id)

  const snooze = (task: Task) => {
    const next = snoozeTime(task.time)
    if (next) updateTask(task.id, { time: next })
  }

  const renderRows = (list: Task[], kind: 'missed' | 'upcoming') =>
    list.map((task) => (
      <ReminderRow
        key={task.id}
        task={task}
        kind={kind}
        onOpen={() => open(task)}
        onDone={() => complete(task)}
        onSnooze={() => snooze(task)}
      />
    ))

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
        className="w1-remindersheet"
        role="dialog"
        aria-modal="true"
        aria-label="提醒中心"
        tabIndex={-1}
        initial={{ opacity: 0, transform: 'translateY(12px) scale(0.99)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <header className="w1-reminderhead">
          <div>
            <span className="w1-eyebrow">// REMINDERS</span>
            <b>提醒中心</b>
          </div>
          <span className="w1-remindercount">{missed.length + upcoming.length} 项 · 今天</span>
          <button type="button" className="w1-reminderclose" onClick={onClose}>
            <kbd>Esc</kbd> 关闭
          </button>
        </header>

        <div className="w1-reminderbody">
          {!tasksReady ? (
            <StatePlaceholder kind="loading" rows={3} />
          ) : missed.length + upcoming.length === 0 ? (
            <p className="w1-reminderempty">今天没有带时间的待办。给任务加上时间，到点就会提醒。</p>
          ) : (
            <>
              <section className="w1-remindergroup" aria-label="已错过">
                <div className="w1-remindergrouph">
                  <span className="w1-eyebrow">// 已错过</span>
                  <b>{missed.length}</b>
                </div>
                {missed.length === 0 ? (
                  <p className="w1-reminderhint">没有错过的时间。</p>
                ) : (
                  renderRows(missed, 'missed')
                )}
              </section>

              <section className="w1-remindergroup" aria-label="稍后">
                <div className="w1-remindergrouph">
                  <span className="w1-eyebrow">// 稍后</span>
                  <b>{upcoming.length}</b>
                </div>
                {upcoming.length === 0 ? (
                  <p className="w1-reminderhint">今天没有更晚的提醒。</p>
                ) : (
                  renderRows(upcoming, 'upcoming')
                )}
              </section>
            </>
          )}
        </div>

        <p className="w1-remindernote">系统通知只在应用运行时发送；错过的时间不会补发。</p>
      </m.div>
    </m.div>
  )
}
