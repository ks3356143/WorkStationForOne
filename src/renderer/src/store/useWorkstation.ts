import { create } from 'zustand'
import { createInitialData } from '../data/mock'
import { getTodayIndex } from '../lib/date'
import type {
  ChatMessage,
  FocusSession,
  Resolution,
  Task,
  TaskFilter,
  ToolCall,
  WorkstationData
} from '../types'

interface TaskPersistence {
  setDone: (id: string, done: boolean) => Promise<void>
  applySchedule: (changes: { taskId: string; toTime: string; toTag: string }[]) => Promise<void>
}

let persistence: TaskPersistence | null = null

export function bindTaskPersistence(next: TaskPersistence | null): void {
  persistence = next
}

function persistQuietly(run: () => Promise<void>): void {
  void run().catch((error) => {
    console.error('[persistence] 任务写入失败', error)
  })
}

interface WorkstationActions {
  setFilter: (filter: TaskFilter) => void
  toggleTask: (taskId: string) => void
  toggleHabitToday: (habitId: string) => void
  setActiveSession: (sessionId: string) => void
  sendMessage: (text: string) => void
  receiveReply: (text: string, tools?: ToolCall[]) => void
  resolvePermission: (decision: 'allow' | 'deny') => void
  toggleMotion: () => void
  startFocus: (label: string, minutes: number) => void
  closeFocus: () => void
  openQuickNote: () => void
  closeQuickNote: () => void
  addNote: (text: string) => void
}

export type WorkstationState = WorkstationData & WorkstationActions

let messageSeq = 0

function nextMessageId(prefix: string): string {
  messageSeq += 1
  return `${prefix}-${messageSeq}`
}

export const useWorkstation = create<WorkstationState>()((set, get) => ({
  ...createInitialData(),

  setFilter: (taskFilter) => set({ taskFilter }),

  toggleTask: (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId)
    if (!task) return
    const done = !task.done
    set((state) => ({
      tasks: state.tasks.map((item) => (item.id === taskId ? { ...item, done } : item))
    }))
    persistQuietly(() => persistence?.setDone(taskId, done) ?? Promise.resolve())
  },

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
      threads: { ...current.threads, [sessionId]: [...(current.threads[sessionId] ?? []), message] },
      typing: false,
      pendingReplyTo: null
    }))
  },

  resolvePermission: (decision) => {
    const permission = get().permission
    if (!permission) return
    const resolution: Resolution = decision === 'allow' ? 'allowed' : 'denied'
    if (decision === 'deny') {
      set({ permission: null, resolution })
      return
    }
    set((state) => {
      const changes = new Map(permission.changes.map((change) => [change.taskId, change]))
      return {
        tasks: state.tasks.map((task) => {
          const change = changes.get(task.id)
          if (!change) return task
          return { ...task, time: change.toTime, tag: change.toTag, tone: undefined }
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
            toTag: change.toTag
          }))
        ) ?? Promise.resolve()
    )
  },

  toggleMotion: () => set((state) => ({ motionOn: !state.motionOn })),

  startFocus: (label, minutes) => set({ focus: { label, minutes } satisfies FocusSession }),

  closeFocus: () => set({ focus: null }),

  openQuickNote: () => set({ quickNoteOpen: true }),

  closeQuickNote: () => set({ quickNoteOpen: false }),

  addNote: (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    set((state) => ({
      notes: [
        { id: `n-${Date.now()}`, text: trimmed, time: '刚刚', tag: '想法' },
        ...state.notes
      ],
      quickNoteOpen: false
    }))
  }
}))

export function replaceTasks(tasks: Task[]): void {
  useWorkstation.setState({ tasks })
}

export function selectVisibleTasks(state: WorkstationState): Task[] {
  if (state.taskFilter === 'todo') return state.tasks.filter((task) => !task.done)
  if (state.taskFilter === 'done') return state.tasks.filter((task) => task.done)
  return state.tasks
}

export function selectActiveSession(state: WorkstationState) {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0]
}

export function selectActiveThread(state: WorkstationState): ChatMessage[] {
  return state.threads[state.activeSessionId] ?? []
}
