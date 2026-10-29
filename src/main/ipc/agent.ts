import { ipcMain, type BrowserWindow } from 'electron'
import type { AgentCli } from '../agent/claude'
import { startClaudeRun } from '../agent/claude'
import type { AgentRepository } from '../db/agent'
import {
  IPC_CHANNELS,
  type AgentCreateInput,
  type AgentMessageRecord,
  type AgentPermissionResponse,
  type AgentSendInput,
  type AgentSessionPatch,
  type AgentToolRecord
} from '../../shared/ipc'
import type { AgentRunEvent } from '../../shared/agent-stream'

const IPC = IPC_CHANNELS
const MAX_PROMPT = 20_000
const MAX_ID = 120
const MAX_TITLE = 80
const MAX_TIME_LABEL = 40
const MAX_TOOLS = 50
const MAX_TOOL_TEXT = 120

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID) {
    throw new TypeError(`${label}无效`)
  }
  return value
}

export function assertAgentSendInput(value: unknown): AgentSendInput {
  if (typeof value !== 'object' || value === null) throw new TypeError('Agent 请求必须是对象')
  const input = value as Record<string, unknown>
  const prompt = input.prompt
  if (typeof prompt !== 'string') throw new TypeError('提示词无效')
  const trimmed = prompt.trim()
  if (!trimmed) throw new TypeError('提示词不能为空')
  if (trimmed.length > MAX_PROMPT) throw new TypeError('提示词过长')
  const result: AgentSendInput = {
    sessionId: assertId(input.sessionId, '会话 id'),
    prompt: trimmed
  }
  if (input.resumeId !== undefined) result.resumeId = assertId(input.resumeId, '续接会话 id')
  return result
}

function assertAgentKind(value: unknown): 'claude' | 'codex' {
  if (value !== 'claude' && value !== 'codex') throw new TypeError('Agent 类型无效')
  return value
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
  if (typeof value !== 'object' || value === null) throw new TypeError('会话必须是对象')
  const input = value as Record<string, unknown>
  return {
    id: assertId(input.id, '会话 id'),
    agent: assertAgentKind(input.agent),
    title: assertTitle(input.title)
  }
}

export function assertAgentSessionPatch(value: unknown): AgentSessionPatch {
  if (typeof value !== 'object' || value === null) throw new TypeError('会话补丁必须是对象')
  const patch = value as Record<string, unknown>
  const result: AgentSessionPatch = {}
  if (patch.title !== undefined) result.title = assertTitle(patch.title)
  if (patch.status !== undefined) result.status = assertSessionStatus(patch.status)
  if (patch.resumeId !== undefined) result.resumeId = assertId(patch.resumeId, '续接会话 id')
  if (Object.keys(result).length === 0) throw new TypeError('会话补丁没有可更新字段')
  return result
}

export function assertPermissionResponse(value: unknown): AgentPermissionResponse {
  if (typeof value !== 'object' || value === null) throw new TypeError('审批响应必须是对象')
  const input = value as Record<string, unknown>
  if (typeof input.allow !== 'boolean') throw new TypeError('审批结果无效')
  const result: AgentPermissionResponse = {
    requestId: assertId(input.requestId, '审批请求 id'),
    allow: input.allow
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
    if (tool.id !== undefined) record.id = assertId(tool.id, '工具 id')
    return record
  })
}

export function assertAgentMessage(value: unknown): AgentMessageRecord {
  if (typeof value !== 'object' || value === null) throw new TypeError('消息必须是对象')
  const message = value as Record<string, unknown>
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
    id: assertId(message.id, '消息 id'),
    sessionId: assertId(message.sessionId, '会话 id'),
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

interface ActiveRun {
  sessionId: string
  cancel: () => void
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => boolean
}

/**
 * 当前只支持一个并发回合：Agent 视图一次只跟一个会话说话，
 * 多开会话的排队与并发留给后续版本，避免 v1 出现交叉写入。
 */
export function registerAgentHandlers(
  getWindow: () => BrowserWindow | null,
  repository: AgentRepository,
  cli?: AgentCli | null
): void {
  const runs = new Map<string, ActiveRun>()
  const permissionRuns = new Map<string, string>()
  let seq = 0

  ipcMain.handle(IPC.agentThreads, () => ({
    sessions: repository.listSessions(),
    messages: repository.listMessages()
  }))

  ipcMain.handle(IPC.agentCreateSession, (_event, value: unknown) =>
    repository.createSession(assertAgentCreateInput(value))
  )

  ipcMain.handle(IPC.agentUpdateSession, (_event, id: unknown, value: unknown) => {
    const updated = repository.updateSession(
      assertId(id, '会话 id'),
      assertAgentSessionPatch(value)
    )
    if (!updated) throw new Error('会话不存在')
  })

  ipcMain.handle(IPC.agentSaveMessage, (_event, value: unknown) => {
    repository.saveMessage(assertAgentMessage(value))
  })

  ipcMain.handle(IPC.agentSend, (_event, value: unknown) => {
    const input = assertAgentSendInput(value)
    if (runs.size > 0) throw new Error('上一轮还在进行中，先取消或等待完成')
    seq += 1
    const runId = `run-${seq}`

    const emit = (runEvent: AgentRunEvent) => {
      if (runEvent.kind === 'permission') {
        permissionRuns.set(runEvent.request.requestId, runId)
      }
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC.agentEvent, { runId, event: runEvent })
    }

    const handle = startClaudeRun({
      prompt: input.prompt,
      resumeId: input.resumeId,
      cwd: process.cwd(),
      ...(cli === undefined ? {} : { cli }),
      onEvent: emit,
      onExit: ({ code, stderr, cancelled }) => {
        runs.delete(runId)
        for (const [requestId, owner] of permissionRuns) {
          if (owner === runId) permissionRuns.delete(requestId)
        }
        if (cancelled) {
          emit({ kind: 'error', message: '已取消' })
          return
        }
        if (code !== 0) {
          const detail = stderr.trim().split(/\r?\n/).at(-1) ?? ''
          emit({ kind: 'error', message: detail || `CLI 退出码 ${code}` })
        }
      }
    })

    runs.set(runId, {
      sessionId: input.sessionId,
      cancel: handle.cancel,
      respondPermission: handle.respondPermission
    })
    return { runId }
  })

  ipcMain.handle(IPC.agentCancel, (_event, runId: unknown) => {
    const id = assertId(runId, '运行 id')
    runs.get(id)?.cancel()
    runs.delete(id)
  })

  ipcMain.handle(IPC.agentPermissionResponse, (_event, value: unknown) => {
    const response = assertPermissionResponse(value)
    const runId = permissionRuns.get(response.requestId)
    const run = runId ? runs.get(runId) : undefined
    if (!run) return false
    const ok = run.respondPermission(
      response.requestId,
      response.allow ? 'allow' : 'deny',
      response.message
    )
    permissionRuns.delete(response.requestId)
    return ok
  })
}

export const registerAgentHandlersIPC = {
  assertAgentSendInput,
  assertAgentCreateInput,
  assertAgentSessionPatch,
  assertAgentMessage,
  assertPermissionResponse
} as const
