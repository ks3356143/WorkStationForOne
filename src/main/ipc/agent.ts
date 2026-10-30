import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import type { AgentCli } from '../agent/claude'
import { startClaudeRun } from '../agent/claude'
import type { ApprovalRuleService } from '../agent/approval-rules'
import { discoverLocalSessions } from '../agent/discover'
import { readSessionHistory } from '../agent/history'
import { listWorkspaceEntries, readWorkspaceText } from '../agent/workspace'
import { startCodexAppServerRun } from '../agent/codex-app-server'
import { startCodexRun } from '../agent/codex'
import type { AgentRepository } from '../db/agent'
import type { McpEndpoint } from '../mcp/server'
import type { ProviderRuntime } from '../providers'
import type { AgentCapabilityRuntime } from '../capabilities'
import type { ProviderTarget } from '../../shared/ipc'
import {
  IPC_CHANNELS,
  type AgentCreateInput,
  type AgentImportInput,
  type AgentImportResult,
  type AgentMessageRecord,
  type AgentPermissionResponse,
  type AgentPresetInput,
  type AgentSendInput,
  type AgentSessionPatch,
  type AgentToolRecord
} from '../../shared/ipc'
import type { AgentRunEvent } from '../../shared/agent-stream'
import { APPROVAL_SCOPES, type ApprovalScope } from '../../shared/approval-rules'

const IPC = IPC_CHANNELS
const MAX_PROMPT = 20_000
const MAX_ID = 120
const MAX_TITLE = 80
const MAX_TIME_LABEL = 40
const MAX_TOOLS = 50
const MAX_TOOL_TEXT = 120
const MAX_WORKSPACE = 1000

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
    agent: assertAgentKind(input.agent),
    prompt: trimmed
  }
  if (input.resumeId !== undefined) result.resumeId = assertId(input.resumeId, '续接会话 id')
  return result
}

function assertAgentKind(value: unknown): 'claude' | 'codex' {
  if (value !== 'claude' && value !== 'codex') throw new TypeError('Agent 类型无效')
  return value
}

export function assertImportInput(value: unknown): AgentImportInput {
  if (typeof value !== 'object' || value === null) throw new TypeError('导入会话必须是对象')
  const input = value as Record<string, unknown>
  const resumeId = assertId(input.resumeId, '本机会话 id')
  const rawTitle = typeof input.title === 'string' ? input.title.trim() : ''
  const title = (rawTitle || '导入的会话').slice(0, 80)
  return {
    agent: assertAgentKind(input.agent),
    resumeId,
    title,
    workspace: assertWorkspacePath(input.workspace)
  }
}

