import { isAbsolute } from 'node:path'
import { statSync } from 'node:fs'
import { APPROVAL_SCOPES, type ApprovalScope } from '../../shared/approval-rules'
import type {
  AgentCreateInput,
  AgentImportInput,
  AgentMessageRecord,
  AgentPermissionResponse,
  AgentPresetInput,
  AgentSendInput,
  AgentSessionPatch,
  AgentToolRecord
} from '../../shared/ipc'
import { assertId, assertNotEmpty, assertRecord } from '../validate'

const MAX_PROMPT = 20_000
const MAX_ID = 120
const MAX_TITLE = 80
const MAX_TIME_LABEL = 40
const MAX_TOOLS = 50
const MAX_TOOL_TEXT = 120
const MAX_WORKSPACE = 1000

export const assertAgentId = (value: unknown, label: string) => assertId(value, label, MAX_ID)

export function assertAgentSendInput(value: unknown): AgentSendInput {
  const input = assertRecord(value, 'Agent 请求')
  const prompt = input.prompt
  if (typeof prompt !== 'string') throw new TypeError('提示词无效')
  const trimmed = prompt.trim()
  if (!trimmed) throw new TypeError('提示词不能为空')
  if (trimmed.length > MAX_PROMPT) throw new TypeError('提示词过长')
  const result: AgentSendInput = {
    sessionId: assertAgentId(input.sessionId, '会话 id'),
    agent: assertAgentKind(input.agent),
    prompt: trimmed
  }
  if (input.resumeId !== undefined) result.resumeId = assertAgentId(input.resumeId, '续接会话 id')
  return result
}

function assertAgentKind(value: unknown): 'claude' | 'codex' {
  if (value !== 'claude' && value !== 'codex') throw new TypeError('Agent 类型无效')
  return value
}

export function assertImportInput(value: unknown): AgentImportInput {
  const input = assertRecord(value, '导入会话')
  const resumeId = assertAgentId(input.resumeId, '本机会话 id')
  const rawTitle = typeof input.title === 'string' ? input.title.trim() : ''
  const title = (rawTitle || '导入的会话').slice(0, 80)
  return {
    agent: assertAgentKind(input.agent),
    resumeId,
    title,
    workspace: assertWorkspacePath(input.workspace)
  }
}

export function assertAgentForkInput(value: unknown): { sessionId: string; messageId: string } {
  const input = assertRecord(value, '分叉会话')
  return {
    sessionId: assertAgentId(input.sessionId, '会话 id'),
    messageId: assertAgentId(input.messageId, '消息 id')
  }
}

export function assertPresetInput(value: unknown): AgentPresetInput {
  const input = assertRecord(value, '预设')
  if (typeof input.name !== 'string') throw new TypeError('预设名称无效')
  const name = input.name.trim()
  if (!name || name.length > 80) throw new TypeError('预设名称无效')
  return {
    name,
    agent: assertAgentKind(input.agent),
    workspace: assertWorkspacePath(input.workspace)
  }
}

function assertSessionStatus(value: unknown): 'run' | 'wait' | 'idle' {
  if (value !== 'run' && value !== 'wait' && value !== 'idle') {
    throw new TypeError('会话状态无效')
  }
  return value
}

function assertTitle(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('会话标题无效')
  const title = value.trim()
  if (!title) throw new TypeError('会话标题不能为空')
  if (title.length > MAX_TITLE) throw new TypeError('会话标题过长')
  return title
}

export function assertAgentCreateInput(value: unknown): AgentCreateInput {
  const input = assertRecord(value, '会话')
  return {
    id: assertAgentId(input.id, '会话 id'),
    agent: assertAgentKind(input.agent),
    title: assertTitle(input.title)
  }
}

export function assertAgentSessionPatch(value: unknown): AgentSessionPatch {
  const patch = assertRecord(value, '会话补丁')
  const result: AgentSessionPatch = {}
  if (patch.title !== undefined) result.title = assertTitle(patch.title)
  if (patch.status !== undefined) result.status = assertSessionStatus(patch.status)
  if (patch.resumeId !== undefined) result.resumeId = assertAgentId(patch.resumeId, '续接会话 id')
  if (patch.workspace !== undefined) result.workspace = assertWorkspacePath(patch.workspace)
  if (patch.pinned !== undefined) {
    if (typeof patch.pinned !== 'boolean') throw new TypeError('置顶状态无效')
    result.pinned = patch.pinned
  }
  if (patch.archived !== undefined) {
    if (typeof patch.archived !== 'boolean') throw new TypeError('归档状态无效')
    result.archived = patch.archived
  }
  return assertNotEmpty(result, '会话补丁')
}

