import { create } from 'zustand'
import type {
  AgentCreateInput,
  AgentForkResult,
  AgentImageRef,
  AgentImportResult,
  AgentMessageRecord,
  AgentSessionPatch,
  AgentSessionRecord,
  AgentToolRecord,
  LearningDraft,
  LearningItemRecord,
  LearningPatch,
  LearningRating,
  McpPermissionRequest,
  NotePatch,
  TaskDraft,
  TaskPatch
} from '../../../shared/ipc'
import {
  appendStreamText,
  type AgentPermissionRequest,
  type AgentQuestionRequest
} from '../../../shared/agent-stream'
import { clozeFrontText } from '../../../shared/cloze'
import { createInitialData } from '../data/mock'
import { dateKey } from '../../../shared/date-key'
import { agentSessionDate, agentSessionMeta, sessionFromRecord } from '../lib/agent'
import { dailyNoteTitle, findDailyNote } from '../lib/daily-note'
import { toChatMessage } from '../lib/chat-message'
import { toggleCheckin } from '../lib/habits'
import { dueQueue, isNewCard } from '../lib/learning'
import { normalizeNewPerDay, persistNewPerDay, readStoredNewPerDay } from '../lib/learning-limit'
import { scheduleReview } from '../../../shared/srs'
import {
  browserStorage,
  otherSkin,
  otherTheme,
  persistSkin,
  persistTheme,
  readStoredSkin,
  readStoredTheme
} from '../lib/theme'
import { ERROR_DETAIL_SEPARATOR, friendlyMessage, redactErrorDetail } from '../lib/errors'
import type {
  AgentId,
  ChatMessage,
  FocusSession,
  Habit,
  LearningItem,
  LearningScope,
  Note,
  NoteJump,
  ResolutionRecord,
  Session,
  Task,
  TaskFilter,
  TaskScope,
  ToolCall,
  View,
  WorkstationData
} from '../types'

interface TaskPersistence {
  setDone: (id: string, done: boolean) => Promise<Task | null>
  applySchedule: (
    changes: {
      taskId: string
      toTime: string
      toTag: string
      toDueDate?: string | null
    }[]
  ) => Promise<void>
  create: (draft: TaskDraft) => Promise<Task>
  update: (id: string, patch: TaskPatch) => Promise<void>
  remove: (id: string) => Promise<void>
  restore: (id: string) => Promise<void>
  renameList: (from: string, to: string) => Promise<void>
}

interface NotePersistence {
  create: (text: string, tag?: string) => Promise<Note>
  search?: (query: string, limit: number, tag?: string) => Promise<Note[]>
  togglePin?: (id: string) => Promise<void>
  update?: (id: string, patch: NotePatch) => Promise<Note | undefined>
  remove?: (id: string) => Promise<boolean>
}

interface LearningPersistence {
  create: (draft: LearningDraft) => Promise<LearningItemRecord>
  update: (id: string, patch: LearningPatch) => Promise<void>
  remove?: (id: string) => Promise<boolean>
  review: (id: string, rating: LearningRating) => Promise<LearningItemRecord>
}

export interface AgentPersistence {
  createSession: (input: AgentCreateInput) => Promise<AgentSessionRecord>
  updateSession: (id: string, patch: AgentSessionPatch) => Promise<void>
  saveMessage: (message: AgentMessageRecord) => Promise<void>
}

export interface ReminderPersistence {
  mute: (taskId: string, day: string) => Promise<void>
  unmute: (taskId: string, day: string) => Promise<void>
  unmuteDay: (day: string) => Promise<void>
}

let persistence: TaskPersistence | null = null
interface HabitPersistence {
  setCheckin: (id: string, day: string, done: boolean) => Promise<void>
  create?: (name: string) => Promise<Habit>
  rename?: (id: string, name: string) => Promise<boolean>
  remove?: (id: string) => Promise<boolean>
}
let habitPersistence: HabitPersistence | null = null
let notePersistence: NotePersistence | null = null
let learningPersistence: LearningPersistence | null = null
let agentPersistence: AgentPersistence | null = null
let reminderPersistence: ReminderPersistence | null = null

export const ACTIVE_AGENT_KEY = 'workstation.agentActive'

export function bindHabitPersistence(next: HabitPersistence | null): void {
  habitPersistence = next
}

export function bindTaskPersistence(next: TaskPersistence | null): void {
  persistence = next
}

export function bindNotePersistence(next: NotePersistence | null): void {
  notePersistence = next
}

export function bindLearningPersistence(next: LearningPersistence | null): void {
  learningPersistence = next
}

export function bindAgentPersistence(next: AgentPersistence | null): void {
  agentPersistence = next
}

export function bindReminderPersistence(next: ReminderPersistence | null): void {
  reminderPersistence = next
}

function reportPersistenceError(error: unknown): void {
  console.error('[persistence] 写入失败', error)
  useWorkstation.setState({ persistenceError: '写入本地数据库失败，这次改动可能没有保存' })
}

function persistQuietly(run: () => Promise<void>): void {
  void run().catch(reportPersistenceError)
}

interface WorkstationActions {
  setView: (view: View) => void
  setFilter: (filter: TaskFilter) => void
  setTaskScope: (scope: TaskScope) => void
  openTask: (taskId: string) => void
  clearTaskJump: () => void
  openNote: (note: NoteJump) => void
  clearNoteJump: () => void
  openLearningItem: (id: string) => void
  clearLearningJump: () => void
  toggleTask: (taskId: string) => void
  addTask: (draft: TaskDraft) => void
  addSubtask: (parentId: string, title: string) => void
  updateTask: (taskId: string, patch: TaskPatch) => void
  removeTask: (taskId: string) => void
  renameTaskList: (from: string, to: string) => void
  setReminderMutes: (day: string, taskIds: string[]) => void
  muteReminder: (taskId: string, day: string) => void
  unmuteReminder: (taskId: string, day: string) => void
  clearReminderMutes: (day: string) => void
  undoRemoveTask: () => void
  composeTask: () => void
  composeAgent: (text: string) => void
  consumeAgentDraft: () => void
  clearLastAddedTask: () => void
  toggleHabitToday: (habitId: string) => void
  toggleHabitDay: (habitId: string, day: string) => void
  addHabit: (name: string) => void
  renameHabit: (habitId: string, name: string) => void
  removeHabit: (habitId: string) => void
  setActiveSession: (sessionId: string) => void
  openAgentSession: (sessionId: string) => void
  openAgentMessage: (sessionId: string, messageId: string | null) => void
  focusAgentAttention: (sessionId: string, requestId: string) => void
  clearAgentAttention: () => void
  clearAgentJump: () => void
  setAgentThread: (sessionId: string, messages: ChatMessage[]) => void
  createAgentSession: (agent?: AgentId, persona?: string) => void
  /** 主进程新建的会话（团队）补进内存，避免要刷新才能看到 */
  addAgentSessions: (records: AgentSessionRecord[]) => void
  setAgentResume: (sessionId: string, resumeId: string) => void
  renameAgentSession: (sessionId: string, title: string) => void
  toggleAgentSessionPin: (sessionId: string) => void
  toggleAgentSessionArchive: (sessionId: string) => void
  toggleAgentPlanMode: (sessionId: string) => void
  removeAgentSession: (sessionId: string) => void
  setAgentWorkspace: (sessionId: string, workspace: string) => void
  importAgentSession: (result: AgentImportResult) => void
  addForkedSession: (result: AgentForkResult) => void
  setToolPermission: (sessionId: string, request: AgentPermissionRequest) => void
  clearToolPermission: (sessionId: string) => void
  setMcpPermission: (request: McpPermissionRequest) => void
  clearMcpPermission: (sessionId: string) => void
  setAgentQuestion: (sessionId: string, request: AgentQuestionRequest) => void
  clearAgentQuestion: (sessionId: string) => void
  sendMessage: (text: string, contextFiles?: string[], images?: AgentImageRef[]) => void
  retryMessage: (text: string, contextFiles?: string[], images?: AgentImageRef[]) => void
  takePendingPrompt: (sessionId?: string) => {
    sessionId: string
    prompt: string
    contextFiles?: string[]
    images?: AgentImageRef[]
  } | null
  beginAgentReply: (sessionId: string, runId: string | null) => void
  bindAgentRun: (sessionId: string, runId: string) => void
  setAgentTurnId: (sessionId: string, turnId: string) => void
  /** init 事件带回的真实模型名，写进当前助手消息并随消息落库 */
  setAgentRunModel: (sessionId: string, model: string) => void
  appendAgentText: (sessionId: string, chunk: string) => void
  upsertAgentTool: (sessionId: string, tool: ToolCall, status: string) => void
  setAgentToolStatus: (sessionId: string, toolId: string, status: string) => void
  finishAgentReply: (sessionId: string, error?: string) => void
  receiveReply: (text: string, tools?: ToolCall[]) => void
  resolvePermission: (decision: 'allow' | 'deny') => void
  toggleMotion: () => void
  toggleTheme: () => void
  toggleSkin: () => void
  startFocus: (label: string, minutes: number) => void
  closeFocus: () => void
  openQuickNote: () => void
  closeQuickNote: () => void
  addNote: (text: string, tag?: string) => void
  openDailyNote: () => void
  toggleNotePin: (noteId: string) => void
  updateNote: (noteId: string, patch: NotePatch) => void
  removeNote: (noteId: string) => void
  openNotesView: () => void
  setLearningScope: (scope: LearningScope) => void
  setLearningNewPerDay: (value: number) => void
  refreshLearningNewIntroduced: () => void
  addLearningItem: (draft: LearningDraft) => void
  updateLearningItem: (itemId: string, patch: LearningPatch) => void
  removeLearningItem: (itemId: string) => void
  reviewLearningItem: (itemId: string, rating: LearningRating) => void
  startLearningReview: () => void
  exitLearningReview: () => void
  clearPersistenceError: () => void
}

