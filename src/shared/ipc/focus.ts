export type FocusKind = 'focus' | 'break'

export interface FocusRecord {
  id: string
  taskId: string | null
  label: string
  kind: FocusKind
  minutes: number
  startedAt: number
  completedAt: number | null
}

export interface FocusLogInput {
  taskId?: string | null
  label: string
  kind: FocusKind
  minutes: number
  startedAt: number
  completedAt?: number | null
}

export interface FocusApi {
  log: (input: FocusLogInput) => Promise<FocusRecord>
  recent: (days: number) => Promise<FocusRecord[]>
  taskMinutes: (taskId: string) => Promise<number>
}