/** 工作区必须是存在的绝对目录；不允许相对路径或文件。 */
export function assertWorkspacePath(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('工作区路径无效')
  const workspace = value.trim()
  if (!workspace) throw new TypeError('工作区路径不能为空')
  if (workspace.length > MAX_WORKSPACE) throw new TypeError('工作区路径过长')
  if (!isAbsolute(workspace)) throw new TypeError('工作区必须是绝对路径')
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(workspace)
  } catch {
    throw new TypeError('工作区不存在，请重新选择')
  }
  if (!stat.isDirectory()) throw new TypeError('工作区必须是目录')
  return workspace
}

export function assertPermissionResponse(value: unknown): AgentPermissionResponse {
  const input = assertRecord(value, '审批响应')
  if (typeof input.allow !== 'boolean') throw new TypeError('审批结果无效')
  const result: AgentPermissionResponse = {
    requestId: assertAgentId(input.requestId, '审批请求 id'),
    allow: input.allow
  }
  if (input.allow === true && input.scope !== undefined) {
    if (
      typeof input.scope !== 'string' ||
      !(APPROVAL_SCOPES as readonly string[]).includes(input.scope)
    ) {
      throw new TypeError('审批作用域无效')
    }
    result.scope = input.scope as ApprovalScope
  }
  if (input.message !== undefined) {
    if (typeof input.message !== 'string') throw new TypeError('拒绝原因无效')
    const message = input.message.trim()
    if (message.length > 500) throw new TypeError('拒绝原因过长')
    if (message) result.message = message
  }
  return result
}

function assertTools(value: unknown): AgentToolRecord[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new TypeError('工具记录必须是数组')
  if (value.length > MAX_TOOLS) throw new TypeError('工具记录过多')
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw new TypeError('工具记录无效')
    const tool = entry as Record<string, unknown>
    const name = typeof tool.name === 'string' ? tool.name.trim() : ''
    const meta = typeof tool.meta === 'string' ? tool.meta.trim() : ''
    const status = typeof tool.status === 'string' ? tool.status.trim() : ''
    if (!name || name.length > MAX_TOOL_TEXT) throw new TypeError('工具名称无效')
    if (meta.length > MAX_TOOL_TEXT) throw new TypeError('工具详情过长')
    if (!status || status.length > MAX_TIME_LABEL) throw new TypeError('工具状态无效')
    const record: AgentToolRecord = { name, meta, status }
    if (tool.id !== undefined) record.id = assertAgentId(tool.id, '工具 id')
    return record
  })
}

export function assertAgentMessage(value: unknown): AgentMessageRecord {
  const message = assertRecord(value, '消息')
  if (message.role !== 'user' && message.role !== 'assistant') {
    throw new TypeError('消息角色无效')
  }
  if (typeof message.text !== 'string') throw new TypeError('消息正文无效')
  if (message.text.length > MAX_PROMPT) throw new TypeError('消息正文过长')
  if (typeof message.timeLabel !== 'string') throw new TypeError('消息时间无效')
  if (message.timeLabel.length > MAX_TIME_LABEL) throw new TypeError('消息时间过长')
  if (typeof message.createdAt !== 'number' || !Number.isFinite(message.createdAt)) {
    throw new TypeError('消息创建时间无效')
  }
  if (message.error !== undefined && typeof message.error !== 'boolean') {
    throw new TypeError('消息错误标记无效')
  }
  const result: AgentMessageRecord = {
    id: assertAgentId(message.id, '消息 id'),
    sessionId: assertAgentId(message.sessionId, '会话 id'),
    role: message.role,
    text: message.text,
    timeLabel: message.timeLabel,
    createdAt: Math.trunc(message.createdAt)
  }
  if (message.error === true) result.error = true
  const tools = assertTools(message.tools)
  if (tools) result.tools = tools
  return result
}