export function assertPresetInput(value: unknown): AgentPresetInput {
  if (typeof value !== 'object' || value === null) throw new TypeError('预设必须是对象')
  const input = value as Record<string, unknown>
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
  if (patch.workspace !== undefined) result.workspace = assertWorkspacePath(patch.workspace)
  if (Object.keys(result).length === 0) throw new TypeError('会话补丁没有可更新字段')
  return result
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
  if (typeof value !== 'object' || value === null) throw new TypeError('审批响应必须是对象')
  const input = value as Record<string, unknown>
  if (typeof input.allow !== 'boolean') throw new TypeError('审批结果无效')
  const result: AgentPermissionResponse = {
    requestId: assertId(input.requestId, '审批请求 id'),
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
  agent: 'claude' | 'codex'
  workspace: string
  cancel: () => void
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => boolean
}

export interface McpAccess {
  issue: (sessionId: string) => McpEndpoint | null
  revoke: (token: string) => void
}

export interface AgentHandlerOptions {
  getWindow: () => BrowserWindow | null
  repository: AgentRepository
  cli?: AgentCli | null
  getProvider?: (target: ProviderTarget) => ProviderRuntime | undefined
  codexCli?: AgentCli | null
  mcp?: McpAccess | null
  cancelPermissions?: (sessionId: string) => void
  codexHome?: string
  capabilities?: AgentCapabilityRuntime
  approvalRules: ApprovalRuleService
}

/**
 * 每个会话同一时间只跑一轮，不同会话可以各跑各的。
 * 流事件、审批与 MCP Token 都按 run / 会话隔离，互不串台。
 */
export function registerAgentHandlers(options: AgentHandlerOptions): void {
  const {
    getWindow,
    repository,
    cli,
    getProvider,
    codexCli,
    mcp,
    cancelPermissions,
    codexHome,
    capabilities,
    approvalRules
  } = options
  const runs = new Map<string, ActiveRun>()
  // Codex app-server 与 stub 的审批 id 只在各自进程内唯一；加 run 前缀后才不会串台
  const permissionRuns = new Map<string, { runId: string; requestId: string; toolName: string }>()
  let seq = 0

  ipcMain.handle(IPC.agentThreads, () => ({
    sessions: repository.listSessions(),
    messages: repository.listMessages()
  }))

  ipcMain.handle(IPC.agentPickWorkspace, async (_event, current: unknown) => {
    // 自动化测试缝：跳过原生对话框，但仍走同一套目录校验。
    const forced = process.env.WS_PICK_WORKSPACE?.trim()
    if (forced) return assertWorkspacePath(forced)
    const win = getWindow()
    const defaultPath =
      typeof current === 'string' && current && isAbsolute(current)
        ? current
        : app.getPath('documents')
    const options: OpenDialogOptions = {
      title: '选择 Agent 工作区',
      defaultPath,
      properties: ['openDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return assertWorkspacePath(result.filePaths[0])
  })

  const workspaceFor = (sessionId: unknown): string => {
    const session = repository.findSession(assertId(sessionId, '会话 id'))
    if (!session) throw new Error('会话不存在')
    if (!session.workspace) throw new Error('会话还没有选择工作区')
    return assertWorkspacePath(session.workspace)
  }

  ipcMain.handle(IPC.agentWorkspaceTree, (_event, sessionId: unknown) =>
    listWorkspaceEntries(workspaceFor(sessionId))
  )

  ipcMain.handle(IPC.agentWorkspaceFile, (_event, sessionId: unknown, path: unknown) => {
    const workspace = workspaceFor(sessionId)
    if (typeof path !== 'string' || path.length > MAX_WORKSPACE) {
      throw new TypeError('文件路径无效')
    }
    return readWorkspaceText(workspace, path)
  })

  ipcMain.handle(IPC.agentOpenWorkspace, async (_event, sessionId: unknown) => {
    const error = await shell.openPath(workspaceFor(sessionId))
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC.agentPresets, () => repository.listPresets())

  ipcMain.handle(IPC.agentSavePreset, (_event, value: unknown) =>
    repository.savePreset(assertPresetInput(value))
  )

  ipcMain.handle(IPC.agentRemovePreset, (_event, id: unknown) => {
    repository.removePreset(assertId(id, '预设 id'))
  })

  ipcMain.handle(IPC.agentUsage, (_event, days: unknown) => {
    const value = typeof days === 'number' && Number.isFinite(days) ? Math.trunc(days) : 7
    const span = Math.min(90, Math.max(1, value))
    return repository.listRuns(Date.now() - span * 24 * 60 * 60 * 1000)
  })

  ipcMain.handle(IPC.agentApprovalRules, () => approvalRules.list())

  ipcMain.handle(IPC.agentRemoveApprovalRule, (_event, id: unknown) => {
    approvalRules.remove(assertId(id, '规则 id'))
  })

  ipcMain.handle(IPC.agentDiscoverSessions, () => {
    const existing = new Set(
      repository
        .listSessions()
        .filter((session) => session.resumeId)
        .map((session) => `${session.agent}:${session.resumeId}`)
    )
    return discoverLocalSessions(
      app.getPath('home'),
      existing,
      process.env.WS_SESSION_SCAN_ROOT?.trim() || undefined
    )
  })

  ipcMain.handle(IPC.agentImportSession, (_event, value): AgentImportResult => {
    const input = assertImportInput(value)
    let session = repository
      .listSessions()
      .find((item) => item.agent === input.agent && item.resumeId === input.resumeId)
    if (!session) {
      const id = `s-${randomUUID()}`
      repository.createSession({ id, agent: input.agent, title: input.title })
      const updated = repository.updateSession(id, {
        workspace: input.workspace,
        resumeId: input.resumeId
      })
      if (!updated) throw new Error('导入会话保存失败')
      session = updated
    }
    const history = readSessionHistory({
      sessionId: session.id,
      agent: input.agent,
      resumeId: input.resumeId,
      home: app.getPath('home'),
      scanRoot: process.env.WS_SESSION_SCAN_ROOT?.trim() || undefined
    })
    if (history.length > 0) repository.importMessages(session.id, history)
    return {
      session: repository.findSession(session.id) ?? session,
      messages: repository.listMessagesForSession(session.id)
    }
  })

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
    for (const run of runs.values()) {
      if (run.sessionId === input.sessionId) {
        throw new Error('这个会话还在进行中，先等待完成')
      }
    }
    const session = repository.findSession(input.sessionId)
    if (!session) throw new Error('会话不存在')
    if (session.agent !== input.agent) throw new Error('会话类型不匹配')
    if (!session.workspace) throw new Error('请先为会话选择工作区')
    const workspace = assertWorkspacePath(session.workspace)
    seq += 1
    const runId = `run-${seq}`
    let runResult: Extract<AgentRunEvent, { kind: 'result' }> | null = null
    repository.recordRunStart(runId, input.sessionId, Date.now())

    const emit = (runEvent: AgentRunEvent) => {
      let event = runEvent
      if (runEvent.kind === 'result') runResult = runEvent
      if (runEvent.kind === 'permission') {
        const scoped = `${runId}:${runEvent.request.requestId}`
        permissionRuns.set(scoped, {
          runId,
          requestId: runEvent.request.requestId,
          toolName: runEvent.request.toolName
        })
        event = {
          ...runEvent,
          request: {
            ...runEvent.request,
            requestId: scoped,
            workspaceScope: approvalRules.isWorkspaceEligible(
              input.agent,
              runEvent.request.toolName
            )
          }
        }
      }
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC.agentEvent, { runId, event })
    }

    const codexProvider = input.agent === 'codex' ? getProvider?.('codex') : undefined
    const codexServer = Boolean(codexProvider && codexHome)
    let codexExternalMcp: ReturnType<AgentCapabilityRuntime['codexMcp']> | undefined
    if (input.agent === 'codex' && codexProvider && codexHome && capabilities) {
      try {
        codexExternalMcp = capabilities.codexMcp()
      } catch (error) {
        const detail = error instanceof Error ? error.message : '读取 Codex 外部 MCP 配置失败'
        throw new Error(`无法加载 Codex 外部 MCP：${detail}`)
      }
    }
    const mcpEndpoint =
      input.agent === 'claude' || codexServer ? (mcp?.issue(input.sessionId) ?? null) : null
    let claudePlugins: string[] = []
    let claudeMcpServers: ReturnType<AgentCapabilityRuntime['mcpServers']> = []
    let claudeAllowedTools: string[] = []
    let claudeDeniedTools: string[] = []
    if (input.agent === 'claude' && capabilities) {
      try {
        claudePlugins = capabilities.pluginDirs()
        claudeMcpServers = capabilities.mcpServers()
        const policy = capabilities.toolPolicy()
        claudeAllowedTools = policy.allowed
        claudeDeniedTools = policy.denied
      } catch (error) {
        const detail = error instanceof Error ? error.message : '读取能力中心配置失败'
        throw new Error(`无法加载应用私有技能 / MCP：${detail}`)
      }
    }
    const onExit = ({
      code,
      stderr,
      cancelled
    }: {
      code: number | null
      stderr: string
      cancelled: boolean
    }) => {
      runs.delete(runId)
      if (mcpEndpoint) mcp?.revoke(mcpEndpoint.token)
      cancelPermissions?.(input.sessionId)
      for (const [requestId, owner] of permissionRuns) {
        if (owner.runId === runId) permissionRuns.delete(requestId)
      }
      repository.finishRun(runId, {
        ok: !cancelled && (runResult?.ok ?? code === 0),
        cancelled,
        ...(runResult?.costUsd !== undefined ? { costUsd: runResult.costUsd } : {}),
        ...(runResult?.durationMs !== undefined ? { durationMs: runResult.durationMs } : {}),
        ...(runResult?.turns !== undefined ? { turns: runResult.turns } : {})
      })
      if (cancelled) {
        emit({ kind: 'error', message: '已取消' })
        return
      }
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/).at(-1) ?? ''
        emit({ kind: 'error', message: detail || `CLI 退出码 ${code}` })
      }
    }

    const autoApprove = (toolName: string) =>
      approvalRules.check({ sessionId: input.sessionId, agent: input.agent, workspace }, toolName)

    const handle =
      input.agent === 'codex'
        ? (() => {
            // 自定义 Provider 用 app-server 的工作区审批模式；继承 CLI 时仍走
            // exec 只读，避免为了写入去读改用户自己的 ~/.codex 配置。
            if (codexProvider && codexHome) {
              return startCodexAppServerRun({
                prompt: input.prompt,
                ...(input.resumeId ? { resumeId: input.resumeId } : {}),
                cwd: workspace,
                provider: codexProvider,
                home: codexHome,
                autoApprove,
                ...(mcpEndpoint ? { mcp: mcpEndpoint } : {}),
                ...(codexExternalMcp && codexExternalMcp.servers.length > 0
                  ? { externalMcp: codexExternalMcp }
                  : {}),
                clientVersion: app.getVersion(),
                ...(codexCli === undefined ? {} : { cli: codexCli }),
                onEvent: emit,
                onExit
              })
            }
            return startCodexRun({
              prompt: input.prompt,
              ...(input.resumeId ? { resumeId: input.resumeId } : {}),
              cwd: workspace,
              ...(codexProvider ? { provider: codexProvider } : {}),
              ...(codexHome ? { home: codexHome } : {}),
              ...(codexCli === undefined ? {} : { cli: codexCli }),
              onEvent: emit,
              onExit
            })
          })()
        : (() => {
            const provider = getProvider?.('claude')
            return startClaudeRun({
              prompt: input.prompt,
              resumeId: input.resumeId,
              cwd: workspace,
              autoApprove,
              ...(provider ? { provider } : {}),
              ...(mcpEndpoint ? { mcp: mcpEndpoint } : {}),
              ...(claudePlugins.length > 0 ? { plugins: claudePlugins } : {}),
              ...(claudeMcpServers.length > 0 ? { mcpServers: claudeMcpServers } : {}),
              ...(claudeAllowedTools.length > 0 ? { allowedTools: claudeAllowedTools } : {}),
              ...(claudeDeniedTools.length > 0 ? { disallowedTools: claudeDeniedTools } : {}),
              ...(cli === undefined ? {} : { cli }),
              onEvent: emit,
              onExit
            })
          })()

    runs.set(runId, {
      sessionId: input.sessionId,
      agent: input.agent,
      workspace,
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
    const owner = permissionRuns.get(response.requestId)
    const run = owner ? runs.get(owner.runId) : undefined
    if (!owner || !run) return false

    const scope = response.allow ? (response.scope ?? 'once') : 'once'
    if (
      response.allow &&
      scope === 'workspace' &&
      !approvalRules.isWorkspaceEligible(run.agent, owner.toolName)
    ) {
      throw new TypeError('该工具不支持工作区持久规则')
    }
    if (response.allow && scope === 'workspace') {
      try {
        approvalRules.grantWorkspace(
          { sessionId: run.sessionId, agent: run.agent, workspace: run.workspace },
          owner.toolName
        )
      } catch (error) {
        console.error('[agent] 保存审批规则失败', error)
      }
    }
    if (response.allow && scope === 'session') {
      approvalRules.grantSession(
        { sessionId: run.sessionId, agent: run.agent, workspace: run.workspace },
        owner.toolName
      )
    }

    const ok = run.respondPermission(
      owner.requestId,
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
  assertImportInput,
  assertPermissionResponse,
  assertPresetInput,
  assertWorkspacePath
} as const
