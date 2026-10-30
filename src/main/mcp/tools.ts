import { addDaysKey, dateKey, isDateKey } from '../../shared/date-key'
import type {
  HabitRecord,
  LearningItemRecord,
  LearningRating,
  NoteRecord,
  NoteSearchHit,
  TaskDraft,
  TaskPatch,
  TaskPriority,
  TaskRecord
} from '../../shared/ipc'
import type { AuditEntry } from '../db/audit'

export interface McpData {
  /** 可嵌套事务；MCP 写入把业务写入与审计绑在一起 */
  transaction: <T>(run: () => T) => T
  tasks: {
    list: () => TaskRecord[]
    find: (id: string) => TaskRecord | undefined
    create: (draft: TaskDraft) => TaskRecord
    update: (id: string, patch: TaskPatch) => void
    completeTask: (id: string) => TaskRecord | null
  }
  notes: {
    count: () => number
    search: (raw: string, limit: number) => NoteSearchHit[]
    create: (text: string, tag?: string) => NoteRecord
  }
  learning: {
    list: () => LearningItemRecord[]
    review: (id: string, rating: LearningRating, today?: string) => LearningItemRecord
  }
  habits: {
    list: () => HabitRecord[]
    setCheckin: (id: string, day: string, done: boolean) => void
  }
  audit: {
    record: (entry: AuditEntry) => void
    recordStrict: (entry: AuditEntry) => void
  }
}

export interface McpToolDef {
  name: string
  description: string
  domain: 'task' | 'habit' | 'learning' | 'note'
  write?: boolean
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

/** 供 Codex app-server 识别可免二次审批的只读工具。 */
export function isReadOnlyMcpTool(name: string): boolean {
  return MCP_TOOLS.some((tool) => tool.name === name && tool.write !== true)
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

const MAX_TOOL_ID = 120
const MAX_TOOL_TITLE = 500
const MAX_TOOL_TEXT = 20_000
const MAX_TOOL_LABEL = 80
const TOOL_TIME = /^([01]?\d|2[0-3]):[0-5]\d$/

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label}无效`)
  const text = value.trim()
  if (!text) throw new TypeError(`${label}不能为空`)
  if (text.length > max) throw new TypeError(`${label}过长`)
  return text
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new TypeError(`${label}无效`)
  if (value.length > max) throw new TypeError(`${label}过长`)
  return value
}

function toolId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label}无效`)
  const id = value.trim()
  if (!id || id.length > MAX_TOOL_ID) throw new TypeError(`${label}无效`)
  return id
}

function optionalDateKey(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (!isDateKey(value)) throw new TypeError(`${label}无效`)
  return value
}

function optionalTime(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !TOOL_TIME.test(value)) throw new TypeError('任务时间无效')
  return value
}

function optionalPriority(value: unknown): TaskPriority | undefined {
  if (value === undefined || value === null) return undefined
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    throw new TypeError('任务优先级无效')
  }
  return value
}

function optionalEstimate(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 480) {
    throw new TypeError('预计时长无效')
  }
  return value
}

function taskDraftFrom(args: Record<string, unknown>): TaskDraft {
  const draft: TaskDraft = { title: requiredText(args.title, '任务标题', MAX_TOOL_TITLE) }
  const notes = optionalText(args.notes, '任务备注', MAX_TOOL_TEXT)
  const dueDate = optionalDateKey(args.dueDate, '任务日期')
  const plannedFor = optionalDateKey(args.plannedFor, '计划日期')
  const time = optionalTime(args.time)
  const priority = optionalPriority(args.priority)
  const list = optionalText(args.list, '任务清单', MAX_TOOL_LABEL)
  const estimate = optionalEstimate(args.estimateMinutes)
  if (notes !== undefined) draft.notes = notes
  if (dueDate) draft.dueDate = dueDate
  if (plannedFor) draft.plannedFor = plannedFor
  if (time) draft.time = time
  if (priority !== undefined) draft.priority = priority
  if (list) draft.list = list
  if (estimate !== undefined) draft.estimateMinutes = estimate
  return draft
}

