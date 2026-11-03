import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import type { Task } from '../types'
import { addDaysKey, dateKey } from '../../../shared/date-key'
import { DURATION, EASE_OUT } from '../lib/motion'
import { reminderBuckets, snoozeTime } from '../lib/reminder-center'
import { useNow } from '../lib/useNow'
import { useWorkstation } from '../store/useWorkstation'
import { Popover } from './fields/Popover'
import { StatePlaceholder } from './StatePlaceholder'

interface ReminderSheetProps {
  notify: (text: string, action?: { label: string; run: () => void }, duration?: number) => void
  onClose: () => void
  onOpenTask: (taskId: string) => void
}

function ReminderRow({
  task,
  kind,
  onOpen,
  onDone,
  onSnooze,
  onMute
}: {
  task: Task
  kind: 'missed' | 'upcoming'
  onOpen: () => void
  onDone: () => void
  onSnooze: (minutes: number | 'tomorrow') => void
  onMute: () => void
}) {
  return (
    <m.div
      className={`w1-reminderrow ${kind}`}
      layout="position"
      initial={{ opacity: 0, transform: 'translateY(6px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      exit={{ opacity: 0, transform: 'translateX(10px)' }}
      transition={{ duration: DURATION.ui, ease: EASE_OUT }}
    >
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
        <button type="button" className="w1-reminderact" onClick={() => onSnooze(10)}>
          +10 分
        </button>
        <ReminderSnooze onPick={onSnooze} />
        <button
          type="button"
          className="w1-reminderact w1-remindermute"
          title="今天不再提醒"
          onClick={onMute}
        >
          今天不再
        </button>
      </span>
    </m.div>
  )
}

function ReminderSnooze({ onPick }: { onPick: (minutes: number | 'tomorrow') => void }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="w1-reminderact w1-remindersnooze"
        aria-label="更多稍后时间"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="更多稍后时间"
        onClick={() => setOpen((value) => !value)}
      >
        ⌄
      </button>
      <Popover
        anchor={anchorRef.current}
        open={open}
        onClose={() => setOpen(false)}
        label="稍后提醒"
        width={150}
      >
        <div className="w1-snoozemenu">
          {[10, 30, 60].map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => {
                onPick(minutes)
                setOpen(false)
              }}
            >
              {minutes} 分钟后
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onPick('tomorrow')
              setOpen(false)
            }}
          >
            明天 09:00
          </button>
        </div>
      </Popover>
    </>
  )
}

export function ReminderSheet({ notify, onClose, onOpenTask }: ReminderSheetProps) {
  const tasks = useWorkstation((state) => state.tasks)
  const tasksReady = useWorkstation((state) => state.tasksReady)
  const reminderMutes = useWorkstation((state) => state.reminderMutes)
  const toggleTask = useWorkstation((state) => state.toggleTask)
  const updateTask = useWorkstation((state) => state.updateTask)
  const muteReminder = useWorkstation((state) => state.muteReminder)
  const unmuteReminder = useWorkstation((state) => state.unmuteReminder)
  const clearReminderMutes = useWorkstation((state) => state.clearReminderMutes)
  const now = useNow(30_000)
  const today = dateKey(now)
  const mutedIds =
    reminderMutes.day === today && reminderMutes.taskIds.length > 0
      ? new Set(reminderMutes.taskIds)
      : undefined
  const all = reminderBuckets(tasks, now)
  const { missed, upcoming } = reminderBuckets(tasks, now, mutedIds)
  const mutedItems = [...all.missed, ...all.upcoming].filter((task) => mutedIds?.has(task.id))
  const total = all.missed.length + all.upcoming.length
  const visibleCount = missed.length + upcoming.length
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    boxRef.current?.focus()
  }, [])

  const open = (task: Task) => {
    onOpenTask(task.id)
    onClose()
  }

  const complete = (task: Task) => toggleTask(task.id)

  const snooze = (task: Task, minutes: number | 'tomorrow') => {
    if (minutes === 'tomorrow') {
      updateTask(task.id, { dueDate: addDaysKey(today, 1), time: '09:00' })
      return
    }
    const next = snoozeTime(task.time, minutes)
    if (next) updateTask(task.id, { time: next })
  }

  const mute = (task: Task) => {
    muteReminder(task.id, today)
    notify(
      `今天不再提醒「${task.title}」`,
      { label: '撤销', run: () => unmuteReminder(task.id, today) },
      4200
    )
  }

  const restoreAll = () => {
    clearReminderMutes(today)
    notify('已恢复今天的全部提醒')
  }

  const renderRows = (list: Task[], kind: 'missed' | 'upcoming') =>
    list.map((task) => (
      <ReminderRow
        key={task.id}
        task={task}
        kind={kind}
        onOpen={() => open(task)}
        onDone={() => complete(task)}
        onSnooze={(minutes) => snooze(task, minutes)}
        onMute={() => mute(task)}
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
          <span className="w1-remindercount">{visibleCount} 项 · 今天</span>
          <button type="button" className="w1-reminderclose" onClick={onClose}>
            <kbd>Esc</kbd> 关闭
          </button>
        </header>

        <div className="w1-reminderbody">
          {!tasksReady ? (
            <StatePlaceholder kind="loading" rows={3} />
          ) : total === 0 ? (
            <p className="w1-reminderempty">今天没有带时间的待办。给任务加上时间，到点就会提醒。</p>
          ) : visibleCount === 0 ? (
            <p className="w1-reminderempty">今天的提醒都已静音。需要时在下方恢复。</p>
          ) : (
            <>
              <section className="w1-remindergroup" aria-label="已错过">
                <div className="w1-remindergrouph">
                  <span className="w1-eyebrow">// 已错过</span>
                  <b>{missed.length}</b>
                </div>
                <AnimatePresence initial={false}>
                  {missed.length === 0 ? (
                    <p className="w1-reminderhint" key="missed-empty">
                      没有错过的时间。
                    </p>
                  ) : (
                    renderRows(missed, 'missed')
                  )}
                </AnimatePresence>
              </section>

              <section className="w1-remindergroup" aria-label="稍后">
                <div className="w1-remindergrouph">
                  <span className="w1-eyebrow">// 稍后</span>
                  <b>{upcoming.length}</b>
                </div>
                <AnimatePresence initial={false}>
                  {upcoming.length === 0 ? (
                    <p className="w1-reminderhint" key="upcoming-empty">
                      今天没有更晚的提醒。
                    </p>
                  ) : (
                    renderRows(upcoming, 'upcoming')
                  )}
                </AnimatePresence>
              </section>
            </>
          )}
        </div>

        <AnimatePresence initial={false}>
          {mutedItems.length > 0 ? (
            <m.div
              className="w1-remindermutedbar"
              role="status"
              layout
              initial={{ opacity: 0, transform: 'translateY(6px)' }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }}
              exit={{ opacity: 0, transform: 'translateY(4px)' }}
              transition={{ duration: DURATION.ui, ease: EASE_OUT }}
            >
              <span>
                今天已静音 <b>{mutedItems.length}</b> 项
              </span>
              <button type="button" className="w1-reminderrestore" onClick={restoreAll}>
                恢复全部
              </button>
            </m.div>
          ) : null}
        </AnimatePresence>

        <p className="w1-remindernote">
          系统通知只在应用运行时发送；错过的时间不会补发；静音只对今天生效。
        </p>
      </m.div>
    </m.div>
  )
}