export type WorkstationState = WorkstationData & WorkstationActions

let messageSeq = 0
let taskSeq = 0
let learningSeq = 0
let habitSeq = 0

function nextMessageId(prefix: string): string {
  messageSeq += 1
  return `${prefix}-${Date.now()}-${messageSeq}`
}

function nextTaskId(): string {
  taskSeq += 1
  return `todo-${Date.now()}-${taskSeq}`
}

function nextLearningId(): string {
  learningSeq += 1
  return `learn-${Date.now()}-${learningSeq}`
}

function nextHabitId(): string {
  habitSeq += 1
  return `habit-${Date.now()}-${habitSeq}`
}

function messageTimeLabel(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function withAgentMeta(session: Session, messageCount: number, now = Date.now()): Session {
  return {
    ...session,
    meta: agentSessionMeta(now, messageCount, now),
    threadDate: agentSessionDate(now, now)
  }
}

function agentTools(tools?: ToolCall[]): AgentToolRecord[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((tool) => ({
    ...(tool.id ? { id: tool.id } : {}),
    name: tool.name,
    meta: tool.meta,
    status: tool.status,
    ...(tool.diffs?.length ? { diffs: tool.diffs } : {})
  }))
}

function persistAgentSession(sessionId: string, patch: AgentSessionPatch): void {
  const persistence = agentPersistence
  if (!persistence) return
  persistQuietly(() => persistence.updateSession(sessionId, patch))
}

function persistAgentMessage(sessionId: string, message: ChatMessage): void {
  const persistence = agentPersistence
  if (!persistence) return
  const record: AgentMessageRecord = {
    id: message.id,
    sessionId,
    role: message.role,
    text: message.text,
    timeLabel: message.time,
    createdAt: Date.now()
  }
  if (message.error) record.error = true
  if (message.turnId) record.turnId = message.turnId
  if (message.runId) record.runId = message.runId
  if (message.model) record.model = message.model
  if (message.contextFiles?.length) record.contextFiles = message.contextFiles
  if (message.images?.length) record.images = message.images
  const tools = agentTools(message.tools)
  if (tools) record.tools = tools
  persistQuietly(() => persistence.saveMessage(record))
}

export const useWorkstation = create<WorkstationState>()((set, get) => ({
  ...createInitialData(),
  theme: readStoredTheme(browserStorage()),
  skin: readStoredSkin(browserStorage()),
  learningNewPerDay: readStoredNewPerDay(browserStorage()),
  learningNewIntroduced: 0,
  setView: (activeView) => set({ activeView }),

  setFilter: (taskFilter) => set({ taskFilter }),

  setTaskScope: (taskScope) => set({ taskScope }),

  openTask: (taskId) => {
    if (!get().tasks.some((task) => task.id === taskId)) return
    set({
      activeView: 'tasks',
      taskFilter: 'all',
      taskScope: 'all',
      taskJumpId: taskId
    })
  },

  clearTaskJump: () => set({ taskJumpId: null }),

  openNote: (note) => set({ activeView: 'notes', noteJump: note }),

  clearNoteJump: () => set({ noteJump: null }),

  openLearningItem: (id) => {
    if (!get().learningItems.some((item) => item.id === id)) return
    set({
      activeView: 'learning',
      learningReviewOpen: false,
      learningScope: { kind: 'all' },
      learningJumpId: id
    })
  },

  clearLearningJump: () => set({ learningJumpId: null }),

  composeTask: () =>
    set((state) => ({ activeView: 'tasks', taskComposerRequest: state.taskComposerRequest + 1 })),

  /** 任务 / 笔记交给 Agent：没有可用会话时新建 Claude 会话；提示词只预填，不自动发送。 */
  composeAgent: (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const current = selectActiveSession(get())
    if (!current || current.archived) get().createAgentSession('claude')
    const target = selectActiveSession(get())
    set((state) => ({
      activeView: 'agent',
      agentDraftText: trimmed,
      agentDraftSessionId: target?.id ?? null,
      agentDraftRequest: state.agentDraftRequest + 1
    }))
  },

  /** 用户编辑或发送后才清空草稿；只选工作区导致 Composer 重挂载时要能重新填上。 */
  consumeAgentDraft: () => {
    if (!get().agentDraftText && !get().agentDraftSessionId) return
    set({ agentDraftText: '', agentDraftSessionId: null })
  },

  clearLastAddedTask: () => set({ lastAddedTaskId: null }),

  toggleTask: (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId)
    if (!task) return
    const done = !task.done
    set((state) => ({
      tasks: state.tasks.map((item) =>
        item.id === taskId ? { ...item, done, completedAt: done ? Date.now() : undefined } : item
      )
    }))
    if (!persistence) return
    void persistence
      .setDone(taskId, done)
      .then((next) => {
        // 重复任务完成时会带回下一条，直接并进列表，省掉一次全量刷新
        if (next) set((state) => ({ tasks: [...state.tasks, next] }))
      })
      .catch(reportPersistenceError)
  },

  addTask: (draft) => {
    const title = draft.title.trim()
    if (!title) return
    const local: Task = {
      id: nextTaskId(),
      title,
      time: draft.time ?? '—',
      done: false,
      notes: draft.notes ?? '',
      priority: draft.priority ?? 0,
      ...(draft.tag ? { tag: draft.tag } : {}),
      ...(draft.tone ? { tone: draft.tone } : {}),
      ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
      ...(draft.list ? { list: draft.list } : {}),
      ...(draft.plannedFor ? { plannedFor: draft.plannedFor } : {}),
      ...(draft.estimateMinutes ? { estimateMinutes: draft.estimateMinutes } : {})
    }
    set((state) => ({ tasks: [local, ...state.tasks], lastAddedTaskId: local.id }))

    if (!persistence) return
    void persistence
      .create({ ...draft, title })
      .then((saved) => {
        set((state) => ({
          tasks: state.tasks.map((task) => (task.id === local.id ? saved : task)),
          lastAddedTaskId: state.lastAddedTaskId === local.id ? saved.id : state.lastAddedTaskId
        }))
      })
      .catch((error) => {
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== local.id),
          lastAddedTaskId: state.lastAddedTaskId === local.id ? null : state.lastAddedTaskId
        }))
        reportPersistenceError(error)
      })
  },

  updateTask: (taskId, patch) => {
    const next: TaskPatch = { ...patch }
    if (next.title !== undefined) {
      const title = next.title.trim()
      if (!title) return
      next.title = title
    }
    if (Object.keys(next).length === 0) return

    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) return task
        const updated: Task = { ...task }
        if (next.title !== undefined) updated.title = next.title
        if (next.time !== undefined) updated.time = next.time
        if (next.notes !== undefined) updated.notes = next.notes
        if (next.priority !== undefined) updated.priority = next.priority
        if (next.tag === null) delete updated.tag
        else if (next.tag !== undefined) updated.tag = next.tag
        if (next.tone === null) delete updated.tone
        else if (next.tone !== undefined) updated.tone = next.tone
        if (next.dueDate === null) delete updated.dueDate
        else if (next.dueDate !== undefined) updated.dueDate = next.dueDate
        if (next.list === null) delete updated.list
        else if (next.list !== undefined) updated.list = next.list
        if (next.plannedFor === null) delete updated.plannedFor
        else if (next.plannedFor !== undefined) updated.plannedFor = next.plannedFor
        if (next.estimateMinutes !== undefined) updated.estimateMinutes = next.estimateMinutes
        if (next.repeat === null) delete updated.repeat
        else if (next.repeat !== undefined) updated.repeat = next.repeat
        return updated
      })
    }))
    persistQuietly(() => persistence?.update(taskId, next) ?? Promise.resolve())
  },

  addSubtask: (parentId, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const local: Task = {
      id: nextTaskId(),
      title: trimmed,
      time: '—',
      done: false,
      notes: '',
      priority: 0,
      parentId
    }
    set((state) => ({ tasks: [...state.tasks, local] }))
    if (!persistence) return
    void persistence
      .create({ title: trimmed, parentId })
      .then((saved) =>
        set((state) => ({
          tasks: state.tasks.map((task) => (task.id === local.id ? saved : task))
        }))
      )
      .catch(reportPersistenceError)
  },

  renameTaskList: (from, to) => {
    const next = to.trim()
    if (!next || next === from) return
    set((state) => ({
      tasks: state.tasks.map((task) => (task.list === from ? { ...task, list: next } : task)),
      // 正停在这个清单上时跟着切过去，否则右侧会突然空掉
      taskScope: state.taskScope === `list:${from}` ? (`list:${next}` as const) : state.taskScope
    }))
    persistQuietly(() => persistence?.renameList(from, next) ?? Promise.resolve())
  },

  setReminderMutes: (day, taskIds) => {
    set({ reminderMutes: { day, taskIds: [...new Set(taskIds)] } })
  },

  muteReminder: (taskId, day) => {
    set((state) => {
      const current = state.reminderMutes.day === day ? state.reminderMutes.taskIds : []
      if (current.includes(taskId)) return { reminderMutes: { day, taskIds: current } }
      return { reminderMutes: { day, taskIds: [...current, taskId] } }
    })
    persistQuietly(() => reminderPersistence?.mute(taskId, day) ?? Promise.resolve())
  },

  unmuteReminder: (taskId, day) => {
    set((state) => {
      if (state.reminderMutes.day !== day) return {}
      return {
        reminderMutes: {
          day,
          taskIds: state.reminderMutes.taskIds.filter((id) => id !== taskId)
        }
      }
    })
    persistQuietly(() => reminderPersistence?.unmute(taskId, day) ?? Promise.resolve())
  },

  clearReminderMutes: (day) => {
    set({ reminderMutes: { day, taskIds: [] } })
    persistQuietly(() => reminderPersistence?.unmuteDay(day) ?? Promise.resolve())
  },

  removeTask: (taskId) => {
    // 记住被删任务及其位置，撤销时原位放回。
    const state = get()
    const index = state.tasks.findIndex((task) => task.id === taskId)
    const task = index >= 0 ? state.tasks[index] : undefined
    set((current) => ({
      tasks: current.tasks.filter((item) => item.id !== taskId),
      lastAddedTaskId: current.lastAddedTaskId === taskId ? null : current.lastAddedTaskId,
      lastRemovedTask: task ? { task, index } : null
    }))
    persistQuietly(() => persistence?.remove(taskId) ?? Promise.resolve())
  },

  undoRemoveTask: () => {
    const removed = get().lastRemovedTask
    if (!removed) return
    const { task, index } = removed
    set((state) => {
      if (state.tasks.some((item) => item.id === task.id)) return { lastRemovedTask: null }
      const tasks = [...state.tasks]
      tasks.splice(Math.min(Math.max(index, 0), tasks.length), 0, task)
      return { tasks, lastRemovedTask: null }
    })
    persistQuietly(() => persistence?.restore(task.id) ?? Promise.resolve())
  },

  toggleHabitToday: (habitId) => {
    get().toggleHabitDay(habitId, dateKey())
  },

  toggleHabitDay: (habitId, day) => {
    const today = dateKey()
    if (day > today) return
    const current = get().habits.find((habit) => habit.id === habitId)
    if (!current) return
    const next = toggleCheckin(current, day, today)
    const checked = !current.checkins.includes(day)
    set((state) => ({
      habits: state.habits.map((habit) => (habit.id === habitId ? next : habit))
    }))
    persistQuietly(() => habitPersistence?.setCheckin(habitId, day, checked) ?? Promise.resolve())
  },

  addHabit: (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const local: Habit = { id: nextHabitId(), name: trimmed, checkins: [] }
    set((state) => ({ habits: [...state.habits, local] }))
    const create = habitPersistence?.create
    if (!create) return
    void create(trimmed)
      .then((saved) => {
        set((state) => ({
          habits: state.habits.map((habit) =>
            habit.id === local.id ? { ...saved, checkins: habit.checkins } : habit
          )
        }))
      })
      .catch((error) => {
        set((state) => ({ habits: state.habits.filter((habit) => habit.id !== local.id) }))
        reportPersistenceError(error)
      })
  },

  renameHabit: (habitId, name) => {
    const trimmed = name.trim()
    const current = get().habits.find((habit) => habit.id === habitId)
    if (!current || !trimmed || trimmed === current.name) return
    set((state) => ({
      habits: state.habits.map((habit) =>
        habit.id === habitId ? { ...habit, name: trimmed } : habit
      )
    }))
    const rename = habitPersistence?.rename
    if (!rename) return
    const restore = () =>
      set((state) => ({
        habits: state.habits.map((habit) =>
          habit.id === habitId ? { ...habit, name: current.name } : habit
        )
      }))
    void rename(habitId, trimmed)
      .then((ok) => {
        if (!ok) restore()
      })
      .catch((error) => {
        restore()
        reportPersistenceError(error)
      })
  },

  removeHabit: (habitId) => {
    const index = get().habits.findIndex((habit) => habit.id === habitId)
    if (index < 0) return
    const removed = get().habits[index]
    set((state) => ({ habits: state.habits.filter((habit) => habit.id !== habitId) }))
    const remove = habitPersistence?.remove
    if (!remove) return
    const restore = () =>
      set((state) => {
        const habits = [...state.habits]
        habits.splice(Math.min(index, habits.length), 0, removed)
        return { habits }
      })
    void remove(habitId)
      .then((ok) => {
        if (!ok) restore()
      })
      .catch((error) => {
        restore()
        reportPersistenceError(error)
      })
  },

  setActiveSession: (sessionId) => {
    const exists = get().sessions.some((session) => session.id === sessionId)
    if (!exists) return
    set({ activeSessionId: sessionId })
    browserStorage()?.setItem(ACTIVE_AGENT_KEY, sessionId)
  },

  openAgentSession: (sessionId) => {
    const exists = get().sessions.some((session) => session.id === sessionId)
    if (!exists) return
    set({ activeSessionId: sessionId, activeView: 'agent' })
    browserStorage()?.setItem(ACTIVE_AGENT_KEY, sessionId)
  },

  openAgentMessage: (sessionId, messageId) => {
    const exists = get().sessions.some((session) => session.id === sessionId)
    if (!exists) return
    set({ activeSessionId: sessionId, activeView: 'agent', agentJumpMessageId: messageId })
    browserStorage()?.setItem(ACTIVE_AGENT_KEY, sessionId)
  },

  focusAgentAttention: (sessionId, requestId) => {
    const exists = get().sessions.some((session) => session.id === sessionId)
    if (!exists) return
    set({
      activeSessionId: sessionId,
      activeView: 'agent',
      agentJumpMessageId: null,
      agentAttentionRequestId: requestId
    })
    browserStorage()?.setItem(ACTIVE_AGENT_KEY, sessionId)
  },

  clearAgentAttention: () => set({ agentAttentionRequestId: null }),

  clearAgentJump: () => set({ agentJumpMessageId: null }),

  setAgentThread: (sessionId, messages) => {
    set((state) => ({
      threads: { ...state.threads, [sessionId]: messages },
      threadsLoaded: { ...state.threadsLoaded, [sessionId]: true }
    }))
  },

  createAgentSession: (agent = 'claude', persona?: string) => {
    const now = Date.now()
    const id = `s-${crypto.randomUUID()}`
    const session: Session = {
      id,
      agent,
      title: '新会话',
      meta: agentSessionMeta(now, 0, now),
      status: 'idle',
      threadDate: '今天',
      ...(persona ? { persona } : {})
    }
    set((state) => ({
      sessions: [session, ...state.sessions],
      threads: { ...state.threads, [id]: [] },
      threadsLoaded: { ...state.threadsLoaded, [id]: true },
      activeSessionId: id,
      activeView: 'agent',
      permission: null,
      resolution: null
    }))
    browserStorage()?.setItem(ACTIVE_AGENT_KEY, id)
    const persistence = agentPersistence
    if (!persistence) return
    persistQuietly(async () => {
      await persistence.createSession({
        id,
        agent,
        title: '新会话',
        ...(persona ? { persona } : {})
      })
    })
  },

  addAgentSessions: (records) => {
    if (records.length === 0) return
    const now = Date.now()
    set((state) => {
      const existing = new Set(state.sessions.map((session) => session.id))
      const added = records
        .filter((record) => !existing.has(record.id))
        .map((record) => sessionFromRecord(record, 0, now))
      if (added.length === 0) return {}
      return { sessions: [...added, ...state.sessions] }
    })
  },

  renameAgentSession: (sessionId, title) => {
    const trimmed = title.trim().slice(0, 80)
    const session = get().sessions.find((item) => item.id === sessionId)
    if (!session || !trimmed || trimmed === session.title) return
    set((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === sessionId ? { ...item, title: trimmed } : item
      )
    }))
    persistAgentSession(sessionId, { title: trimmed })
  },

  toggleAgentSessionPin: (sessionId) => {
    const session = get().sessions.find((item) => item.id === sessionId)
    if (!session) return
    const pinned = !session.pinned
    set((state) => ({
      sessions: state.sessions.map((item) => {
        if (item.id !== sessionId) return item
        const next = { ...item }
        if (pinned) next.pinned = true
        else delete next.pinned
        return next
      })
    }))
    persistAgentSession(sessionId, { pinned })
  },

  toggleAgentSessionArchive: (sessionId) => {
    const state = get()
    const session = state.sessions.find((item) => item.id === sessionId)
    if (!session) return
    const archived = !session.archived
    if (
      archived &&
      (state.streams[sessionId] ||
        state.pendingPrompts.some((prompt) => prompt.sessionId === sessionId))
    ) {
      return
    }
    let activeSessionId = state.activeSessionId
    if (archived && activeSessionId === sessionId) {
      const next = state.sessions.find((item) => item.id !== sessionId && !item.archived)
      activeSessionId = next?.id ?? ''
      const storage = browserStorage()
      if (activeSessionId) storage?.setItem(ACTIVE_AGENT_KEY, activeSessionId)
      else storage?.removeItem(ACTIVE_AGENT_KEY)
    }
    const toolPermissions = { ...state.toolPermissions }
    const toolPermissionQueues = { ...state.toolPermissionQueues }
    const mcpPermissions = { ...state.mcpPermissions }
    const agentQuestions = { ...state.agentQuestions }
    if (archived) {
      delete toolPermissions[sessionId]
      delete toolPermissionQueues[sessionId]
      delete mcpPermissions[sessionId]
      delete agentQuestions[sessionId]
    }
    set({
      sessions: state.sessions.map((item) => {
        if (item.id !== sessionId) return item
        const next = { ...item }
        if (archived) next.archived = true
        else delete next.archived
        return next
      }),
      activeSessionId,
      toolPermissions,
      toolPermissionQueues,
      mcpPermissions,
      agentQuestions,
      permission: archived && state.permission?.sessionId === sessionId ? null : state.permission,
      resolution: archived && state.resolution?.sessionId === sessionId ? null : state.resolution,
      pendingReplyTo: archived && state.pendingReplyTo === sessionId ? null : state.pendingReplyTo,
      agentJumpMessageId:
        archived && state.activeSessionId === sessionId ? null : state.agentJumpMessageId,
      agentAttentionRequestId:
        archived && state.activeSessionId === sessionId ? null : state.agentAttentionRequestId
    })
    persistAgentSession(sessionId, { archived })
  },

  toggleAgentPlanMode: (sessionId) => {
    const session = get().sessions.find((item) => item.id === sessionId)
    if (!session) return
    const planMode = !session.planMode
    set((state) => ({
      sessions: state.sessions.map((item) => {
        if (item.id !== sessionId) return item
        const next = { ...item }
        if (planMode) next.planMode = true
        else delete next.planMode
        return next
      })
    }))
    persistAgentSession(sessionId, { planMode })
  },

  removeAgentSession: (sessionId) => {
    const state = get()
    const index = state.sessions.findIndex((session) => session.id === sessionId)
    if (index < 0) return
    const sessions = state.sessions.filter((session) => session.id !== sessionId)
    const threads = { ...state.threads }
    delete threads[sessionId]
    const threadsLoaded = { ...state.threadsLoaded }
    delete threadsLoaded[sessionId]
    const streams = { ...state.streams }
    delete streams[sessionId]
    const toolPermissions = { ...state.toolPermissions }
    delete toolPermissions[sessionId]
    const toolPermissionQueues = { ...state.toolPermissionQueues }
    delete toolPermissionQueues[sessionId]
    const mcpPermissions = { ...state.mcpPermissions }
    delete mcpPermissions[sessionId]
    const agentQuestions = { ...state.agentQuestions }
    delete agentQuestions[sessionId]
    const pendingPrompts = state.pendingPrompts.filter((prompt) => prompt.sessionId !== sessionId)
    const removedActive = state.activeSessionId === sessionId
    const nextActive = removedActive
      ? (sessions[Math.min(index, sessions.length - 1)]?.id ?? '')
      : state.activeSessionId
    if (removedActive) {
      const storage = browserStorage()
      if (nextActive) storage?.setItem(ACTIVE_AGENT_KEY, nextActive)
      else storage?.removeItem(ACTIVE_AGENT_KEY)
    }
    set({
      sessions,
      threads,
      threadsLoaded,
      streams,
      toolPermissions,
      toolPermissionQueues,
      mcpPermissions,
      agentQuestions,
      pendingPrompts,
      activeSessionId: nextActive,
      permission: state.permission?.sessionId === sessionId ? null : state.permission,
      resolution: state.resolution?.sessionId === sessionId ? null : state.resolution,
      pendingReplyTo: state.pendingReplyTo === sessionId ? null : state.pendingReplyTo,
      typing: Object.keys(streams).length > 0 || pendingPrompts.length > 0,
      agentJumpMessageId: removedActive ? null : state.agentJumpMessageId,
      agentAttentionRequestId: removedActive ? null : state.agentAttentionRequestId
    })
  },

  setAgentResume: (sessionId, resumeId) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? { ...session, resumeId, pendingFork: false, forkTurnId: undefined }
          : session
      )
    }))
    persistAgentSession(sessionId, { resumeId, pendingFork: false, forkTurnId: null })
  },

  setAgentWorkspace: (sessionId, workspace) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, workspace } : session
      )
    }))
    persistAgentSession(sessionId, { workspace })
  },

  importAgentSession: ({ session: record, messages }) => {
    const now = Date.now()
    const session: Session = {
      id: record.id,
      agent: record.agent,
      title: record.title,
      status: record.status,
      meta: agentSessionMeta(record.updatedAt, messages.length, now),
      threadDate: agentSessionDate(record.updatedAt, now),
      ...(record.workspace ? { workspace: record.workspace } : {}),
      ...(record.resumeId ? { resumeId: record.resumeId } : {}),
      ...(record.pendingFork ? { pendingFork: true } : {}),
      ...(record.forkTurnId ? { forkTurnId: record.forkTurnId } : {})
    }
    set((state) => ({
      sessions: [session, ...state.sessions.filter((item) => item.id !== record.id)],
      threads: { ...state.threads, [record.id]: messages.map(toChatMessage) },
      threadsLoaded: { ...state.threadsLoaded, [record.id]: true },
      activeSessionId: record.id,
      activeView: 'agent',
      permission: null,
      resolution: null
    }))
    browserStorage()?.setItem(ACTIVE_AGENT_KEY, record.id)
  },

  addForkedSession: ({ session: record, messages }) => {
    const now = Date.now()
    const session: Session = {
      id: record.id,
      agent: record.agent,
      title: record.title,
      status: record.status,
      meta: agentSessionMeta(record.updatedAt, messages.length, now),
      threadDate: agentSessionDate(record.updatedAt, now),
      ...(record.workspace ? { workspace: record.workspace } : {}),
      ...(record.resumeId ? { resumeId: record.resumeId } : {}),
      ...(record.pendingFork ? { pendingFork: true } : {}),
      ...(record.forkTurnId ? { forkTurnId: record.forkTurnId } : {})
    }
    set((state) => ({
      sessions: [session, ...state.sessions.filter((item) => item.id !== record.id)],
      threads: { ...state.threads, [record.id]: messages.map(toChatMessage) },
      threadsLoaded: { ...state.threadsLoaded, [record.id]: true },
      activeSessionId: record.id,
      activeView: 'agent',
      permission: null,
      resolution: null
    }))
    browserStorage()?.setItem(ACTIVE_AGENT_KEY, record.id)
  },

  setToolPermission: (sessionId, request) =>
    set((state) => {
      const entry = { ...request, sessionId }
      if (state.toolPermissions[sessionId]) {
        return {
          toolPermissionQueues: {
            ...state.toolPermissionQueues,
            [sessionId]: [...(state.toolPermissionQueues[sessionId] ?? []), entry]
          },
          sessions: state.sessions.map((session) =>
            session.id === sessionId ? { ...session, status: 'wait' as const } : session
          )
        }
      }
      return {
        toolPermissions: { ...state.toolPermissions, [sessionId]: entry },
        sessions: state.sessions.map((session) =>
          session.id === sessionId ? { ...session, status: 'wait' as const } : session
        )
      }
    }),

  clearToolPermission: (sessionId) =>
    set((state) => {
      const toolPermissions = { ...state.toolPermissions }
      delete toolPermissions[sessionId]
      const queue = [...(state.toolPermissionQueues[sessionId] ?? [])]
      const next = queue.shift()
      const toolPermissionQueues = { ...state.toolPermissionQueues }
      if (next) toolPermissions[sessionId] = next
      if (queue.length) toolPermissionQueues[sessionId] = queue
      else delete toolPermissionQueues[sessionId]
      const waiting = Boolean(
        next || state.mcpPermissions[sessionId] || state.agentQuestions[sessionId]
      )
      return {
        toolPermissions,
        toolPermissionQueues,
        sessions: state.sessions.map((session) =>
          session.id === sessionId && session.status === 'wait' && !waiting
            ? { ...session, status: 'run' as const }
            : session
        )
      }
    }),

  setMcpPermission: (request) =>
    set((state) => ({
      mcpPermissions: { ...state.mcpPermissions, [request.sessionId]: request },
      sessions: state.sessions.map((session) =>
        session.id === request.sessionId ? { ...session, status: 'wait' as const } : session
      )
    })),

  clearMcpPermission: (sessionId) =>
    set((state) => {
      const mcpPermissions = { ...state.mcpPermissions }
      delete mcpPermissions[sessionId]
      const waiting = Boolean(state.toolPermissions[sessionId] || state.agentQuestions[sessionId])
      return {
        mcpPermissions,
        sessions: state.sessions.map((session) =>
          session.id === sessionId && session.status === 'wait' && !waiting
            ? { ...session, status: 'run' as const }
            : session
        )
      }
    }),

  setAgentQuestion: (sessionId, request) =>
    set((state) => ({
      agentQuestions: { ...state.agentQuestions, [sessionId]: request },
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, status: 'wait' as const } : session
      )
    })),

  clearAgentQuestion: (sessionId) =>
    set((state) => {
      const agentQuestions = { ...state.agentQuestions }
      delete agentQuestions[sessionId]
      const waiting = Boolean(state.toolPermissions[sessionId] || state.mcpPermissions[sessionId])
      return {
        agentQuestions,
        sessions: state.sessions.map((session) =>
          session.id === sessionId && session.status === 'wait' && !waiting
            ? { ...session, status: 'run' as const }
            : session
        )
      }
    }),

  sendMessage: (text, contextFiles, images) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const files = contextFiles
      ? Array.from(new Set(contextFiles.map((path) => path.trim()).filter(Boolean)))
      : []
    const attachments = files.length > 0 ? files : undefined
    const state = get()
    const session = state.sessions.find((item) => item.id === state.activeSessionId)
    if (!session) return
    const sessionId = session.id
    const now = Date.now()
    const message: ChatMessage = {
      id: nextMessageId('u'),
      role: 'user',
      text: trimmed,
      time: messageTimeLabel(),
      ...(attachments ? { contextFiles: attachments } : {}),
      ...(images?.length ? { images } : {})
    }
    const count = (state.threads[sessionId]?.length ?? 0) + 1
    const title = session.title === '新会话' ? trimmed.slice(0, 40) : session.title
    const touch = (item: Session) =>
      item.id === sessionId ? withAgentMeta({ ...item, title, status: 'run' }, count, now) : item

    set((current) => ({
      sessions: current.sessions.map(touch),
      threads: {
        ...current.threads,
        [sessionId]: [...(current.threads[sessionId] ?? []), message]
      },
      pendingPrompts: [
        ...current.pendingPrompts,
        {
          sessionId,
          prompt: trimmed,
          ...(attachments ? { contextFiles: attachments } : {}),
          ...(images?.length ? { images } : {})
        }
      ],
      typing: true,
      pendingReplyTo: sessionId
    }))
    persistAgentMessage(sessionId, message)
    persistAgentSession(sessionId, { status: 'run', ...(title !== session.title ? { title } : {}) })
  },

  retryMessage: (text, contextFiles, images) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const files = contextFiles
      ? Array.from(new Set(contextFiles.map((path) => path.trim()).filter(Boolean)))
      : []
    const attachments = files.length > 0 ? files : undefined
    const state = get()
    const session = state.sessions.find((item) => item.id === state.activeSessionId)
    if (!session) return
    if (state.streams[session.id]) return
    if (state.pendingPrompts.some((prompt) => prompt.sessionId === session.id)) return
    set((current) => ({
      sessions: current.sessions.map((item) =>
        item.id === session.id ? { ...item, status: 'run' as const } : item
      ),
      pendingPrompts: [
        ...current.pendingPrompts,
        {
          sessionId: session.id,
          prompt: trimmed,
          ...(attachments ? { contextFiles: attachments } : {}),
          ...(images?.length ? { images } : {})
        }
      ],
      typing: true,
      pendingReplyTo: session.id
    }))
    persistAgentSession(session.id, { status: 'run' })
  },

  takePendingPrompt: (sessionId) => {
    const state = get()
    // 默认取队首；指定会话时只取属于它的那一条，避免队首被占用时堵住别的会话
    const index = sessionId
      ? state.pendingPrompts.findIndex((item) => item.sessionId === sessionId)
      : 0
    const next = state.pendingPrompts[index]
    if (!next) return null
    set({ pendingPrompts: state.pendingPrompts.filter((_, itemIndex) => itemIndex !== index) })
    return {
      sessionId: next.sessionId,
      prompt: next.prompt,
      ...(next.contextFiles ? { contextFiles: next.contextFiles } : {}),
      ...(next.images ? { images: next.images } : {})
    }
  },

  beginAgentReply: (sessionId, runId) => {
    // 同一会话始终只有一条流；重复启动时保留已有消息，避免把上一条回复写丢
    if (get().streams[sessionId]) return
    const now = Date.now()
    const message: ChatMessage = {
      id: nextMessageId('a'),
      role: 'assistant',
      text: '',
      time: messageTimeLabel()
    }
    const count = (get().threads[sessionId]?.length ?? 0) + 1
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? withAgentMeta({ ...session, status: 'run' }, count, now)
          : session
      ),
      threads: { ...state.threads, [sessionId]: [...(state.threads[sessionId] ?? []), message] },
      streams: {
        ...state.streams,
        [sessionId]: { runId, messageId: message.id }
      },
      typing: true,
      pendingReplyTo: sessionId
    }))
    persistAgentSession(sessionId, { status: 'run' })
  },

  bindAgentRun: (sessionId, runId) =>
    set((state) => {
      const stream = state.streams[sessionId]
      if (!stream) return {}
      return { streams: { ...state.streams, [sessionId]: { ...stream, runId } } }
    }),

  setAgentTurnId: (sessionId, turnId) =>
    set((state) => {
      const stream = state.streams[sessionId]
      if (!stream || !turnId) return {}
      return { streams: { ...state.streams, [sessionId]: { ...stream, turnId } } }
    }),

  setAgentRunModel: (sessionId, model) => {
    const stream = get().streams[sessionId]
    const label = model.trim().slice(0, 80)
    if (!stream || !label) return
    set((state) => ({
      threads: {
        ...state.threads,
        [sessionId]: (state.threads[sessionId] ?? []).map((entry) =>
          entry.id === stream.messageId ? { ...entry, model: label } : entry
        )
      }
    }))
  },

  appendAgentText: (sessionId, chunk) => {
    const stream = get().streams[sessionId]
    if (!stream || !chunk) return
    set((state) => ({
      threads: {
        ...state.threads,
        [sessionId]: (state.threads[sessionId] ?? []).map((entry) =>
          entry.id === stream.messageId
            ? { ...entry, text: appendStreamText(entry.text, chunk) }
            : entry
        )
      }
    }))
  },

  upsertAgentTool: (sessionId, tool, status) => {
    const stream = get().streams[sessionId]
    if (!stream) return
    set((state) => ({
      threads: {
        ...state.threads,
        [sessionId]: (state.threads[sessionId] ?? []).map((entry) => {
          if (entry.id !== stream.messageId) return entry
          const tools = entry.tools ? [...entry.tools] : []
          const index = tool.id ? tools.findIndex((item) => item.id === tool.id) : -1
          if (index >= 0) tools[index] = { ...tools[index], ...tool, status }
          else tools.push({ ...tool, status })
          return { ...entry, tools }
        })
      }
    }))
  },

  setAgentToolStatus: (sessionId, toolId, status) => {
    const stream = get().streams[sessionId]
    if (!stream) return
    set((state) => ({
      threads: {
        ...state.threads,
        [sessionId]: (state.threads[sessionId] ?? []).map((entry) => {
          if (entry.id !== stream.messageId || !entry.tools) return entry
          return {
            ...entry,
            tools: entry.tools.map((tool) => (tool.id === toolId ? { ...tool, status } : tool))
          }
        })
      }
    }))
  },

  finishAgentReply: (sessionId, error) => {
    const stream = get().streams[sessionId]
    if (!stream) return
    const { messageId, turnId, runId } = stream
    const now = Date.now()
    const toolPermissions = { ...get().toolPermissions }
    delete toolPermissions[sessionId]
    const toolPermissionQueues = { ...get().toolPermissionQueues }
    delete toolPermissionQueues[sessionId]
    const mcpPermissions = { ...get().mcpPermissions }
    delete mcpPermissions[sessionId]
    const agentQuestions = { ...get().agentQuestions }
    delete agentQuestions[sessionId]
    set((state) => {
      const streams = { ...state.streams }
      delete streams[sessionId]
      const remaining = Object.keys(streams)
      const nextPending = state.pendingPrompts[0]?.sessionId ?? null
      const nextActive = remaining.includes(state.activeSessionId)
        ? state.activeSessionId
        : (remaining[0] ?? null)
      return {
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? withAgentMeta(
                { ...session, status: 'idle' },
                (state.threads[sessionId] ?? []).length,
                now
              )
            : session
        ),
        threads: {
          ...state.threads,
          [sessionId]: (state.threads[sessionId] ?? []).map((entry) => {
            if (entry.id !== messageId) return entry
            // 原始报错对用户没有指导意义，先翻译成「发生了什么 + 怎么办」。
            // 已有正文不能被吞掉：半截回复 + 失败原因才说得清发生了什么。
            if (error) {
              const agent = get().sessions.find((item) => item.id === sessionId)?.agent
              const friendly = friendlyMessage(error, undefined, agent)
              const raw = redactErrorDetail(error)
              // 原文留在分隔符后面，界面默认收起；未知错误标题已包含原文，避免重复。
              const text =
                raw && !friendly.includes(raw)
                  ? `${friendly}${ERROR_DETAIL_SEPARATOR}${raw}`
                  : friendly
              return {
                ...entry,
                text: entry.text ? `${entry.text}\n\n${text}` : text,
                ...(turnId ? { turnId } : {}),
                ...(runId ? { runId } : {}),
                error: true
              }
            }
            // 已经标过错误的条目不要被随后的 result 事件抹平
            if (entry.error) return entry
            // 空回复也要留个痕迹，否则界面像「什么都没发生」
            return entry.text
              ? { ...entry, ...(turnId ? { turnId } : {}), ...(runId ? { runId } : {}) }
              : {
                  ...entry,
                  text: '（本轮没有输出）',
                  ...(turnId ? { turnId } : {}),
                  ...(runId ? { runId } : {})
                }
          })
        },
        streams,
        toolPermissions,
        toolPermissionQueues,
        mcpPermissions,
        agentQuestions,
        typing: remaining.length > 0 || state.pendingPrompts.length > 0,
        pendingReplyTo: nextActive ?? nextPending
      }
    })
    const finalMessage = get().threads[sessionId]?.find((message) => message.id === messageId)
    if (finalMessage) persistAgentMessage(sessionId, finalMessage)
    persistAgentSession(sessionId, { status: 'idle' })
  },

  receiveReply: (text, tools) => {
    const state = get()
    const sessionId = state.pendingReplyTo ?? state.activeSessionId
    if (!sessionId) return
    const now = Date.now()
    const message: ChatMessage = {
      id: nextMessageId('a'),
      role: 'assistant',
      text,
      time: messageTimeLabel(),
      tools
    }
    const count = (state.threads[sessionId]?.length ?? 0) + 1
    set((current) => {
      // 这条回复兑现的是该会话最早的一条待发送提示词
      const index = current.pendingPrompts.findIndex((item) => item.sessionId === sessionId)
      const pendingPrompts =
        index >= 0
          ? current.pendingPrompts.filter((_, itemIndex) => itemIndex !== index)
          : current.pendingPrompts
      const remaining = Object.keys(current.streams)
      return {
        sessions: current.sessions.map((session) =>
          session.id === sessionId
            ? withAgentMeta({ ...session, status: 'idle' }, count, now)
            : session
        ),
        threads: {
          ...current.threads,
          [sessionId]: [...(current.threads[sessionId] ?? []), message]
        },
        pendingPrompts,
        typing: remaining.length > 0 || pendingPrompts.length > 0,
        pendingReplyTo: remaining[0] ?? pendingPrompts[0]?.sessionId ?? null
      }
    })
    persistAgentMessage(sessionId, message)
    persistAgentSession(sessionId, { status: 'idle' })
  },

  resolvePermission: (decision) => {
    const permission = get().permission
    if (!permission) return
    const resolution: ResolutionRecord = {
      sessionId: permission.sessionId,
      decision: decision === 'allow' ? 'allowed' : 'denied'
    }
    // 审批处理完，发起会话就不再是「待确认」，否则舰队与导航会一直显示有人等。
    const clearWaiting = (sessions: Session[]) =>
      sessions.map((session) =>
        session.id === permission.sessionId ? { ...session, status: 'run' as const } : session
      )
    if (decision === 'deny') {
      set((state) => ({
        permission: null,
        resolution,
        sessions: clearWaiting(state.sessions)
      }))
      return
    }
    set((state) => {
      const changes = new Map(permission.changes.map((change) => [change.taskId, change]))
      return {
        sessions: clearWaiting(state.sessions),
        tasks: state.tasks.map((task) => {
          const change = changes.get(task.id)
          if (!change) return task
          const updated = { ...task, time: change.toTime, tag: change.toTag, tone: undefined }
          if (change.toDueDate === null) delete updated.dueDate
          else if (change.toDueDate !== undefined) updated.dueDate = change.toDueDate
          return updated
        }),
        permission: null,
        resolution
      }
    })
    persistQuietly(
      () =>
        persistence?.applySchedule(
          permission.changes.map((change) => ({
            taskId: change.taskId,
            toTime: change.toTime,
            toTag: change.toTag,
            ...(change.toDueDate !== undefined ? { toDueDate: change.toDueDate } : {})
          }))
        ) ?? Promise.resolve()
    )
  },

  toggleMotion: () => set((state) => ({ motionOn: !state.motionOn })),

  toggleTheme: () => {
    const theme = otherTheme(get().theme)
    persistTheme(theme, browserStorage())
    set({ theme })
  },

  toggleSkin: () => {
    const skin = otherSkin(get().skin)
    persistSkin(skin, browserStorage())
    set({ skin })
  },

  startFocus: (label, minutes) => set({ focus: { label, minutes } satisfies FocusSession }),

  closeFocus: () => set({ focus: null }),

  openQuickNote: () => set({ quickNoteOpen: true }),

  closeQuickNote: () => set({ quickNoteOpen: false }),

  addNote: (text, tag = '想法') => {
    const trimmed = text.trim()
    if (!trimmed) return
    const persistence = notePersistence
    const local: Note = { id: `n-${Date.now()}`, text: trimmed, time: '刚刚', tag }
    set((state) => ({
      notes: [local, ...state.notes],
      noteTotal: state.noteTotal + 1,
      noteRevision: state.noteRevision + (persistence ? 0 : 1),
      quickNoteOpen: false
    }))

    if (!persistence) return
    void persistence
      .create(trimmed, tag)
      .then((saved) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === local.id
              ? { ...saved, text: note.text, time: note.time, tag: note.tag }
              : note
          ),
          noteRevision: state.noteRevision + 1
        }))
      })
      .catch(reportPersistenceError)
  },

  openDailyNote: () => {
    const title = dailyNoteTitle(dateKey())
    const persistence = notePersistence
    const open = (note: NoteJump) => set({ activeView: 'notes', noteJump: note })
    const createAndOpen = () => {
      if (!persistence) {
        get().addNote(`${title}\n`, '日记')
        const created = get().notes[0]
        if (created) open(created)
        return
      }
      void persistence
        .create(`${title}\n`, '日记')
        .then((saved) => {
          set((state) => ({
            notes: [saved, ...state.notes],
            noteTotal: state.noteTotal + 1,
            noteRevision: state.noteRevision + 1
          }))
          open(saved)
        })
        .catch(reportPersistenceError)
    }
    const local = findDailyNote(get().notes, title)
    if (local) {
      open(local)
      return
    }
    if (!persistence?.search) {
      createAndOpen()
      return
    }
    void persistence
      .search(title, 20, '日记')
      .then((hits) => {
        const existing = findDailyNote(hits, title)
        if (existing) open(existing)
        else createAndOpen()
      })
      .catch(() => createAndOpen())
  },

  openNotesView: () => set({ activeView: 'notes' }),

  toggleNotePin: (noteId) => {
    const note = get().notes.find((item) => item.id === noteId)
    if (!note) return
    const pinned = !note.pinned
    set((state) => ({
      notes: state.notes.map((item) => (item.id === noteId ? { ...item, pinned } : item))
    }))

    const togglePin = notePersistence?.togglePin
    if (!togglePin) {
      set((state) => ({ noteRevision: state.noteRevision + 1 }))
      return
    }
    void togglePin(noteId)
      .then(() => set((state) => ({ noteRevision: state.noteRevision + 1 })))
      .catch((error) => {
        set((state) => ({
          notes: state.notes.map((item) =>
            item.id === noteId ? { ...item, pinned: note.pinned } : item
          ),
          noteRevision: state.noteRevision + 1
        }))
        reportPersistenceError(error)
      })
  },

  updateNote: (noteId, patch) => {
    const next: NotePatch = {}
    if (patch.text !== undefined) {
      const text = patch.text.trim()
      if (!text) return
      next.text = text
    }
    if (patch.tag !== undefined) next.tag = patch.tag.trim()
    if (patch.pinned !== undefined) next.pinned = patch.pinned
    if (Object.keys(next).length === 0) return

    // 先改内存副本让面板立刻反映，等写库成功再 bump revision——
    // 反过来的话笔记页会抢在 IPC 落库前重读，读回的还是旧正文。
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === noteId
          ? {
              ...note,
              ...(next.text !== undefined ? { text: next.text } : {}),
              ...(next.tag !== undefined ? { tag: next.tag || undefined } : {}),
              ...(next.pinned !== undefined ? { pinned: next.pinned } : {})
            }
          : note
      )
    }))

    const update = notePersistence?.update
    if (!update) {
      set((state) => ({ noteRevision: state.noteRevision + 1 }))
      return
    }
    void update(noteId, next)
      .then(() => set((state) => ({ noteRevision: state.noteRevision + 1 })))
      .catch(reportPersistenceError)
  },

  removeNote: (noteId) => {
    const removed = get().notes.find((note) => note.id === noteId)
    set((state) => ({
      notes: state.notes.filter((note) => note.id !== noteId),
      noteTotal: Math.max(0, state.noteTotal - 1)
    }))
    if (!removed) return

    const restore = () =>
      set((state) => ({
        notes: [removed, ...state.notes],
        noteTotal: state.noteTotal + 1,
        noteRevision: state.noteRevision + 1
      }))

    const remove = notePersistence?.remove
    if (!remove) {
      set((state) => ({ noteRevision: state.noteRevision + 1 }))
      return
    }
    // 同样等落库再刷新；主进程说没删掉（false）就回滚那一行
    void remove(noteId)
      .then((ok) => {
        if (ok) set((state) => ({ noteRevision: state.noteRevision + 1 }))
        else restore()
      })
      .catch((error) => {
        restore()
        reportPersistenceError(error)
      })
  },

  setLearningScope: (learningScope) => set({ learningScope }),

  setLearningNewPerDay: (value) => {
    const perDay = normalizeNewPerDay(value)
    persistNewPerDay(browserStorage(), perDay)
    set({ learningNewPerDay: perDay })
  },

  refreshLearningNewIntroduced: () => {
    const api = typeof window === 'undefined' ? undefined : window.ws?.learning
    if (!api?.newIntroduced) return
    void api
      .newIntroduced(dateKey())
      .then((value) => {
        if (!Number.isFinite(value)) return
        set({ learningNewIntroduced: Math.max(0, Math.trunc(value)) })
      })
      .catch(() => {})
  },

  addLearningItem: (draft) => {
    const title = draft.title.trim()
    const subject = draft.subject.trim()
    if (!title || !subject) return
    const local: LearningItem = {
      id: nextLearningId(),
      subject,
      title,
      source: draft.source ?? '',
      notes: draft.notes ?? '',
      repetitions: 0,
      intervalDays: 0,
      ease: 2.5,
      nextReviewOn: draft.nextReviewOn ?? dateKey(),
      active: true,
      ...(draft.kind === 'cloze'
        ? { kind: 'cloze' as const, clozeSource: draft.clozeSource ?? '' }
        : {}),
      ...(draft.noteId ? { noteId: draft.noteId } : {})
    }
    set((state) => ({
      learningItems: [local, ...state.learningItems],
      learningScope: { kind: 'all' }
    }))

    if (!learningPersistence) return
    void learningPersistence
      .create({ ...draft, subject, title })
      .then((saved) => {
        set((state) => ({
          learningItems: state.learningItems.map((item) => (item.id === local.id ? saved : item))
        }))
      })
      .catch((error) => {
        set((state) => ({
          learningItems: state.learningItems.filter((item) => item.id !== local.id)
        }))
        reportPersistenceError(error)
      })
  },

  updateLearningItem: (itemId, patch) => {
    const next: LearningPatch = { ...patch }
    if (next.title !== undefined) {
      const title = next.title.trim()
      if (!title) return
      next.title = title
    }
    if (next.subject !== undefined) {
      const subject = next.subject.trim()
      if (!subject) return
      next.subject = subject
    }
    if (next.clozeSource !== undefined) {
      // 正面跟着原文走，和主进程校验保持同一规则
      next.title = clozeFrontText(next.clozeSource).slice(0, 200)
    }
    if (Object.keys(next).length === 0) return

    set((state) => ({
      learningItems: state.learningItems.map((item) =>
        item.id === itemId ? { ...item, ...next } : item
      )
    }))
    persistQuietly(() => learningPersistence?.update(itemId, next) ?? Promise.resolve())
  },

  removeLearningItem: (itemId) => {
    const index = get().learningItems.findIndex((item) => item.id === itemId)
    if (index < 0) return
    const removed = get().learningItems[index]
    set((state) => ({
      learningItems: state.learningItems.filter((item) => item.id !== itemId)
    }))

    const restore = () =>
      set((state) => {
        const items = [...state.learningItems]
        items.splice(Math.min(index, items.length), 0, removed)
        return { learningItems: items }
      })

    const remove = learningPersistence?.remove
    if (!remove) return
    void remove(itemId)
      .then((ok) => {
        if (!ok) restore()
      })
      .catch((error) => {
        restore()
        reportPersistenceError(error)
      })
  },

  reviewLearningItem: (itemId, rating) => {
    const state = get()
    const item = state.learningItems.find((entry) => entry.id === itemId)
    if (!item) return
    const wasNew = isNewCard(item)

    const advance = (updated: LearningItem, countNew = false) => {
      set((current) => {
        const session = current.learningReviewSession ?? []
        const rest = session.filter((id) => id !== itemId)
        return {
          learningItems: current.learningItems.map((entry) =>
            entry.id === itemId ? updated : entry
          ),
          learningReviewSession: rating === 1 ? [...rest, itemId] : rest,
          learningNewIntroduced: countNew
            ? current.learningNewIntroduced + 1
            : current.learningNewIntroduced,
          learningReviewTally: {
            reviewed: current.learningReviewTally.reviewed + 1,
            again: current.learningReviewTally.again + (rating === 1 ? 1 : 0),
            startedAt: current.learningReviewTally.startedAt
          }
        }
      })
    }

    if (!learningPersistence) {
      advance(
        {
          ...item,
          ...scheduleReview(
            {
              repetitions: item.repetitions,
              intervalDays: item.intervalDays,
              stability: item.stability,
              difficulty: item.difficulty,
              lapses: item.lapses,
              lastReviewOn: item.lastReviewOn,
              lastReviewedAt: item.lastReviewedAt
            },
            rating,
            dateKey()
          ),
          lastReviewOn: dateKey()
        },
        wasNew
      )
      return
    }

    void learningPersistence
      .review(itemId, rating)
      .then((updated) => advance(updated, wasNew))
      .catch((error) => {
        reportPersistenceError(error)
        // 写库失败也要让这一张离开队列，否则用户会被卡在同一张卡上。
        advance(item)
      })
  },

  startLearningReview: () => {
    const state = get()
    const ids = dueQueue(state.learningItems, dateKey(), {
      perDay: state.learningNewPerDay,
      introducedToday: state.learningNewIntroduced
    }).map((item) => item.id)
    set({
      activeView: 'learning',
      learningReviewOpen: true,
      learningReviewSession: ids,
      learningReviewTally: { reviewed: 0, again: 0, startedAt: Date.now() }
    })
  },

  exitLearningReview: () => set({ learningReviewOpen: false, learningReviewSession: null }),

  clearPersistenceError: () => set({ persistenceError: null })
}))

