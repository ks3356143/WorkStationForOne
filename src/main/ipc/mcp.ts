import { ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  MCP_DOMAINS,
  type AuditLogDomain,
  type McpDomain,
  type McpMode,
  type McpPolicyRecord
} from '../../shared/ipc'
import type { AuditLog } from '../db/audit'
import type { McpPolicyRepository } from '../db/mcp'

const IPC = IPC_CHANNELS
const AUDIT_DOMAINS: AuditLogDomain[] = ['task', 'note', 'learning', 'habit', 'mcp', 'system']

function assertDomain(value: unknown): McpDomain {
  if (typeof value !== 'string' || !(MCP_DOMAINS as readonly string[]).includes(value)) {
    throw new TypeError('MCP 域无效')
  }
  return value as McpDomain
}

function assertMode(value: unknown): McpMode {
  if (value !== 'read' && value !== 'write') throw new TypeError('MCP 权限模式无效')
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

export function registerMcpHandlers(policy: McpPolicyRepository, audit: AuditLog): void {
  ipcMain.handle(IPC.mcpPolicyList, (): McpPolicyRecord[] => policy.list())
  ipcMain.handle(IPC.mcpPolicySet, (_event, domain: unknown, mode: unknown) =>
    policy.set(assertDomain(domain), assertMode(mode))
  )
  ipcMain.handle(IPC.auditRecent, (_event, limit: unknown, domain: unknown) =>
    audit.recent(assertLimit(limit), assertAuditDomain(domain))
  )
}

export const registerMcpHandlersIPC = {
  assertDomain,
  assertMode,
  assertAuditDomain,
  assertLimit
} as const
