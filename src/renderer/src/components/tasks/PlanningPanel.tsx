import { useEffect, useRef } from 'react'
import { dayCapacity, formatMinutes } from '../../lib/capacity'
import type { Task } from '../../types'
import { CapacityBar } from './CapacityBar'

interface PlanningPanelProps {
  tasks: Task[]
  today: string
  nowMinutes: number
  onPlan: (taskId: string) => void
  onUnplan: (taskId: string) => void
  onClose: () => void
}

export function PlanningPanel({
  tasks,
  today,
  nowMinutes,
  onPlan,
  onUnplan,
  onClose
}: PlanningPanelProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const capacity = dayCapacity(tasks, today, nowMinutes)
  const planned = tasks.filter((task) => !task.done && task.plannedFor === today)
  const unplanned = tasks.filter((task) => !task.done && task.plannedFor !== today).slice(0, 40)

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
        ref={boxRef}
        className="w1-modal w1-plan"
        role="dialog"
        aria-modal="true"
        aria-label="计划今天"
        tabIndex={-1}
      >
        <div className="w1-modalhead">
          <span className="w1-eyebrow">// 计划今天</span>
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

        <CapacityBar capacity={capacity} />

        <div className="w1-plancols">
          <section className="w1-plancol" aria-label="未安排">
            <header>
              <span>未安排</span>
              <b>{unplanned.length}</b>
            </header>
            <div className="w1-planlist">
              {unplanned.length === 0 ? (
                <p className="w1-planempty">收件箱清空了。</p>
              ) : (
                unplanned.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="w1-planrow"
                    onClick={() => onPlan(task.id)}
                  >
                    <span className="w1-planrowtitle">{task.title}</span>
                    <span className="w1-planmeta">
                      {task.estimateMinutes ? formatMinutes(task.estimateMinutes) : '未估时'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="w1-plancol" aria-label="今天已计划">
            <header>
              <span>今天</span>
              <b>{planned.length}</b>
            </header>
            <div className="w1-planlist">
              {planned.length === 0 ? (
                <p className="w1-planempty">还没挑今天要做的事。</p>
              ) : (
                planned.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="w1-planrow on"
                    onClick={() => onUnplan(task.id)}
                  >
                    <span className="w1-planrowtitle">{task.title}</span>
                    <span className="w1-planmeta">
                      {task.estimateMinutes ? formatMinutes(task.estimateMinutes) : '未估时'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="w1-planfoot">
          <span>点左侧加入今天，点右侧移出 · 时长在任务详情里设置</span>
          <button className="w1-pb pri" type="button" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
