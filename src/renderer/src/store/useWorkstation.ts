import { create } from 'zustand'
import type {
  LearningDraft,
  LearningItemRecord,
  LearningPatch,
  LearningRating,
  NotePatch,
  TaskDraft,
  TaskPatch
} from '../../../shared/ipc'
import { appendStreamText } from '../../../shared/agent-stream'
import { clozeFrontText } from '../../../shared/cloze'
import { createInitialData } from '../data/mock'
import { dateKey } from '../../../shared/date-key'
import { toggleCheckin } from '../lib/habits'
import { dueQueue } from '../lib/learning'
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
import type {
  ChatMessage,
  FocusSession,
  LearningItem,
  LearningScope,
  Note,
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
  update?: (id: string, patch: NotePatch) => Promise<Note | undefined>
  remove?: (id: string) => Promise<boolean>
}

interface LearningPersistence {
  create: (draft: LearningDraft) => Promise<LearningItemRecord>
  update: (id: string, patch: LearningPatch) => Promise<void>
  review: (id: string, rating: LearningRating) => Promise<LearningItemRecord>
}

let persistence: TaskPersistence | null = null
let habitPersistence: {
  setCheckin: (id: string, day: string, done: boolean) => Promise<void>
} | null = null
let notePersistence: NotePersistence | null = null
let learningPersistence: LearningPersistence | null = null

export function bindHabitPersistence(
  next: { setCheckin: (id: string, day: string, done: boolean) => Promise<void> } | null
): void {
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
  toggleTask: (taskId: string) => void
  addTask: (draft: TaskDraft) => void
  addSubtask: (parentId: string, title: string) => void
  updateTask: (taskId: string, patch: TaskPatch) => void
  removeTask: (taskId: string) => void
  renameTaskList: (from: string, to: string) => void
  undoRemoveTask: () => void
  clearRemovedTask: () => void
  composeTask: () => void
  clearLastAddedTask: () => void
  toggleHabitToday: (habitId: string) => void
  setActiveSession: (sessionId: string) => void
  openAgentSession: (sessionId: string) => void
  sendMessage: (text: string) => void
  takePendingPrompt: () => { sessionId: string; prompt: string } | null
  beginAgentReply: (sessionId: string, runId: string | null) => void
  bindAgentRun: (runId: string) => void
  appendAgentText: (chunk: string) => void
  upsertAgentTool: (tool: ToolCall, status: string) => void
  setAgentToolStatus: (toolId: string, status: string) => void
  finishAgentReply: (error?: string) => void
  receiveReply: (text: string, tools?: ToolCall[]) => void
  resolvePermission: (decision: 'allow' | 'deny') => void
  toggleMotion: () => void
  toggleTheme: () => void
  toggleSkin: () => void
  startFocus: (label: string, minutes: number) => void
  closeFocus: () => void
  openQuickNote: () => void
  closeQuickNote: () => void
  addNote: (text: string) => void
  updateNote: (noteId: string, patch: NotePatch) => void
  removeNote: (noteId: string) => void
  openNotesView: () => void
  setLearningScope: (scope: LearningScope) => void
  addLearningItem: (draft: LearningDraft) => void
  updateLearningItem: (itemId: string, patch: LearningPatch) => void
  reviewLearningItem: (itemId: string, rating: LearningRating) => void
  startLearningReview: () => void
  exitLearningReview: () => void
  clearPersistenceError: () => void
}

export type WorkstationState = WorkstationData & WorkstationActions

let messageSeq = 0
let taskSeq = 0
let learningSeq = 0

function nextMessageId(prefix: string): string {
  messageSeq += 1
  return `${prefix}-${messageSeq}`
}

function nextTaskId(): string {
  taskSeq += 1
  return `todo-${Date.now()}-${taskSeq}`
}

function nextLearningId(): string {
  learningSeq += 1
  return `learn-${Date.now()}-${learningSeq}`
}

