import type { AgentApi } from './agent'
import type { AppApi } from './app'
import type { AuditApi } from './audit'
import type { CapabilityApi } from './capability'
import type { ExpertApi } from './experts'
import type { HabitApi } from './habits'
import type { LearningApi } from './learning'
import type { McpApi } from './mcp'
import type { CaptureApi, NoteApi } from './notes'
import type { ProviderApi } from './agent'
import type { ReminderApi } from './reminders'
import type { TaskApi } from './tasks'

export interface WsApi {
  provider: ProviderApi
  tasks: TaskApi
  reminders: ReminderApi
  notes: NoteApi
  capture: CaptureApi
  learning: LearningApi
  habits: HabitApi
  agent: AgentApi
  mcp: McpApi
  capability: CapabilityApi
  experts: ExpertApi
  audit: AuditApi
  app: AppApi
}