export function replaceTasks(tasks: Task[]): void {
  useWorkstation.setState({ tasks })
}

export function replaceNotes(notes: Note[], total = notes.length): void {
  useWorkstation.setState({ notes, noteTotal: total })
}

export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  if (filter === 'todo') return tasks.filter((task) => !task.done)
  if (filter === 'done') return tasks.filter((task) => task.done)
  return tasks
}

export function selectVisibleTasks(state: WorkstationState): Task[] {
  return filterTasks(state.tasks, state.taskFilter)
}

export function selectActiveSession(state: WorkstationState) {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0]
}

const EMPTY_THREAD: ChatMessage[] = []

export function selectActiveThread(state: WorkstationState): ChatMessage[] {
  // 必须返回稳定引用：空态下每次新建 [] 会让 useSyncExternalStore 进入无限重渲染。
  return state.threads[state.activeSessionId] ?? EMPTY_THREAD
}

export function selectPreviewNotes(notes: Note[]): { pinned?: Note; rest: Note[] } {
  const pinnedIndex = notes.findIndex((note) => note.pinned)
  const pinnedAt = Math.max(pinnedIndex, 0)
  const pinned = notes[pinnedAt]
  const rest: Note[] = []

  for (let index = 0; index < notes.length && rest.length < 2; index += 1) {
    if (index === pinnedAt) continue
    rest.push(notes[index])
  }

  return { pinned, rest }
}