export const useWorkstation = create<WorkstationState>()((set, get) => ({
  ...createInitialData(),
  theme: readStoredTheme(browserStorage()),
  skin: readStoredSkin(browserStorage()),
  setView: (activeView) => set({ activeView }),

  setFilter: (taskFilter) => set({ taskFilter }),

  setTaskScope: (taskScope) => set({ taskScope }),

  composeTask: () =>
    set((state) => ({ activeView: 'tasks', taskComposerRequest: state.taskComposerRequest + 1 })),

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
      .catch(reportPersistenceError)
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

  clearRemovedTask: () => set({ lastRemovedTask: null }),

  toggleHabitToday: (habitId) => {
    const today = dateKey()
    const current = get().habits.find((habit) => habit.id === habitId)
    if (!current) return
    const next = toggleCheckin(current, today, today)
    const checked = !current.checkins.includes(today)
    set((state) => ({
      habits: state.habits.map((habit) => (habit.id === habitId ? next : habit))
    }))
    persistQuietly(() => habitPersistence?.setCheckin(habitId, today, checked) ?? Promise.resolve())
  },

  setActiveSession: (sessionId) =>
    set((state) => {
      if (!state.sessions.some((session) => session.id === sessionId)) return state
      return { activeSessionId: sessionId }
    }),

  openAgentSession: (sessionId) =>
    set((state) => {
      if (!state.sessions.some((session) => session.id === sessionId)) return state
      return { activeSessionId: sessionId, activeView: 'agent' }
    }),

  sendMessage: (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const sessionId = get().activeSessionId
    const message: ChatMessage = {
      id: nextMessageId('u'),
      role: 'user',
      text: trimmed,
      time: '刚刚'
    }
    set((state) => ({
      threads: { ...state.threads, [sessionId]: [...(state.threads[sessionId] ?? []), message] },
      typing: true,
      pendingReplyTo: sessionId,
      pendingPrompt: trimmed
    }))
  },

  takePendingPrompt: () => {
    const state = get()
    if (!state.pendingPrompt) return null
    set({ pendingPrompt: null })
    return { sessionId: state.activeSessionId, prompt: state.pendingPrompt }
  },

  beginAgentReply: (sessionId, runId) => {
    const message: ChatMessage = {
      id: nextMessageId('a'),
      role: 'assistant',
      text: '',
      time: '刚刚'
    }
    set((state) => ({
      threads: { ...state.threads, [sessionId]: [...(state.threads[sessionId] ?? []), message] },
      typing: true,
      pendingReplyTo: sessionId,
      streaming: { runId, sessionId, messageId: message.id }
    }))
  },

  bindAgentRun: (runId) => {
    set((state) => (state.streaming ? { streaming: { ...state.streaming, runId } } : {}))
  },

  appendAgentText: (chunk) => {
    const streaming = get().streaming
    if (!streaming || !chunk) return
    set((state) => ({
      threads: {
        ...state.threads,
        [streaming.sessionId]: (state.threads[streaming.sessionId] ?? []).map((entry) =>
          entry.id === streaming.messageId
            ? { ...entry, text: appendStreamText(entry.text, chunk) }
            : entry
        )
      }
    }))
  },

  upsertAgentTool: (tool, status) => {
    const streaming = get().streaming
    if (!streaming) return
    set((state) => ({
      threads: {
        ...state.threads,
        [streaming.sessionId]: (state.threads[streaming.sessionId] ?? []).map((entry) => {
          if (entry.id !== streaming.messageId) return entry
          const tools = entry.tools ? [...entry.tools] : []
          const index = tool.id ? tools.findIndex((item) => item.id === tool.id) : -1
          if (index >= 0) tools[index] = { ...tools[index], ...tool, status }
          else tools.push({ ...tool, status })
          return { ...entry, tools }
        })
      }
    }))
  },

  setAgentToolStatus: (toolId, status) => {
    const streaming = get().streaming
    if (!streaming) return
    set((state) => ({
      threads: {
        ...state.threads,
        [streaming.sessionId]: (state.threads[streaming.sessionId] ?? []).map((entry) => {
          if (entry.id !== streaming.messageId || !entry.tools) return entry
          return {
            ...entry,
            tools: entry.tools.map((tool) => (tool.id === toolId ? { ...tool, status } : tool))
          }
        })
      }
    }))
  },

  finishAgentReply: (error) => {
    const streaming = get().streaming
    if (!streaming) return
    set((state) => ({
      threads: {
        ...state.threads,
        [streaming.sessionId]: (state.threads[streaming.sessionId] ?? []).map((entry) => {
          if (entry.id !== streaming.messageId) return entry
          if (error) return { ...entry, text: entry.text || error, error: true }
          // 空回复也要留个痕迹，否则界面像「什么都没发生」
          return entry.text ? entry : { ...entry, text: '（本轮没有输出）' }
        })
      },
      typing: false,
      pendingReplyTo: null,
      streaming: null
    }))
  },

  receiveReply: (text, tools) => {
    const state = get()
    const sessionId = state.pendingReplyTo ?? state.activeSessionId
    const message: ChatMessage = {
      id: nextMessageId('a'),
      role: 'assistant',
      text,
      time: '刚刚',
      tools
    }
    set((current) => ({
      threads: {
        ...current.threads,
        [sessionId]: [...(current.threads[sessionId] ?? []), message]
      },
      typing: false,
      pendingReplyTo: null
    }))
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

  addNote: (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const persistence = notePersistence
    const local: Note = { id: `n-${Date.now()}`, text: trimmed, time: '刚刚', tag: '想法' }
    set((state) => ({
      notes: [local, ...state.notes],
      noteTotal: state.noteTotal + 1,
      noteRevision: state.noteRevision + (persistence ? 0 : 1),
      quickNoteOpen: false
    }))

    if (!persistence) return
    void persistence
      .create(trimmed, '想法')
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

  openNotesView: () => set({ activeView: 'notes' }),

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
      .catch(reportPersistenceError)
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

  reviewLearningItem: (itemId, rating) => {
    const state = get()
    const item = state.learningItems.find((entry) => entry.id === itemId)
    if (!item) return

    const advance = (updated: LearningItem) => {
      set((current) => {
        const session = current.learningReviewSession ?? []
        const rest = session.filter((id) => id !== itemId)
        return {
          learningItems: current.learningItems.map((entry) =>
            entry.id === itemId ? updated : entry
          ),
          learningReviewSession: rating === 1 ? [...rest, itemId] : rest,
          learningReviewTally: {
            reviewed: current.learningReviewTally.reviewed + 1,
            again: current.learningReviewTally.again + (rating === 1 ? 1 : 0),
            startedAt: current.learningReviewTally.startedAt
          }
        }
      })
    }

    if (!learningPersistence) {
      advance({
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
      })
      return
    }

    void learningPersistence
      .review(itemId, rating)
      .then(advance)
      .catch((error) => {
        reportPersistenceError(error)
        // 写库失败也要让这一张离开队列，否则用户会被卡在同一张卡上。
        advance(item)
      })
  },

  startLearningReview: () => {
    const state = get()
    const ids = dueQueue(state.learningItems, dateKey()).map((item) => item.id)
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

export function selectActiveThread(state: WorkstationState): ChatMessage[] {
  return state.threads[state.activeSessionId] ?? []
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
