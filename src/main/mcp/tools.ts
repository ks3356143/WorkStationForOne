import { addDaysKey, dateKey } from '../../shared/date-key'
import type { HabitRecord, LearningItemRecord, NoteSearchHit, TaskRecord } from '../../shared/ipc'
import type { AuditEntry } from '../db/audit'

export interface McpData {
  tasks: { list: () => TaskRecord[] }
  notes: { count: () => number; search: (raw: string, limit: number) => NoteSearchHit[] }
  learning: { list: () => LearningItemRecord[] }
  habits: { list: () => HabitRecord[] }
  audit: { record: (entry: AuditEntry) => void }
}

export interface McpToolDef {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties: false
  }
}

export interface McpToolResult {
  text: string
  isError?: boolean
}

const MAX_DETAIL = 300
const MAX_QUERY = 200
const SNIPPET_OPEN = String.fromCharCode(1)
const SNIPPET_CLOSE = String.fromCharCode(2)

const SCOPES = ['today', 'overdue', 'upcoming', 'all', 'done'] as const
type TaskScope = (typeof SCOPES)[number]

function clip(value: string, max = MAX_DETAIL): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function ok(value: unknown): McpToolResult {
  return { text: pretty(value) }
}

function fail(message: string): McpToolResult {
  return { text: message, isError: true }
}

