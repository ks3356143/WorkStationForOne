import { ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  MCP_DOMAINS,
  type AuditLogDomain,
  type McpDomain,
  type McpMode,
  type McpPermissionDecision,
  type McpPermissionResponse,
  type McpPolicyRecord
} from '../../shared/ipc'
import type { AuditLog } from '../db/audit'
import type { McpPolicyRepository } from '../db/mcp'

const IPC = IPC_CHANNELS
const MAX_ID = 120
const DECISIONS: McpPermissionDecision[] = ['once', 'session', 'workspace', 'deny']
const AUDIT_DOMAINS: AuditLogDomain[] = ['task', 'note', 'learning', 'habit', 'mcp', 'system']

function assertDomain(value: unknown): McpDomain {
  if (typeof value !== 'string' || !(MCP_DOMAINS as readonly string[]).includes(value)) {
    throw new TypeError('MCP 域无效')
  }
  return value as McpDomain
}

function assertMode(value: unknown): McpMode {
  if (value !== 'read' && value !== 'ask' && value !== 'write') {
    throw new TypeError('MCP 权限模式无效')
  }
  return value
}

function assertAuditDomain(value: unknown): AuditLogDomain | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !(AUDIT_DOMAINS as string[]).includes(value)) {
    throw new TypeError('审计域无效')
  }
  return value as AuditLogDomain
}

function assertLimit(value: unknown): number {
  if (value === undefined || value === null) return 50
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 200) {
    throw new TypeError('审计条数无效')
  }
  return value
}

export function assertPermissionResponse(value: unknown): McpPermissionResponse {
  if (typeof value !== 'object' || value === null) throw new TypeError('审批响应必须是对象')
  const input = value as Record<string, unknown>
  if (typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > MAX_ID) {
    throw new TypeError('审批请求 id 无效')
  }
  if (!DECISIONS.includes(input.decision as McpPermissionDecision)) {
    throw new TypeError('审批决定无效')
  }
  return {
    requestId: input.requestId,
    decision: input.decision as McpPermissionDecision
  }
}

export interface McpPermissionAccess {
  // 方法签名（不是函数属性）：broker 的 respond 目前只接受 once/session/deny，双变比较才能赋值
  respond(requestId: string, decision: McpPermissionDecision): boolean
}

export function registerMcpHandlers(
  policy: McpPolicyRepository,
  audit: AuditLog,
  permissions?: McpPermissionAccess
): void {
  ipcMain.handle(IPC.mcpPolicyList, (): McpPolicyRecord[] => policy.list())
  ipcMain.handle(IPC.mcpPolicySet, (_event, domain: unknown, mode: unknown) =>
    policy.set(assertDomain(domain), assertMode(mode))
  )
  ipcMain.handle(IPC.auditRecent, (_event, limit: unknown, domain: unknown) =>
    audit.recent(assertLimit(limit), assertAuditDomain(domain))
  )
  ipcMain.handle(IPC.mcpPermissionResponse, (_event, value: unknown) => {
    const response = assertPermissionResponse(value)
    return permissions?.respond(response.requestId, response.decision) ?? false
  })
}

export const registerMcpHandlersIPC = {
  assertDomain,
  assertMode,
  assertAuditDomain,
  assertLimit,
  assertPermissionResponse
} as const
