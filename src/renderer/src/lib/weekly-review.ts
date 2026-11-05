import { addDaysKey, dateKey } from '../../../shared/date-key'
import type { AgentRunRecord, LearningRating, LearningReviewRecord } from '../../../shared/ipc'
import type { Habit, Task } from '../types'
import { topLevel } from './subtasks'
import { formatCost } from './usage'
import { weekDayKeys } from './week'

export const WEEKLY_REVIEW_NOTE_LIMIT = 4000

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
export const WEEKLY_REASON_LABEL = {
  overdue: '逾期',
  due: '本周到期',
  planned: '本周计划'
} as const
export const WEEKLY_RATING_LABEL = {
  1: '重来',
  2: '困难',
  3: '良好',
  4: '简单'
} as const

export type WeeklyReviewReason = 'overdue' | 'due' | 'planned'

export interface WeeklyReviewDay {
  day: string
  label: string
  completed: number
}

export interface WeeklyReviewOpenTask {
  id: string
  title: string
  reason: WeeklyReviewReason
}

export interface WeeklyReviewHabit {
  id: string
  name: string
  count: number
}

export interface WeeklyReviewLearning {
  reviews: number
  ratings: { rating: LearningRating; count: number }[]
}

export interface WeeklyReviewAgent {
  runs: number
  completed: number
  failures: number
  running: number
  cancelled: number
  costUsd: number
}

export interface WeeklyReview {
  weekStart: string
  weekEnd: string
  days: WeeklyReviewDay[]
  completed: { id: string; title: string }[]
  open: WeeklyReviewOpenTask[]
  habits: {
    total: number
    checked: number
    items: WeeklyReviewHabit[]
  }
  learning: WeeklyReviewLearning
  agent: WeeklyReviewAgent
}

export interface WeeklyReviewInput {
  tasks: Task[]
  habits: Habit[]
  learningReviews: LearningReviewRecord[]
  agentRuns: AgentRunRecord[]
  weekStart: string
}

export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const weekStart = input.weekStart
  const weekEnd = addDaysKey(weekStart, 6)
  const days = weekDayKeys(weekStart)
  const allowed = new Set(days)
  const top = topLevel(input.tasks)

  const completedSource = top
    .filter((task) => {
      if (!task.done || task.completedAt === undefined) return false
      return allowed.has(dateKey(new Date(task.completedAt)))
    })
    .sort(
      (a, b) =>
        (a.completedAt ?? 0) - (b.completedAt ?? 0) ||
        a.title.localeCompare(b.title, 'zh-CN') ||
        a.id.localeCompare(b.id)
    )
  const completed = completedSource.map((task) => ({ id: task.id, title: task.title }))
  const completedByDay = new Map<string, number>()
  for (const task of completedSource) {
    if (task.completedAt === undefined) continue
    const day = dateKey(new Date(task.completedAt))
    completedByDay.set(day, (completedByDay.get(day) ?? 0) + 1)
  }

  const open = top
    .filter((task) => !task.done)
    .flatMap((task) => {
      const reason = openReason(task, weekStart, weekEnd)
      return reason ? [{ task, reason }] : []
    })
    .sort((a, b) => {
      const rank =
        (a.reason === 'overdue' ? 0 : a.reason === 'due' ? 1 : 2) -
        (b.reason === 'overdue' ? 0 : b.reason === 'due' ? 1 : 2)
      if (rank !== 0) return rank
      const left = a.reason === 'planned' ? a.task.plannedFor : a.task.dueDate
      const right = b.reason === 'planned' ? b.task.plannedFor : b.task.dueDate
      return (
        (left ?? '').localeCompare(right ?? '') ||
        a.task.title.localeCompare(b.task.title, 'zh-CN') ||
        a.task.id.localeCompare(b.task.id)
      )
    })
    .map(({ task, reason }) => ({ id: task.id, title: task.title, reason }))

  const habitItems = input.habits.map((habit) => ({
    id: habit.id,
    name: habit.name,
    count: habit.checkins.filter((day) => allowed.has(day)).length
  }))

  const ratingCounts = new Map<LearningRating, number>([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0]
  ])
  let reviewCount = 0
  for (const review of input.learningReviews) {
    if (!allowed.has(dateKey(new Date(review.reviewedAt)))) continue
    reviewCount += 1
    ratingCounts.set(review.rating, (ratingCounts.get(review.rating) ?? 0) + 1)
  }

  return {
    weekStart,
    weekEnd,
    days: days.map((day, index) => ({
      day,
      label: WEEK_LABELS[index] ?? `第 ${index + 1} 天`,
      completed: completedByDay.get(day) ?? 0
    })),
    completed,
    open,
    habits: {
      total: input.habits.length * 7,
      checked: habitItems.reduce((sum, habit) => sum + habit.count, 0),
      items: habitItems
    },
    learning: {
      reviews: reviewCount,
      ratings: ([1, 2, 3, 4] as LearningRating[]).map((rating) => ({
        rating,
        count: ratingCounts.get(rating) ?? 0
      }))
    },
    agent: summarizeRuns(input.agentRuns, allowed)
  }
}

