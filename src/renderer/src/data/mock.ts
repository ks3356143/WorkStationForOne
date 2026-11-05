import type { WorkstationData } from '../types'
import { DEFAULT_LEARNING_NEW_PER_DAY } from '../lib/learning-limit'
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
    learningNewPerDay: DEFAULT_LEARNING_NEW_PER_DAY,
    learningNewIntroduced: 0,
    taskFilter: 'all',
    taskScope: 'today',
    taskJumpId: null,
    noteJump: null,
    learningJumpId: null,
    taskComposerRequest: 0,
    agentDraftText: '',
    agentDraftRequest: 0,
    agentDraftSessionId: null,
    lastAddedTaskId: null,
    lastRemovedTask: null,
    habits: createSeedHabits(),
    notes,
    noteTotal: notes.length,
    noteRevision: 0,
    sessions: [],
    activeSessionId: '',
    agentJumpMessageId: null,
    agentAttentionRequestId: null,
    threads: {},
    threadsLoaded: {},
    streams: {},
    pendingPrompts: [],
    typing: false,
    pendingReplyTo: null,
    permission: null,
    toolPermissions: {},
    mcpPermissions: {},
    agentQuestions: {},
    resolution: null,
    motionOn: true,
    theme: 'dark',
    skin: 'prism',
    focus: null,
    quickNoteOpen: false,
    persistenceError: null
  }
}
