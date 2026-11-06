import { useEffect, useMemo, useRef, useState } from 'react'
import { m } from 'motion/react'
import { addDaysKey, dateKey } from '../../../shared/date-key'
import type { AgentRunRecord, LearningReviewRecord } from '../../../shared/ipc'
import { carryOverPatch } from '../lib/carry-over'
import {
  WEEKLY_RATING_LABEL,
  WEEKLY_REASON_LABEL,
  buildWeeklyReview,
  buildWeeklyReviewNote,
  formatWeeklyAgentSummary
} from '../lib/weekly-review'
import { DURATION, EASE_OUT } from '../lib/motion'
import { startOfWeekKey, shiftWeek } from '../lib/week'
import { useWorkstation } from '../store/useWorkstation'
import { CheckIcon } from './Glyphs'

interface WeeklyReviewSheetProps {
  onClose: () => void
}

export function WeeklyReviewSheet({ onClose }: WeeklyReviewSheetProps) {
  const tasks = useWorkstation((state) => state.tasks)
  const habits = useWorkstation((state) => state.habits)
  const addNote = useWorkstation((state) => state.addNote)
  const updateTask = useWorkstation((state) => state.updateTask)
  const boxRef = useRef<HTMLDivElement>(null)
  const [snapshot] = useState(() => ({ tasks, habits, today: dateKey() }))
  const [weekOffset, setWeekOffset] = useState(0)
  const [learningReviews, setLearningReviews] = useState<LearningReviewRecord[]>([])
  const [agentRuns, setAgentRuns] = useState<AgentRunRecord[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reload, setReload] = useState(0)
  const currentWeekStart = startOfWeekKey(snapshot.today)
  const weekStart = shiftWeek(currentWeekStart, weekOffset)
  const weekEnd = addDaysKey(weekStart, 6)
  const nextWeekStart = shiftWeek(weekStart, 1)
  const review = useMemo(
    () =>
      buildWeeklyReview({
        tasks: snapshot.tasks,
        habits: snapshot.habits,
        learningReviews,
        agentRuns,
        weekStart
      }),
    [snapshot, learningReviews, agentRuns, weekStart]
  )
  const [selected, setSelected] = useState(() => new Set(review.open.map((item) => item.id)))
  const [carried, setCarried] = useState(false)
  const canCarry = weekOffset === 0
  const selectedOpen = canCarry ? review.open.filter((item) => selected.has(item.id)) : []
  const maxDay = Math.max(1, ...review.days.map((day) => day.completed))

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    boxRef.current?.focus()
    return () => previous?.focus()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload 只作为重试触发器
  useEffect(() => {
    const learning = typeof window === 'undefined' ? undefined : window.ws?.learning
    const agent = typeof window === 'undefined' ? undefined : window.ws?.agent
    let alive = true
    setLoadState('loading')
    setLearningReviews([])
    setAgentRuns([])
    if (!learning?.reviewHistory && !agent?.usage) {
      setLoadState('ready')
      return
    }
    if (!learning?.reviewHistory || !agent?.usage) {
      setLoadState('error')
      return
    }
    const timer = window.setTimeout(() => {
      if (alive) setLoadState('error')
    }, 2500)
    const jobs: Promise<unknown>[] = [
      learning.reviewHistory(21).then((list) => {
        if (alive) setLearningReviews(list)
      }),
      agent.usage(21).then((list) => {
        if (alive) setAgentRuns(list)
      })
    ]
    void Promise.all(jobs)
      .then(() => {
        if (!alive) return
        window.clearTimeout(timer)
        setLoadState('ready')
      })
      .catch(() => {
        if (!alive) return
        window.clearTimeout(timer)
        setLoadState('error')
      })
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [reload])

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
    if (carried || !canCarry || selectedOpen.length === 0) return
    const byId = new Map(snapshot.tasks.map((task) => [task.id, task]))
    for (const item of selectedOpen) {
      const task = byId.get(item.id)
      if (!task) continue
      const patch = carryOverPatch(task, weekEnd, nextWeekStart)
      if (patch) updateTask(item.id, patch)
    }
    setCarried(true)
  }

  const saveNote = () => {
    const carriedIds =
      canCarry && carried ? new Set(selectedOpen.map((item) => item.id)) : new Set<string>()
    addNote(buildWeeklyReviewNote(review, carriedIds), '复盘')
    onClose()
  }

  const range = `${weekStart.slice(0, 4)}.${weekStart.slice(5, 7)}.${weekStart.slice(8)} – ${weekEnd.slice(5, 7)}.${weekEnd.slice(8)}`
  const weekLabel = weekOffset === 0 ? '本周' : '上一周'
  const ratings = review.learning.ratings
    .map((entry) => `${WEEKLY_RATING_LABEL[entry.rating]} ${entry.count}`)
    .join(' / ')
  const stats = [
    { label: '完成', value: review.completed.length },
    { label: '未完成', value: review.open.length },
    { label: '习惯打卡', value: review.habits.checked },
    { label: '复习', value: loadState === 'ready' ? review.learning.reviews : '—' },
    { label: 'Agent', value: loadState === 'ready' ? review.agent.runs : '—' }
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
        className="w1-modal w1-dreview w1-wreview"
        role="dialog"
        aria-modal="true"
        aria-label="本周回顾"
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
          <span className="w1-eyebrow">// 本周回顾</span>
          <button className="w1-modalx" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="w1-wreviewhead">
          <div className="w1-dreviewintro">
            <h2>{range}</h2>
            <p>{weekLabel} · 周一至周日</p>
          </div>
          <div className="w1-wreviewnav">
            <button type="button" disabled={weekOffset === -1} onClick={() => setWeekOffset(-1)}>
              上一周
            </button>
            {weekOffset === -1 ? (
              <button type="button" onClick={() => setWeekOffset(0)}>
                回到本周
              </button>
            ) : null}
          </div>
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
              <b>每日完成</b>
              <span>周一至周日</span>
            </div>
            <div className="w1-wreviewdays">
              {review.days.map((day) => (
                <div className="w1-wreviewday" key={day.day}>
                  <span>
                    {day.day.slice(5)} {day.label}
                  </span>
                  <i>
                    <b style={{ width: `${(day.completed / maxDay) * 100}%` }} />
                  </i>
                  <em>{day.completed}</em>
                </div>
              ))}
            </div>
          </section>

          <section className="w1-dreviewsection">
            <div className="w1-dreviewsechead">
              <b>完成</b>
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
              <div className="w1-dreviewempty">{weekLabel}还没有完成记录。</div>
            )}
          </section>

          <section className="w1-dreviewsection">
            <div className="w1-dreviewsechead">
              <b>未完成</b>
              <span>{canCarry ? '勾选后顺延到下周' : `${weekLabel} · 只读`}</span>
            </div>
            {review.open.length > 0 ? (
              <div className="w1-dreviewlist">
                {review.open.map((item) => {
                  if (!canCarry) {
                    return (
                      <div className="w1-dreviewrow" key={item.id}>
                        <span className="w1-dreviewrowtitle">{item.title}</span>
                        <span className="w1-dreviewbadge" data-reason={item.reason}>
                          {WEEKLY_REASON_LABEL[item.reason]}
                        </span>
                      </div>
                    )
                  }
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
                        {WEEKLY_REASON_LABEL[item.reason]}
                      </span>
                      {isCarried ? <em className="w1-dreviewcarried">已顺延</em> : null}
                    </label>
                  )
                })}
              </div>
            ) : (
              <div className="w1-dreviewempty">{weekLabel}没有未完成任务。</div>
            )}
          </section>

          <section className="w1-dreviewsection">
            <div className="w1-dreviewsechead">
              <b>习惯</b>
              <span>{review.habits.checked} 次</span>
            </div>
            {review.habits.items.length > 0 ? (
              <div className="w1-dreviewhabits">
                {review.habits.items.map((item) => (
                  <span className={`w1-dreviewhabit${item.count > 0 ? ' on' : ''}`} key={item.id}>
                    {item.name} {item.count}/7
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
              <span>{weekLabel}</span>
            </div>
            <div className="w1-dreviewline">
              <span>
                {loadState === 'ready'
                  ? `复习 ${review.learning.reviews} 次 · ${ratings}`
                  : loadState === 'error'
                    ? '读取失败'
                    : '读取中…'}
              </span>
            </div>
          </section>

          <section className="w1-dreviewsection">
            <div className="w1-dreviewsechead">
              <b>Agent</b>
              <span>{weekLabel}</span>
            </div>
            <div className="w1-dreviewline">
              <span>
                {loadState === 'ready'
                  ? formatWeeklyAgentSummary(review.agent)
                  : loadState === 'error'
                    ? '读取失败'
                    : '读取中…'}
              </span>
            </div>
          </section>
        </div>

        <div className="w1-dreviewfoot">
          <span className="w1-dreviewhint" aria-live="polite">
            {canCarry
              ? carried
                ? `已顺延 ${selectedOpen.length} 项到下周（${nextWeekStart}）`
                : selectedOpen.length > 0
                  ? `已勾选 ${selectedOpen.length} 项 · 顺延到 ${nextWeekStart}`
                  : '没有勾选要顺延的任务'
              : '仅本周可顺延到下周'}
          </span>
          <div className="w1-dreviewactions">
            {canCarry ? (
              <button
                className="w1-btn"
                type="button"
                disabled={carried || selectedOpen.length === 0}
                onClick={applyCarry}
              >
                {carried ? '已顺延' : `顺延 ${selectedOpen.length} 项到下周`}
              </button>
            ) : null}
            {loadState === 'error' ? (
              <button
                className="w1-btn"
                type="button"
                onClick={() => setReload((value) => value + 1)}
              >
                重试
              </button>
            ) : null}
            <button
              className="w1-btn pri"
              type="button"
              disabled={loadState !== 'ready'}
              onClick={saveNote}
            >
              {loadState === 'ready'
                ? '存为本周复盘'
                : loadState === 'error'
                  ? '数据读取失败'
                  : '读取中…'}
            </button>
          </div>
        </div>
      </m.div>
    </m.div>
  )
}
