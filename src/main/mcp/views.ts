import { dateKey } from '../../shared/date-key'
import type { LearningItemRecord, NoteSearchHit, TaskRecord } from '../../shared/ipc'
import type { McpData } from './tools'

export const MAX_DETAIL = 300
export const MAX_QUERY = 200
const SNIPPET_OPEN = String.fromCharCode(1)
const SNIPPET_CLOSE = String.fromCharCode(2)

export interface McpToolResult {
  text: string
  isError?: boolean
}

export const TASK_SCOPES = ['today', 'overdue', 'upcoming', 'all', 'done'] as const
export type TaskScope = (typeof TASK_SCOPES)[number]

export function clip(value: string, max = MAX_DETAIL): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function asString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export function ok(value: unknown): McpToolResult {
  return { text: JSON.stringify(value, null, 2) }
}

export function fail(message: string): McpToolResult {
  return { text: message, isError: true }
}

export function taskView(task: TaskRecord): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    done: task.done
  }
  if (task.list) view.list = task.list
  if (task.tag) view.tag = task.tag
  if (task.priority !== undefined) view.priority = task.priority
  if (task.dueDate) view.dueDate = task.dueDate
  if (task.plannedFor) view.plannedFor = task.plannedFor
  if (task.time && task.time !== '—') view.time = task.time
  if (task.estimateMinutes) view.estimateMinutes = task.estimateMinutes
  if (task.repeat) view.repeat = task.repeat
  if (task.completedAt) view.completedOn = dateKey(new Date(task.completedAt))
  if (task.notes) view.notes = clip(task.notes)
  return view
}

export function sortTasks(a: TaskRecord, b: TaskRecord): number {
  const due = (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99')
  if (due !== 0) return due
  const priority = (b.priority ?? 0) - (a.priority ?? 0)
  if (priority !== 0) return priority
  return (a.createdAt ?? 0) - (b.createdAt ?? 0)
}

/** 子任务不进入任何 MCP 视图，与界面口径一致。 */
export function topLevelTasks(data: McpData): TaskRecord[] {
  return data.tasks.list().filter((task) => !task.parentId)
}

/**
 * 「今天到期」的唯一判定：截止日已到今天，或计划在今天。
 * 任务列表与今日概览共用它，避免两处口径漂移。
 */
export function isDueToday(task: TaskRecord, today: string): boolean {
  return (task.dueDate !== undefined && task.dueDate <= today) || task.plannedFor === today
}

export function inScope(task: TaskRecord, scope: TaskScope, today: string): boolean {
  switch (scope) {
    case 'today':
      return !task.done && isDueToday(task, today)
    case 'overdue':
      return !task.done && task.dueDate !== undefined && task.dueDate < today
    case 'upcoming':
      return !task.done && task.dueDate !== undefined && task.dueDate > today
    case 'done':
      return task.done
    default:
      return true
  }
}

/** FTS 片段用 \\u0001/\\u0002 包住命中词，转成方括号更好读。 */
export function readableSnippet(hit: NoteSearchHit): string {
  return (hit.snippet || hit.text).split(SNIPPET_OPEN).join('[').split(SNIPPET_CLOSE).join(']')
}

/** 已到期的学习卡：active 且 nextReviewOn 不晚于今天；可按科目过滤。 */
export function dueCards(data: McpData, today: string, subject = ''): LearningItemRecord[] {
  return data.learning
    .list()
    .filter(
      (card) => card.active && card.nextReviewOn <= today && (!subject || card.subject === subject)
    )
    .sort(
      (a, b) =>
        a.nextReviewOn.localeCompare(b.nextReviewOn) ||
        a.subject.localeCompare(b.subject, 'zh-CN') ||
        a.title.localeCompare(b.title, 'zh-CN')
    )
}
