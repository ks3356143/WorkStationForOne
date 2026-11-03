/**
 * preload 桥的类型契约。
 * 按域拆分后仍从这个入口统一导出，调用方不要改成深路径 import。
 */
import type { WsApi } from './ipc/ws-api'

export { APPROVAL_SCOPES } from './approval-rules'
export type { ApprovalAgent, ApprovalScope } from './approval-rules'
export type { RepeatRule } from './repeat'

export type { Theme, Skin } from './ipc/app'
export type {
  TaskRecord,
  TaskDraft,
  TaskPatch,
  TaskScheduleChange,
  TaskApi,
  TaskTone,
  TaskPriority
} from './ipc/tasks'
export type { ReminderApi } from './ipc/reminders'
export type {
  NoteRecord,
  NotePage,
  NoteSearchHit,
  NotePatch,
  NoteLinkStatus,
  NoteLinkRef,
  NoteLinks,
  NoteApi,
  CaptureApi
} from './ipc/notes'
export type {
  LearningKind,
  LearningItemRecord,
  LearningDraft,
  LearningPatch,
  LearningRating,
  LearningReviewRecord,
  LearningImportResult,
  LearningExportResult,
  LearningApi
} from './ipc/learning'
export type { HabitRecord, HabitApi } from './ipc/habits'
export type {
  AgentKind,
  AgentSessionStatus,
  AgentToolRecord,
  AgentSessionRecord,
  AgentMessageRecord,
  AgentThreadBundle,
  AgentSessionSearchHit,
  AgentExportResult,
  AgentCreateInput,
  AgentSessionPatch,
  AgentSendInput,
  AgentRunStart,
  ProviderTarget,
  ProviderWireApi,
  ProviderProfileRecord,
  ProviderSaveInput,
  ProviderTestInput,
  ProviderTestResult,
  ProviderModelsInput,
  ProviderModelsResult,
  ProviderApi,
  ApprovalRuleRecord,
  AgentPermissionResponse,
  AgentEventEnvelope,
  DiscoveredAgentSession,
  AgentImportInput,
  AgentImportResult,
  AgentForkInput,
  AgentForkResult,
  AgentPresetRecord,
  AgentPresetInput,
  AgentRunRecord,
  WorkspaceEntry,
  WorkspaceFile,
  AgentApi
} from './ipc/agent'
export { MCP_DOMAINS, MCP_DEFAULT_MODES } from './ipc/mcp'
export type {
  McpDomain,
  McpMode,
  McpPolicyRecord,
  McpPermissionRequest,
  McpPermissionDecision,
  McpPermissionResponse,
  McpApi
} from './ipc/mcp'
export { EXTERNAL_MCP_TARGETS } from './ipc/capability'
export type {
  BuiltinToolRecord,
  SkillRecord,
  PluginAgent,
  PluginSourceKind,
  PluginSourceRecord,
  UpdateCandidateRecord,
  LocalMarketplaceRecord,
  LocalPluginRecord,
  InstalledPluginRecord,
  LocalScanRecord,
  SkillMarketEntry,
  SkillMarketSnapshot,
  SkillInspection,
  SkillApi,
  ExternalMcpTransport,
  McpToolApproval,
  ExternalMcpTargets,
  ExternalMcpAuthMode,
  ExternalMcpOAuthState,
  ExternalMcpOAuthInfo,
  ExternalMcpToolRecord,
  ExternalMcpServerRecord,
  McpImportResult,
  ExternalMcpSaveInput,
  ExternalMcpCatalogEntry,
  ExternalMcpUpdateInfo,
  ExternalMcpApi,
  EnvironmentCheckRecord,
  CapabilityApi
} from './ipc/capability'
export type { AuditLogDomain, AuditLogRecord, AuditApi } from './ipc/audit'
export type {
  BackupResult,
  BackupEntry,
  BackupList,
  RestoreStatus,
  RestoreStateInfo,
  RestoreRequestResult,
  AppInfo,
  StorageInfo,
  AppApi
} from './ipc/app'
export type { WsApi } from './ipc/ws-api'
export { IPC_CHANNELS } from './ipc/channels'

/** 桥的顶层分组；`runtime-verify.mjs` 会断言这个集合。 */
export const WS_API_KEYS = [
  'provider',
  'tasks',
  'notes',
  'capture',
  'learning',
  'habits',
  'agent',
  'mcp',
  'capability',
  'audit',
  'app'
] as const satisfies readonly (keyof WsApi)[]
