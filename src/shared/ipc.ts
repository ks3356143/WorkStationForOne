/**
 * preload 桥的类型契约。
 * 按域拆分后仍从这个入口统一导出，调用方不要改成深路径 import。
 */
import type { WsApi } from './ipc/ws-api'

export { APPROVAL_SCOPES } from './approval-rules'
export type { ApprovalAgent, ApprovalScope } from './approval-rules'
export type {
  AgentQuestion,
  AgentQuestionOption,
  AgentQuestionRequest
} from './agent-stream'
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
  NoteTagCount,
  NoteTags,
  NotePatch,
  NoteLinkStatus,
  NoteLinkRef,
  NoteLinks,
  NoteGraphNode,
  NoteGraphEdge,
  NoteGraph,
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
  AgentSessionSummary,
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
  AgentQuestionResponse,
  AgentAttention,
  AgentEventEnvelope,
  DiscoveredAgentSession,
  AgentImportInput,
  AgentImportResult,
  AgentForkInput,
  AgentForkResult,
  AgentPresetRecord,
  AgentPresetInput,
  AgentCheckpointFile,
  AgentCheckpointRecord,
  AgentCheckpointFileView,
  AgentCheckpointView,
  AgentRollbackResult,
  AgentImageRef,
  AgentImageInput,
  AgentRunRecord,
  AgentTeamNoteRecord,
  AgentTeamSummary,
  AgentTeamCreateInput,
  LocalModelConfig,
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
  ToolSurfaceNativeRecord,
  ToolSurfaceMcpRecord,
  ToolSurfaceSkillRecord,
  ToolSurfaceRecord,
  ToolSurfaceBundle,
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
  CliRuntimeState,
  CliRuntimeUpdate,
  CapabilityApi
} from './ipc/capability'
export type { AuditLogDomain, AuditLogRecord, AuditApi } from './ipc/audit'
export type {
  ExpertRecord,
  ExpertSaveInput,
  ExpertSourceRecord,
  ExpertSourceInput,
  ExpertMarketEntry,
  ExpertActivateResult,
  ExpertMarketApi,
  ExpertApi
} from './ipc/experts'
export type { PromptTemplateRecord, PromptTemplateInput, PromptApi } from './ipc/prompts'
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
  'experts',
  'prompts',
  'audit',
  'app'
] as const satisfies readonly (keyof WsApi)[]
