import { useEffect, useMemo, useRef, useState } from 'react'
import { m } from 'motion/react'
import { dateKey } from '../../../shared/date-key'
import type { AgentRunRecord } from '../../../shared/ipc'
import {
  DAILY_REVIEW_REASON_LABEL,
  type DailyReviewAgent,
  buildDailyReview,
  buildDailyReviewNote,
  carryOverPatch
} from '../lib/daily-review'
import { DURATION, EASE_OUT } from '../lib/motion'
import { formatCost } from '../lib/usage'
import { useWorkstation } from '../store/useWorkstation'
import { CheckIcon } from './Glyphs'

interface DailyReviewSheetProps {
  onClose: () => void
}

export function DailyReviewSheet({ onClose }: DailyReviewSheetProps) {
  const tasks = useWorkstation((state) => state.tasks)
  const habits = useWorkstation((state) => state.habits)
  const learningItems = useWorkstation((state) => state.learningItems)
  const addNote = useWorkstation((state) => state.addNote)
  const updateTask = useWorkstation((state) => state.updateTask)
  const startLearningReview = useWorkstation((state) => state.startLearningReview)
  const boxRef = useRef<HTMLDivElement>(null)
  const [snapshot] = useState(() => ({ tasks, habits, learningItems, today: dateKey() }))
  const initialReview = useMemo(() => buildDailyReview({ ...snapshot, runs: [] }), [snapshot])
  const [selected, setSelected] = useState(() => new Set(initialReview.open.map((item) => item.id)))
  const [carried, setCarried] = useState(false)
  const [runs, setRuns] = useState<AgentRunRecord[]>([])
  const [agentReady, setAgentReady] = useState(false)
  const review = useMemo(() => buildDailyReview({ ...snapshot, runs }), [snapshot, runs])
  const selectedOpen = review.open.filter((item) => selected.has(item.id))

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    boxRef.current?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.ws?.agent
    if (!api) {
      setAgentReady(true)
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      if (alive) setAgentReady(true)
    }, 2000)
    void api
      .usage(1)
      .then((list) => {
        if (alive) setRuns(list)
      })
      .catch(() => {})
      .finally(() => {
        if (!alive) return
        window.clearTimeout(timer)
        setAgentReady(true)
      })
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  const toggle = (taskId: string) => {
    if (carried) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const applyCarry = () => {
    if (carried || selectedOpen.length === 0) return
    const byId = new Map(snapshot.tasks.map((task) => [task.id, task]))
    for (const item of selectedOpen) {
      const task = byId.get(item.id)
      if (!task) continue
      const patch = carryOverPatch(task, review.today, review.tomorrow)
      if (patch) updateTask(item.id, patch)
    }
    setCarried(true)
  }

  const saveNote = () => {
    const carriedIds = carried ? new Set(selectedOpen.map((item) => item.id)) : new Set<string>()
    addNote(buildDailyReviewNote(review, carriedIds), '复盘')
    onClose()
  }

  const goReview = () => {
    onClose()
    startLearningReview()
  }

  const stats = [
    { label: '完成', value: review.completed.length },
    { label: '未完成', value: review.open.length },
    { label: '习惯', value: `${review.habits.checked}/${review.habits.total}` },
    { label: '到期复习', value: review.learning.due },
    { label: 'Agent', value: agentReady ? review.agent.runs : '—' }
  ]

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
        tabIndex={-1}
        className="w1-modal w1-dreview"
        role="dialog"
        aria-modal="true"
        aria-label="今日收尾"
        initial={{ opacity: 0, transform: 'translateY(12px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="w1-modalhead">
          <span className="w1-eyebrow">// 今日收尾</span>
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="w1-dreviewintro">
          <h2>{review.today}</h2>
          <p>把今天收好，明天从清空开始。</p>
        </div>

        <div className="w1-dreviewstats" role="list">
          {stats.map((stat) => (
            <div className="w1-dreviewstat" role="listitem" key={stat.label}>
              <b>{stat.value}</b>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>

        <div className="w1-dreviewbody">
          <section className="w1-dreviewsection">
            <div className="w1-dreviewsechead">
              <b>今日完成</b>
              <span>{review.completed.length} 项</span>
            </div>
            {review.completed.length > 0 ? (
              <div className="w1-dreviewlist">
                {review.completed.map((item) => (
                  <div className="w1-dreviewrow w1-dreviewdone" key={item.id}>
                    <CheckIcon width={11} height={11} />
                    <span className="w1-dreviewrowtitle">{item.title}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="w1-dreviewempty">今天还没有完成记录。</div>
            )}
          </section>

          <section className="w1-dreviewsection">
            <div className="w1-dreviewsechead">
              <b>未完成</b>
              <span>勾选后顺延到明天</span>
            </div>
            {review.open.length > 0 ? (
              <div className="w1-dreviewlist">
                {review.open.map((item) => {
                  const isCarried = carried && selected.has(item.id)
                  return (
                    <label
                      className={`w1-dreviewrow w1-dreviewopen${isCarried ? ' is-carried' : ''}`}
                      key={item.id}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        disabled={carried}
                        onChange={() => toggle(item.id)}
                      />
                      <span className="w1-dreviewrowtitle">{item.title}</span>
                      <span className="w1-dreviewbadge" data-reason={item.reason}>
                        {DAILY_REVIEW_REASON_LABEL[item.reason]}
                      </span>
                      {isCarried ? <em className="w1-dreviewcarried">已顺延</em> : null}
                    </label>
                  )
                })}
              </div>
            ) : (
              <div className="w1-dreviewempty">今天没有未完成任务。</div>
            )}
          </section>

          <section className="w1-dreviewsection">
            <div className="w1-dreviewsechead">
              <b>习惯</b>
              <span>
                {review.habits.checked}/{review.habits.total}
              </span>
            </div>
            {review.habits.items.length > 0 ? (
              <div className="w1-dreviewhabits">
                {review.habits.items.map((item) => (
                  <span className={`w1-dreviewhabit${item.checked ? ' on' : ''}`} key={item.id}>
                    {item.checked ? '✓' : '○'} {item.name}
                  </span>
                ))}
              </div>
            ) : (
              <div className="w1-dreviewempty">还没有习惯。</div>
            )}
          </section>

          <section className="w1-dreviewsection">
            <div className="w1-dreviewsechead">
              <b>学习</b>
              <span>复习与到期</span>
            </div>
            <div className="w1-dreviewline">
              <span>
                复习 {review.learning.reviewed} 张 · 仍到期 <b>{review.learning.due}</b> 张
              </span>
              {review.learning.due > 0 ? (
                <button className="w1-btn" type="button" onClick={goReview}>
                  去复习
                </button>
              ) : null}
            </div>
          </section>

          <section className="w1-dreviewsection">
            <div className="w1-dreviewsechead">
              <b>Agent</b>
              <span>今天</span>
            </div>
            <div className="w1-dreviewline">
              <span>{agentReady ? agentSummaryText(review.agent) : '读取中…'}</span>
            </div>
          </section>
        </div>

        <div className="w1-dreviewfoot">
          <span className="w1-dreviewhint" aria-live="polite">
            {carried
              ? `已顺延 ${selectedOpen.length} 项到明天`
              : selectedOpen.length > 0
                ? `已勾选 ${selectedOpen.length} 项`
                : '没有勾选要顺延的任务'}
          </span>
          <div className="w1-dreviewactions">
            <button
              className="w1-btn"
              type="button"
              disabled={carried || selectedOpen.length === 0}
              onClick={applyCarry}
            >
              {carried ? '已顺延' : `顺延 ${selectedOpen.length} 项到明天`}
            </button>
            <button className="w1-btn pri" type="button" disabled={!agentReady} onClick={saveNote}>
              {agentReady ? '存为复盘笔记' : '读取中…'}
            </button>
          </div>
        </div>
      </m.div>
    </m.div>
  )
}

function agentSummaryText(agent: DailyReviewAgent): string {
  if (agent.runs === 0) return '今天没有运行'
  const parts = [`${agent.runs} 轮`, `${agent.completed} 成功`, `${agent.failures} 失败`]
  if (agent.running > 0) parts.push(`${agent.running} 进行中`)
  if (agent.cancelled > 0) parts.push(`${agent.cancelled} 取消`)
  parts.push(formatCost(agent.costUsd))
  return parts.join(' · ')
}
