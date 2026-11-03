import type { WorkstationData } from '../types'
import { createSeedHabits } from './seed/habits'
import { createSeedLearning } from './seed/learning'
import { createSeedNotes } from './seed/notes'
import { createSeedTasks } from './seed/tasks'

export function createInitialData(): WorkstationData {
  const notes = createSeedNotes()
  return {
    activeView: 'today',
    tasks: createSeedTasks(),
    reminderMutes: { day: '', taskIds: [] },
    learningItems: createSeedLearning(),
    learningReady: false,
    tasksReady: false,
    notesReady: false,
    sessionsReady: false,
    learningScope: { kind: 'all' },
    learningReviewOpen: false,
    learningReviewSession: null,
    learningReviewTally: { reviewed: 0, again: 0, startedAt: Date.now() },
    taskFilter: 'all',
    taskScope: 'today',
    taskJumpId: null,
    noteJump: null,
    learningJumpId: null,
    taskComposerRequest: 0,
    lastAddedTaskId: null,
    lastRemovedTask: null,
    habits: createSeedHabits(),
    notes,
    noteTotal: notes.length,
    noteRevision: 0,
    sessions: [],
    activeSessionId: '',
    agentJumpMessageId: null,
    threads: {},
    streams: {},
    pendingPrompts: [],
    typing: false,
    pendingReplyTo: null,
    permission: null,
    toolPermissions: {},
    mcpPermissions: {},
    resolution: null,
    motionOn: true,
    theme: 'dark',
    skin: 'prism',
    focus: null,
    quickNoteOpen: false,
    persistenceError: null
  }
}
