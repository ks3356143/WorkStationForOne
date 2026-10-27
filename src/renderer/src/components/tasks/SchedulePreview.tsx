import { useEffect, useRef } from 'react'
import { formatClock, planDay } from '../../lib/planner'
import type { Task } from '../../types'

interface SchedulePreviewProps {
  tasks: Task[]
  today: string
  nowMinutes: number
  onAccept: (changes: { taskId: string; time: string }[]) => void
  onClose: () => void
}

export function SchedulePreview({
  tasks,
  today,
  nowMinutes,
  onAccept,
  onClose
}: SchedulePreviewProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const plan = planDay(tasks, today, nowMinutes)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const blocks = plan.blocks.filter((block) => byId.has(block.taskId))
  const plannedCount = tasks.filter((task) => task.plannedFor === today && !task.done).length
  const changes = blocks.map((block) => ({
    taskId: block.taskId,
    time: formatClock(block.start)
  }))

  useEffect(() => {
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => restore?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.isComposing || event.keyCode === 229) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 点击遮罩关闭是模态惯用交互，键盘用户走 Esc
    <div
      className="w1-modalbackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="w1-modal w1-sched"
        role="dialog"
        aria-modal="true"
        aria-label="排程预览"
        tabIndex={-1}
      >
        <div className="w1-modalhead">
          <span className="w1-eyebrow">// 排程预览</span>
          <button
            ref={closeRef}
            className="w1-modalx"
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p className="w1-schedhint">
          按截止时间与优先级排入今天，留出 15 分钟对齐。接受后只改时间，不改截止日期。
        </p>

        <div className="w1-schedlist">
          {blocks.length === 0 && plan.unplaced.length === 0 ? (
            <p className="w1-schedempty">
              {plannedCount === 0
                ? '今天还没有计划。先用「计划今天」挑几件事。'
                : '计划里的任务都已经有开始时间了。'}
            </p>
          ) : null}
          {blocks.length > 0
            ? blocks.map((block) => {
                const task = byId.get(block.taskId)
                return (
                  <div key={block.taskId} className="w1-schedblock">
                    <span className="w1-schedtime">
                      {formatClock(block.start)}–{formatClock(block.end)}
                    </span>
                    <span className="w1-schedtitle">{task?.title}</span>
                  </div>
                )
              })
            : null}

          {plan.unplaced.length > 0 ? (
            <div className="w1-schedunplaced">
              <span>未排入</span>
              {plan.unplaced.map((item) => (
                <div key={item.taskId} className="w1-schedrow">
                  <span>{byId.get(item.taskId)?.title}</span>
                  <em>{item.reason === 'no-estimate' ? '未估时' : '今天放不下'}</em>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="w1-schedfoot">
          <span>{blocks.length > 0 ? `将写入 ${blocks.length} 项时间` : '没有可写入的排程'}</span>
          <div className="w1-schedacts">
            <button className="w1-pb" type="button" onClick={onClose}>
              取消
            </button>
            <button
              className="w1-pb pri w1-schedaccept"
              type="button"
              disabled={changes.length === 0}
              onClick={() => onAccept(changes)}
            >
              接受全部
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
