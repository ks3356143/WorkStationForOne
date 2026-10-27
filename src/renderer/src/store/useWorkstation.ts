import { create } from 'zustand'
import type { TaskDraft, TaskPatch } from '../../../shared/ipc'
import { createInitialData } from '../data/mock'
import { getTodayIndex } from '../lib/date'
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
  setDone: (id: string, done: boolean) => Promise<void>
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
}

interface NotePersistence {
  create: (text: string, tag?: string) => Promise<Note>
}

let persistence: TaskPersistence | null = null
let notePersistence: NotePersistence | null = null

export function bindTaskPersistence(next: TaskPersistence | null): void {
  persistence = next
}

export function bindNotePersistence(next: NotePersistence | null): void {
  notePersistence = next
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
  updateTask: (taskId: string, patch: TaskPatch) => void
  removeTask: (taskId: string) => void
  undoRemoveTask: () => void
  clearRemovedTask: () => void
  composeTask: () => void
  clearLastAddedTask: () => void
  toggleHabitToday: (habitId: string) => void
  setActiveSession: (sessionId: string) => void
  openAgentSession: (sessionId: string) => void
  sendMessage: (text: string) => void
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
  openNotesView: () => void
  clearPersistenceError: () => void
}

export type WorkstationState = WorkstationData & WorkstationActions

let messageSeq = 0
let taskSeq = 0

function nextMessageId(prefix: string): string {
  messageSeq += 1
  return `${prefix}-${messageSeq}`
}

function nextTaskId(): string {
  taskSeq += 1
  return `todo-${Date.now()}-${taskSeq}`
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
    persistQuietly(() => persistence?.setDone(taskId, done) ?? Promise.resolve())
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
      ...(draft.list ? { list: draft.list } : {})
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
        return updated
      })
    }))
    persistQuietly(() => persistence?.update(taskId, next) ?? Promise.resolve())
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

  toggleHabitToday: (habitId) =>
    set((state) => {
      const today = getTodayIndex()
      return {
        habits: state.habits.map((habit) => {
          if (habit.id !== habitId) return habit
          const days = [...habit.days]
          days[today] = !days[today]
          return { ...habit, days }
        })
      }
    }),

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
      pendingReplyTo: sessionId
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
