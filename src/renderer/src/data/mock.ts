import type { WorkstationData } from '../types'
import { createSeedHabits } from './seed/habits'
import { createSeedNotes } from './seed/notes'
import { createSeedPermission } from './seed/permission'
import { createSeedSessions, createSeedThreads } from './seed/sessions'
import { createSeedTasks } from './seed/tasks'

export function createInitialData(): WorkstationData {
  return {
    tasks: createSeedTasks(),
    taskFilter: 'all',
    habits: createSeedHabits(),
    notes: createSeedNotes(),
    sessions: createSeedSessions(),
    activeSessionId: 's-c1',
    threads: createSeedThreads(),
    typing: false,
    pendingReplyTo: null,
    permission: createSeedPermission(),
    resolution: null,
    motionOn: true,
    theme: 'dark',
    focus: null,
    quickNoteOpen: false,
    notesViewOpen: false
  }
}
