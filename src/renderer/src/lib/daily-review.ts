import { addDaysKey, dateKey } from '../../../shared/date-key'
import type { AgentRunRecord, TaskPatch } from '../../../shared/ipc'
import type { Habit, LearningItem, Task } from '../types'
import { topLevel } from './subtasks'
import { formatCost } from './usage'

export const DAILY_REVIEW_NOTE_LIMIT = 4000

export type DailyReviewReason = 'overdue' | 'today' | 'planned'

export interface DailyReviewCompletedTask {
  id: string
  title: string
}

export interface DailyReviewOpenTask {
  id: string
  title: string
  reason: DailyReviewReason
}

export interface DailyReviewHabitItem {
  id: string
  name: string
  checked: boolean
}

export interface DailyReviewHabits {
  total: number
  checked: number
  items: DailyReviewHabitItem[]
}

export interface DailyReviewLearning {
  due: number
  reviewed: number
}

export interface DailyReviewAgent {
  runs: number
  completed: number
  failures: number
  running: number
  cancelled: number
  costUsd: number
}

export interface DailyReview {
  today: string
  tomorrow: string
  completed: DailyReviewCompletedTask[]
  open: DailyReviewOpenTask[]
  habits: DailyReviewHabits
  learning: DailyReviewLearning
  agent: DailyReviewAgent
}

export interface DailyReviewInput {
  tasks: Task[]
  habits: Habit[]
  learningItems: LearningItem[]
  runs: AgentRunRecord[]
  today: string
}

const REASON_RANK: Record<DailyReviewReason, number> = {
  overdue: 0,
  today: 1,
  planned: 2
}

export const DAILY_REVIEW_REASON_LABEL: Record<DailyReviewReason, string> = {
  overdue: '逾期',
  today: '今天到期',
  planned: '计划今天'
}

export function buildDailyReview(input: DailyReviewInput): DailyReview {
  const { today } = input
  const top = topLevel(input.tasks)

  const completed = top
    .filter(
      (task) =>
        task.done && task.completedAt !== undefined && dateKey(new Date(task.completedAt)) === today
    )
    .sort(
      (a, b) =>
        (b.completedAt ?? 0) - (a.completedAt ?? 0) ||
        a.title.localeCompare(b.title, 'zh-CN') ||
        a.id.localeCompare(b.id)
    )
    .map((task) => ({ id: task.id, title: task.title }))

  const open = top
    .filter((task) => !task.done)
    .flatMap((task) => {
      const reason = openReason(task, today)
      return reason ? [{ task, reason }] : []
    })
    .sort((a, b) => {
      const rank = REASON_RANK[a.reason] - REASON_RANK[b.reason]
      if (rank !== 0) return rank
      const left = reasonDate(a.task, a.reason)
      const right = reasonDate(b.task, b.reason)
      return (
        left.localeCompare(right) ||
        a.task.title.localeCompare(b.task.title, 'zh-CN') ||
        a.task.id.localeCompare(b.task.id)
      )
    })
    .map(({ task, reason }) => ({ id: task.id, title: task.title, reason }))

  const habits = input.habits.map((habit) => ({
    id: habit.id,
    name: habit.name,
    checked: habit.checkins.includes(today)
  }))

  const learning = {
    due: input.learningItems.filter((item) => item.active && item.nextReviewOn <= today).length,
    reviewed: input.learningItems.filter((item) => item.lastReviewOn === today).length
  }

  const agent = summarizeAgentRuns(input.runs, today)

  return {
    today,
    tomorrow: addDaysKey(today, 1),
    completed,
    open,
    habits: {
      total: habits.length,
      checked: habits.filter((habit) => habit.checked).length,
      items: habits
    },
    learning,
    agent
  }
}

/** 顺延：计划日一律改到明天；截止日在今天或更早时也改到明天。 */
export function carryOverPatch(task: Task, today: string, tomorrow: string): TaskPatch | null {
  if (task.done) return null
  const due = Boolean(task.dueDate && task.dueDate <= today)
  const planned = Boolean(task.plannedFor && task.plannedFor <= today)
  if (!due && !planned) return null
  return {
    ...(due ? { dueDate: tomorrow } : {}),
    plannedFor: tomorrow
  }
}

export function buildDailyReviewNote(
  review: DailyReview,
  carriedOverIds: ReadonlySet<string> = new Set()
): string {
  const lines = [`${review.today} 今日复盘`, '', `完成 ${review.completed.length} 项`]
  for (const item of review.completed) lines.push(`- ${item.title}`)

  lines.push('', `未完成 ${review.open.length} 项`)
  for (const item of review.open) {
    const labels = [DAILY_REVIEW_REASON_LABEL[item.reason]]
    if (carriedOverIds.has(item.id)) labels.push('顺延到明天')
    lines.push(`- ${item.title}（${labels.join(' · ')}）`)
  }

  lines.push('', `习惯 ${review.habits.checked}/${review.habits.total}`)
  for (const item of review.habits.items) {
    lines.push(`- ${item.checked ? '✓' : '○'} ${item.name}`)
  }

  lines.push('', `学习：复习 ${review.learning.reviewed} 张，仍到期 ${review.learning.due} 张`)
  lines.push('', agentLine(review.agent))

  return truncateNote(lines.join('\n'))
}

function openReason(task: Task, today: string): DailyReviewReason | null {
  if (task.dueDate && task.dueDate < today) return 'overdue'
  if (task.dueDate === today) return 'today'
  if (task.plannedFor && task.plannedFor <= today) return 'planned'
  return null
}

function reasonDate(task: Task, reason: DailyReviewReason): string {
  if (reason === 'planned') return task.plannedFor ?? ''
  return task.dueDate ?? task.plannedFor ?? ''
}

function summarizeAgentRuns(runs: AgentRunRecord[], today: string): DailyReviewAgent {
  let completed = 0
  let failures = 0
  let running = 0
  let cancelled = 0
  let costUsd = 0
  let total = 0

  for (const run of runs) {
    if (dateKey(new Date(run.startedAt)) !== today) continue
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

function agentLine(agent: DailyReviewAgent): string {
  if (agent.runs === 0) return 'Agent：今天没有运行'
  const parts = [`${agent.runs} 轮`, `${agent.completed} 成功`, `${agent.failures} 失败`]
  if (agent.running > 0) parts.push(`${agent.running} 进行中`)
  if (agent.cancelled > 0) parts.push(`${agent.cancelled} 取消`)
  parts.push(formatCost(agent.costUsd))
  return `Agent：${parts.join('，')}`
}

function truncateNote(text: string): string {
  const marker = '\n\n…（已截断）'
  if (text.length <= DAILY_REVIEW_NOTE_LIMIT) return text
  return text.slice(0, DAILY_REVIEW_NOTE_LIMIT - marker.length) + marker
}