function taskPatchFrom(raw: unknown): TaskPatch {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('patch 必须是对象')
  const patch = raw as Record<string, unknown>
  const result: TaskPatch = {}
  if (patch.title !== undefined)
    result.title = requiredText(patch.title, '任务标题', MAX_TOOL_TITLE)
  if (patch.notes !== undefined) {
    result.notes = optionalText(patch.notes, '任务备注', MAX_TOOL_TEXT) ?? ''
  }
  if (patch.dueDate !== undefined) {
    result.dueDate =
      patch.dueDate === null ? null : (optionalDateKey(patch.dueDate, '任务日期') ?? null)
  }
  if (patch.plannedFor !== undefined) {
    result.plannedFor =
      patch.plannedFor === null ? null : (optionalDateKey(patch.plannedFor, '计划日期') ?? null)
  }
  if (patch.priority !== undefined) {
    const priority = optionalPriority(patch.priority)
    if (priority !== undefined) result.priority = priority
  }
  if (patch.list !== undefined) {
    if (patch.list === null) result.list = null
    else result.list = optionalText(patch.list, '任务清单', MAX_TOOL_LABEL) ?? null
  }
  if (patch.estimateMinutes !== undefined) {
    const estimate = optionalEstimate(patch.estimateMinutes)
    if (estimate !== undefined) result.estimateMinutes = estimate
  }
  if (patch.time !== undefined) {
    const time = optionalTime(patch.time)
    if (time) result.time = time
  }
  if (Object.keys(result).length === 0) throw new TypeError('patch 没有可更新字段')
  return result
}

function tasksCreate(args: Record<string, unknown>, data: McpData): McpToolResult {
  try {
    const task = data.tasks.create(taskDraftFrom(args))
    return ok({ ok: true, task: taskView(task) })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '创建任务失败')
  }
}

function tasksUpdate(args: Record<string, unknown>, data: McpData): McpToolResult {
  try {
    const id = toolId(args.id, '任务 id')
    const patch = taskPatchFrom(args.patch)
    data.tasks.update(id, patch)
    const task = data.tasks.find(id)
    if (!task) return fail('任务不存在')
    return ok({ ok: true, task: taskView(task) })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '更新任务失败')
  }
}

function tasksComplete(args: Record<string, unknown>, data: McpData): McpToolResult {
  try {
    const id = toolId(args.id, '任务 id')
    if (!data.tasks.find(id)) return fail('任务不存在')
    const next = data.tasks.completeTask(id)
    const task = data.tasks.find(id)
    return ok({
      ok: true,
      task: task ? taskView(task) : { id },
      next: next ? taskView(next) : null
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '完成任务失败')
  }
}

function habitsCheck(args: Record<string, unknown>, data: McpData, today: string): McpToolResult {
  try {
    const habitId = toolId(args.habitId ?? args.habit_id, '习惯 id')
    const habit = data.habits.list().find((item) => item.id === habitId)
    if (!habit) return fail('习惯不存在')
    const day = optionalDateKey(args.date, '打卡日期') ?? today
    if (day > today) return fail('不能修改未来日期的打卡')
    const done = args.done === undefined ? true : args.done
    if (typeof done !== 'boolean') return fail('done 必须是布尔值')
    data.habits.setCheckin(habitId, day, done)
    return ok({ ok: true, habitId, day, done })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '打卡失败')
  }
}

function learningReview(
  args: Record<string, unknown>,
  data: McpData,
  today: string
): McpToolResult {
  try {
    const id = toolId(args.itemId ?? args.item_id, '学习卡 id')
    const rating = args.rating
    if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
      return fail('rating 只支持 1–4')
    }
    const card = data.learning.review(id, rating as LearningRating, today)
    return ok({
      ok: true,
      id: card.id,
      nextReviewOn: card.nextReviewOn,
      intervalDays: card.intervalDays
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '复习评分失败')
  }
}