function taskView(task: TaskRecord): Record<string, unknown> {
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

function sortTasks(a: TaskRecord, b: TaskRecord): number {
  const due = (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99')
  if (due !== 0) return due
  const priority = (b.priority ?? 0) - (a.priority ?? 0)
  if (priority !== 0) return priority
  return (a.createdAt ?? 0) - (b.createdAt ?? 0)
}

function topLevelTasks(data: McpData): TaskRecord[] {
  return data.tasks.list().filter((task) => !task.parentId)
}

function inScope(task: TaskRecord, scope: TaskScope, today: string): boolean {
  switch (scope) {
    case 'today':
      return (
        !task.done &&
        ((task.dueDate !== undefined && task.dueDate <= today) || task.plannedFor === today)
      )
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

function tasksList(args: Record<string, unknown>, data: McpData, today: string): McpToolResult {
  const rawScope = asString(args.scope, 20) || 'today'
  if (!SCOPES.includes(rawScope as TaskScope)) {
    return fail(`scope 只支持 ${SCOPES.join(' / ')}`)
  }
  const scope = rawScope as TaskScope
  const limit = numberIn(args.limit, 30, 1, 100)
  const scoped = topLevelTasks(data)
    .filter((task) => inScope(task, scope, today))
    .sort(sortTasks)
  return ok({
    scope,
    today,
    total: scoped.length,
    returned: Math.min(limit, scoped.length),
    tasks: scoped.slice(0, limit).map(taskView)
  })
}

function notesSearch(args: Record<string, unknown>, data: McpData): McpToolResult {
  const query = asString(args.query, MAX_QUERY)
  if (!query) return fail('query 不能为空')
  const limit = numberIn(args.limit, 5, 1, 20)
  const hits = data.notes.search(query, limit)
  return ok({
    query,
    libraryTotal: data.notes.count(),
    returned: hits.length,
    results: hits.map((hit) => {
      const snippet = (hit.snippet || hit.text)
        .split(SNIPPET_OPEN)
        .join('[')
        .split(SNIPPET_CLOSE)
        .join(']')
      return {
        id: hit.id,
        snippet: clip(snippet, 280),
        ...(hit.tag ? { tag: hit.tag } : {}),
        time: hit.time,
        ...(hit.pinned ? { pinned: true } : {})
      }
    })
  })
}

function learningDue(args: Record<string, unknown>, data: McpData, today: string): McpToolResult {
  const subject = asString(args.subject, 40)
  const limit = numberIn(args.limit, 10, 1, 50)
  const due = data.learning
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
  return ok({
    today,
    due: due.length,
    returned: Math.min(limit, due.length),
    cards: due.slice(0, limit).map((card) => ({
      id: card.id,
      subject: card.subject,
      title: card.title,
      ...(card.source ? { source: card.source } : {}),
      nextReviewOn: card.nextReviewOn,
      ...(card.notes ? { notes: clip(card.notes, 600) } : {})
    }))
  })
}

function habitsSummary(data: McpData, today: string): McpToolResult {
  const from = addDaysKey(today, -6)
  const habits = data.habits.list()
  return ok({
    today,
    checked: habits.filter((habit) => habit.checkins.includes(today)).length,
    total: habits.length,
    habits: habits.map((habit) => ({
      id: habit.id,
      name: habit.name,
      checkedToday: habit.checkins.includes(today),
      checkedDays7: habit.checkins.filter((day) => day >= from && day <= today).length,
      totalCheckins: habit.checkins.length
    }))
  })
}

function todayOverview(data: McpData, today: string): McpToolResult {
  const tasks = topLevelTasks(data)
  const open = tasks.filter((task) => !task.done)
  const dueToday = open.filter(
    (task) => (task.dueDate && task.dueDate <= today) || task.plannedFor === today
  )
  const overdue = open.filter((task) => task.dueDate !== undefined && task.dueDate < today)
  const doneToday = tasks.filter(
    (task) => task.done && task.completedAt && dateKey(new Date(task.completedAt)) === today
  )
  const learningDueCount = data.learning
    .list()
    .filter((card) => card.active && card.nextReviewOn <= today).length
  const habits = data.habits.list()
  return ok({
    today,
    tasks: {
      dueToday: dueToday.length,
      overdue: overdue.length,
      doneToday: doneToday.length,
      top: dueToday.sort(sortTasks).slice(0, 3).map(taskView)
    },
    learning: { due: learningDueCount },
    habits: {
      checked: habits.filter((habit) => habit.checkins.includes(today)).length,
      total: habits.length
    },
    notes: { total: data.notes.count() }
  })
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'tasks_list',
    description:
      '读取 WorkStationForOne 本地任务（只读）。可按今天、逾期、即将到来、全部或已完成筛选；默认只返回今天到期或计划今天的任务。',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: [...SCOPES] },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'notes_search',
    description:
      '在 WorkStationForOne 本地笔记中搜索（只读，FTS5 trigram / 短词 LIKE）。只返回命中片段，不返回整篇笔记。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: MAX_QUERY },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'learning_due',
    description:
      '读取到期学习卡（只读，FSRS 到期口径），可带科目过滤。返回正面、来源与答案备注，供辅导复习。',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', maxLength: 40 },
        limit: { type: 'integer', minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'habits_summary',
    description: '读取习惯与最近 7 天打卡情况（只读）。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'today_overview',
    description:
      '读取今天的本地工作台概览（只读）：任务到期/逾期/完成数、学习到期数、习惯打卡与笔记总数。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }
]

export interface McpToolContext {
  sessionId: string
  today?: string
}

/**
 * MCP 工具只有读取能力。每次调用先留审计，再读库；
 * 审计失败不会阻断读取，token 也不进入审计。
 */
export function runMcpTool(
  name: string,
  rawArgs: unknown,
  data: McpData,
  context: McpToolContext
): McpToolResult {
  const args = asRecord(rawArgs)
  const today = context.today ?? dateKey()
  data.audit.record({
    at: Date.now(),
    domain: 'mcp',
    action: 'read',
    targetId: context.sessionId,
    title: name,
    source: 'agent',
    detail: clip(JSON.stringify(args), 500)
  })

  switch (name) {
    case 'tasks_list':
      return tasksList(args, data, today)
    case 'notes_search':
      return notesSearch(args, data)
    case 'learning_due':
      return learningDue(args, data, today)
    case 'habits_summary':
      return habitsSummary(data, today)
    case 'today_overview':
      return todayOverview(data, today)
    default:
      return fail(`未知工具：${name}`)
  }
}