export function buildWeeklyReviewNote(review: WeeklyReview): string {
  const lines = [
    `${review.weekStart} 本周回顾`,
    '',
    `统计区间：${review.weekStart} 至 ${review.weekEnd}`,
    '',
    `完成 ${review.completed.length} 项`
  ]
  for (const item of review.completed) lines.push(`- ${item.title}`)

  lines.push('', `未完成 ${review.open.length} 项`)
  for (const item of review.open) {
    lines.push(`- ${item.title}（${WEEKLY_REASON_LABEL[item.reason]}）`)
  }

  lines.push('', `习惯 ${review.habits.checked} 次`)
  for (const habit of review.habits.items) {
    lines.push(`- ${habit.name} ${habit.count}/7`)
  }

  const ratingText = review.learning.ratings
    .map((entry) => `${WEEKLY_RATING_LABEL[entry.rating]} ${entry.count}`)
    .join(' / ')
  lines.push('', `学习：复习 ${review.learning.reviews} 次（${ratingText}）`, '')
  lines.push(`Agent：${formatWeeklyAgentSummary(review.agent, '，')}`, '', '每日完成')
  for (const day of review.days) {
    lines.push(`- ${day.day.slice(5)} ${day.label}：${day.completed}`)
  }

  return truncate(lines.join('\n'))
}

function openReason(task: Task, weekStart: string, weekEnd: string): WeeklyReviewReason | null {
  if (task.dueDate && task.dueDate < weekStart) return 'overdue'
  if (task.dueDate && task.dueDate <= weekEnd) return 'due'
  if (task.plannedFor && task.plannedFor >= weekStart && task.plannedFor <= weekEnd) {
    return 'planned'
  }
  return null
}

function summarizeRuns(runs: AgentRunRecord[], allowed: Set<string>): WeeklyReviewAgent {
  let completed = 0
  let failures = 0
  let running = 0
  let cancelled = 0
  let costUsd = 0
  let total = 0
  for (const run of runs) {
    if (!allowed.has(dateKey(new Date(run.startedAt)))) continue
    total += 1
    if (run.cancelled) cancelled += 1
    else if (run.ok === true) completed += 1
    else if (run.ok === false) failures += 1
    else running += 1
    costUsd += run.costUsd ?? 0
  }
  return {
    runs: total,
    completed,
    failures,
    running,
    cancelled,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000
  }
}

export function formatWeeklyAgentSummary(agent: WeeklyReviewAgent, separator = ' · '): string {
  if (agent.runs === 0) return '本周没有运行'
  const parts = [`${agent.runs} 轮`, `${agent.completed} 成功`, `${agent.failures} 失败`]
  if (agent.running > 0) parts.push(`${agent.running} 进行中`)
  if (agent.cancelled > 0) parts.push(`${agent.cancelled} 取消`)
  parts.push(formatCost(agent.costUsd))
  return parts.join(separator)
}

function truncate(text: string): string {
  const marker = '\n\n…（已截断）'
  if (text.length <= WEEKLY_REVIEW_NOTE_LIMIT) return text
  return text.slice(0, WEEKLY_REVIEW_NOTE_LIMIT - marker.length) + marker
}