function notesCreate(args: Record<string, unknown>, data: McpData): McpToolResult {
  try {
    const title = requiredText(args.title, '笔记标题', MAX_TOOL_TITLE)
    const body = optionalText(args.body, '笔记正文', MAX_TOOL_TEXT)
    const tag = optionalText(args.tag, '笔记标签', MAX_TOOL_LABEL)
    const text = body ? `${title}\n\n${body}` : title
    const note = data.notes.create(text, tag)
    return ok({
      ok: true,
      note: {
        id: note.id,
        time: note.time,
        ...(note.tag ? { tag: note.tag } : {})
      }
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '创建笔记失败')
  }
}

const IDEMPOTENCY_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: 120,
  description: '同一会话内重复调用返回首次结果，避免重试重复写入'
} as const

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'tasks_list',
    description:
      '读取 WorkStationForOne 本地任务（只读）。可按今天、逾期、即将到来、全部或已完成筛选；默认只返回今天到期或计划今天的任务。',
    domain: 'task',
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
    domain: 'note',
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
    domain: 'learning',
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
    domain: 'habit',
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
    domain: 'task',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'tasks_create',
    description:
      '在 WorkStationForOne 创建任务（写，受任务域权限约束）。日期用本地 YYYY-MM-DD，时间用 HH:MM。',
    domain: 'task',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_TOOL_TITLE },
        notes: { type: 'string', maxLength: MAX_TOOL_TEXT },
        dueDate: { type: 'string' },
        plannedFor: { type: 'string' },
        time: { type: 'string' },
        priority: { type: 'integer', minimum: 0, maximum: 3 },
        list: { type: 'string', maxLength: MAX_TOOL_LABEL },
        estimateMinutes: { type: 'integer', minimum: 0, maximum: 480 },
        idempotency_key: IDEMPOTENCY_SCHEMA
      },
      required: ['title', 'idempotency_key'],
      additionalProperties: false
    }
  },
  {
    name: 'tasks_update',
    description: '更新 WorkStationForOne 任务（写，受任务域权限约束）。patch 只接受任务字段。',
    domain: 'task',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', maxLength: MAX_TOOL_ID },
        patch: { type: 'object', additionalProperties: true },
        idempotency_key: IDEMPOTENCY_SCHEMA
      },
      required: ['id', 'patch', 'idempotency_key'],
      additionalProperties: false
    }
  },
  {
    name: 'tasks_complete',
    description: '完成任务（写，受任务域权限约束）；重复任务会在同一事务里生成下一实例。',
    domain: 'task',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', maxLength: MAX_TOOL_ID },
        idempotency_key: IDEMPOTENCY_SCHEMA
      },
      required: ['id', 'idempotency_key'],
      additionalProperties: false
    }
  },
  {
    name: 'habits_check',
    description: '给习惯打卡或取消打卡（写，受习惯域权限约束）；默认今天。',
    domain: 'habit',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        habitId: { type: 'string', maxLength: MAX_TOOL_ID },
        date: { type: 'string' },
        done: { type: 'boolean' },
        idempotency_key: IDEMPOTENCY_SCHEMA
      },
      required: ['habitId', 'idempotency_key'],
      additionalProperties: false
    }
  },
  {
    name: 'learning_review',
    description:
      '提交学习卡评分（写，受学习域权限约束）。rating：1 重来 / 2 困难 / 3 良好 / 4 简单。',
    domain: 'learning',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string', maxLength: MAX_TOOL_ID },
        rating: { type: 'integer', enum: [1, 2, 3, 4] },
        idempotency_key: IDEMPOTENCY_SCHEMA
      },
      required: ['itemId', 'rating', 'idempotency_key'],
      additionalProperties: false
    }
  },
  {
    name: 'notes_create',
    description: '新建笔记（写，受笔记域权限约束）。title 作为首行，body 可选。',
    domain: 'note',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_TOOL_TITLE },
        body: { type: 'string', maxLength: MAX_TOOL_TEXT },
        tag: { type: 'string', maxLength: MAX_TOOL_LABEL },
        idempotency_key: IDEMPOTENCY_SCHEMA
      },
      required: ['title', 'idempotency_key'],
      additionalProperties: false
    }
  }
]

export interface McpToolContext {
  sessionId: string
  today?: string
  /** 写入工具在审计里记为 write；只读工具为 read */
  write?: boolean
}

/**
 * MCP 工具执行入口。每次调用先留审计，再读写库；
 * 审计失败不会阻断业务操作，token 也不进入审计。
 */
export function runMcpTool(
  name: string,
  rawArgs: unknown,
  data: McpData,
  context: McpToolContext
): McpToolResult {
  const args = asRecord(rawArgs)
  const today = context.today ?? dateKey()
  // 写入审计由 server 放进业务事务里（recordStrict），这里只审计读取。
  if (!context.write) {
    data.audit.record({
      at: Date.now(),
      domain: 'mcp',
      action: 'read',
      targetId: context.sessionId,
      title: name,
      source: 'agent',
      detail: clip(JSON.stringify(args), 500)
    })
  }

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
    case 'tasks_create':
      return tasksCreate(args, data)
    case 'tasks_update':
      return tasksUpdate(args, data)
    case 'tasks_complete':
      return tasksComplete(args, data)
    case 'habits_check':
      return habitsCheck(args, data, today)
    case 'learning_review':
      return learningReview(args, data, today)
    case 'notes_create':
      return notesCreate(args, data)
    default:
      return fail(`未知工具：${name}`)
  }
}
