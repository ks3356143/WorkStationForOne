import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import type { AgentCli } from '../agent/claude'
import { startClaudeRun } from '../agent/claude'
import type { ApprovalRuleService } from '../agent/approval-rules'
import { discoverLocalSessions } from '../agent/discover'
import { readSessionHistory } from '../agent/history'
import { buildSessionMarkdown } from '../agent/export'
import { listWorkspaceEntries, readWorkspaceText } from '../agent/workspace'
import { startCodexAppServerRun } from '../agent/codex-app-server'
import { startCodexRun } from '../agent/codex'
import type { AgentRepository } from '../db/agent'
import type {
  McpEndpoint,
  McpExternalApprovalDecision,
  McpExternalApprovalInput
} from '../mcp/server'
import type { ProviderRuntime } from '../providers'
import type { AgentCapabilityRuntime } from '../capabilities'
import type { ProviderTarget } from '../../shared/ipc'
import { IPC_CHANNELS, type AgentImportResult } from '../../shared/ipc'
import { summarizeToolInput, type AgentRunEvent } from '../../shared/agent-stream'
import { canForkWithCli } from '../../shared/fork'
import {
  assertAgentCreateInput,
  assertAgentId,
  assertAgentMessage,
  assertAgentSendInput,
  assertAgentSessionPatch,
  assertAgentForkInput,
  assertImportInput,
  assertPermissionResponse,
  assertPresetInput,
  assertWorkspacePath
} from './agent-validators'

const IPC = IPC_CHANNELS
/** 工作区文件树的相对路径上限，与 agent/workspace.ts 的限制保持一致。 */
const MAX_WORKSPACE = 1000

interface ActiveRun {
  runId: string
  sessionId: string
  agent: 'claude' | 'codex'
  workspace: string
  cancel: () => void
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => boolean
}

interface PermissionOwner {
  runId: string
  toolName: string
  respond: (behavior: 'allow' | 'deny', message?: string) => boolean
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

export interface AgentBridgeHandlers {
  requestBridgeApproval: (input: McpExternalApprovalInput) => Promise<McpExternalApprovalDecision>
  hasApprovalRelay: (sessionId: string) => boolean
}

/**
 * 每个会话同一时间只跑一轮，不同会话可以各跑各的。
 * 流事件、审批与 MCP Token 都按 run / 会话隔离，互不串台。
 */
export function registerAgentHandlers(options: AgentHandlerOptions): AgentBridgeHandlers {
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
  const permissionRuns = new Map<string, PermissionOwner>()
  // 只有配置了外部 MCP 的 Claude 会话才暴露桥内审批中继
  const bridgeRelaySessions = new Set<string>()
  let seq = 0

  ipcMain.handle(IPC.agentThreads, () => ({
    sessions: repository.listSessions(),
    messages: repository.listMessages()
  }))

  ipcMain.handle(IPC.agentSearchSessions, (_event, query: unknown) => {
    if (typeof query !== 'string') throw new TypeError('搜索关键词无效')
    const trimmed = query.trim().slice(0, 80)
    if (!trimmed) return []
    return repository.searchSessions(trimmed)
  })

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
    const session = repository.findSession(assertAgentId(sessionId, '会话 id'))
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
    repository.removePreset(assertAgentId(id, '预设 id'))
  })

  ipcMain.handle(IPC.agentUsage, (_event, days: unknown) => {
    const value = typeof days === 'number' && Number.isFinite(days) ? Math.trunc(days) : 7
    const span = Math.min(90, Math.max(1, value))
    return repository.listRuns(Date.now() - span * 24 * 60 * 60 * 1000)
  })

  ipcMain.handle(IPC.agentApprovalRules, () => approvalRules.list())

  ipcMain.handle(IPC.agentRemoveApprovalRule, (_event, id: unknown) => {
    approvalRules.remove(assertAgentId(id, '规则 id'))
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

  ipcMain.handle(IPC.agentForkSession, (_event, value: unknown) => {
    const input = assertAgentForkInput(value)
    const source = repository.findSession(input.sessionId)
    if (!source) throw new Error('会话不存在')
    for (const run of runs.values()) {
      if (run.sessionId === input.sessionId) throw new Error('会话正在运行，结束再分叉')
    }
    const id = `s-${randomUUID()}`
    const title = `${source.title} · 分叉`.slice(0, 80)
    const messages = repository.listMessagesForSession(input.sessionId)
    const selected = messages.find((message) => message.id === input.messageId)
    const codexReady = source.agent !== 'codex' || Boolean(getProvider?.('codex'))
    const mode = canForkWithCli(source, messages, input.messageId) && codexReady ? 'cli' : 'copy'
    const forkTurnId = source.agent === 'codex' ? selected?.turnId : undefined
    const result = repository.forkSession({
      sourceId: input.sessionId,
      messageId: input.messageId,
      id,
      title
    })
    if (!result) throw new Error('找不到要分叉的消息')
    if (mode === 'cli' && source.resumeId) {
      repository.updateSession(id, {
        resumeId: source.resumeId,
        pendingFork: true,
        forkTurnId: forkTurnId ?? null
      })
      return { ...result, session: repository.findSession(id) ?? result.session, mode }
    }
    return { ...result, mode }
  })

  ipcMain.handle(IPC.agentCreateSession, (_event, value: unknown) =>
    repository.createSession(assertAgentCreateInput(value))
  )

  ipcMain.handle(IPC.agentUpdateSession, (_event, id: unknown, value: unknown) => {
    const sessionId = assertAgentId(id, '会话 id')
    const patch = assertAgentSessionPatch(value)
    if (patch.archived === true) {
      for (const run of runs.values()) {
        if (run.sessionId === sessionId) throw new Error('会话正在运行，先停止再归档')
      }
    }
    const updated = repository.updateSession(sessionId, patch)
    if (!updated) throw new Error('会话不存在')
  })

  ipcMain.handle(IPC.agentDeleteSession, (_event, id: unknown) => {
    const sessionId = assertAgentId(id, '会话 id')
    for (const run of runs.values()) {
      if (run.sessionId === sessionId) throw new Error('会话正在运行，先停止再删除')
    }
    return repository.removeSession(sessionId)
  })

  ipcMain.handle(IPC.agentSaveMessage, (_event, value: unknown) => {
    repository.saveMessage(assertAgentMessage(value))
  })

  ipcMain.handle(IPC.agentExportSession, async (_event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('会话 id 无效')
    const session = repository.findSession(id.trim())
    if (!session) throw new Error('会话不存在')
    const messages = repository.listMessagesForSession(session.id)
    const markdown = buildSessionMarkdown(session, messages)
    const forced = process.env.WS_EXPORT_PATH?.trim()
    let filePath = forced ?? ''
    if (!filePath) {
      const safeName =
        session.title
          .replace(/[\\/:*?"<>|]/g, '-')
          .trim()
          .slice(0, 60) || 'session'
      const options = {
        title: '导出会话',
        defaultPath: `${safeName}.md`,
        filters: [{ name: 'Markdown 文件', extensions: ['md'] }]
      }
      const win = getWindow()
      const picked = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (picked.canceled || !picked.filePath) return { canceled: true }
      filePath = picked.filePath
    }
    await writeFile(filePath, markdown, 'utf8')
    return { canceled: false, path: filePath, count: messages.length }
  })

  ipcMain.handle(IPC.agentSend, async (_event, value: unknown) => {
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
    const forkPending = session.pendingFork === true
    if (forkPending && !session.resumeId) throw new Error('源会话缺少可续接的 CLI 会话 id')
    // 数据库是续接真相：真分叉必须使用源 resumeId，不能信任渲染层传来的旧值。
    const resumeId = forkPending ? session.resumeId : (session.resumeId ?? input.resumeId)
    const forkTurnId = forkPending ? session.forkTurnId : undefined
    const workspace = assertWorkspacePath(session.workspace)
    const codexProvider = input.agent === 'codex' ? getProvider?.('codex') : undefined
    const codexServer = Boolean(codexProvider && codexHome)
    if (forkPending && input.agent === 'codex' && !codexServer) {
      throw new Error('Codex Provider 未启用，无法真分叉')
    }
    seq += 1
    const runId = `run-${seq}`
    let runResult: Extract<AgentRunEvent, { kind: 'result' }> | null = null
    repository.recordRunStart(runId, input.sessionId, Date.now())

    const emit = (runEvent: AgentRunEvent) => {
      let event = runEvent
      if (runEvent.kind === 'result') runResult = runEvent
      if (runEvent.kind === 'init' && runEvent.sessionId) {
        // init 表示 CLI 已接受续接 / 分叉；这一刻才把新 session id 落库。
        repository.updateSession(input.sessionId, {
          resumeId: runEvent.sessionId,
          pendingFork: false,
          forkTurnId: null
        })
      }
      if (runEvent.kind === 'permission') {
        const scoped = `${runId}:${runEvent.request.requestId}`
        permissionRuns.set(scoped, {
          runId,
          toolName: runEvent.request.toolName,
          respond: (behavior, message) =>
            runs.get(runId)?.respondPermission(runEvent.request.requestId, behavior, message) ??
            false
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

    let codexExternalMcp: Awaited<ReturnType<AgentCapabilityRuntime['codexMcp']>> | undefined
    if (input.agent === 'codex' && codexProvider && codexHome && capabilities) {
      try {
        codexExternalMcp = await capabilities.codexMcp()
      } catch (error) {
        const detail = error instanceof Error ? error.message : '读取 Codex 外部 MCP 配置失败'
        throw new Error(`无法加载 Codex 外部 MCP：${detail}`)
      }
    }
    const mcpEndpoint =
      input.agent === 'claude' || codexServer ? (mcp?.issue(input.sessionId) ?? null) : null
    let claudePlugins: string[] = []
    let claudeMcpServers: Awaited<ReturnType<AgentCapabilityRuntime['mcpServers']>> = []
    let claudeAllowedTools: string[] = []
    let claudeDeniedTools: string[] = []
    if (input.agent === 'claude' && capabilities) {
      try {
        claudePlugins = capabilities.pluginDirs()
        claudeMcpServers = await capabilities.mcpServers()
        const policy = capabilities.toolPolicy()
        claudeAllowedTools = policy.allowed
        claudeDeniedTools = policy.denied
      } catch (error) {
        const detail = error instanceof Error ? error.message : '读取能力中心配置失败'
        throw new Error(`无法加载应用私有技能 / MCP：${detail}`)
      }
    }
    // 真实 CLI 在 print 模式下不会把原生工具或外部 MCP 的权限交给 host；
    // 所有有本地桥的 Claude 会话统一用 approval_request 中继。
    const useBridgeApproval = input.agent === 'claude' && Boolean(mcpEndpoint)
    if (useBridgeApproval) bridgeRelaySessions.add(input.sessionId)

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
      bridgeRelaySessions.delete(input.sessionId)
      if (mcpEndpoint) mcp?.revoke(mcpEndpoint.token)
      cancelPermissions?.(input.sessionId)
      for (const [requestId, owner] of permissionRuns) {
        if (owner.runId !== runId) continue
        // 桥内中继的 Promise 必须收尾，否则外部 MCP 调用会一直挂着
        owner.respond('deny', '会话已结束')
        permissionRuns.delete(requestId)
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
                ...(resumeId ? { resumeId } : {}),
                ...(forkPending ? { forkThread: true } : {}),
                ...(forkTurnId ? { forkTurnId } : {}),
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
              ...(resumeId ? { resumeId } : {}),
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
              ...(resumeId ? { resumeId } : {}),
              ...(forkPending ? { forkSession: true } : {}),
              cwd: workspace,
              autoApprove,
              ...(provider ? { provider } : {}),
              ...(mcpEndpoint ? { mcp: mcpEndpoint } : {}),
              ...(claudePlugins.length > 0 ? { plugins: claudePlugins } : {}),
              ...(claudeMcpServers.length > 0 ? { mcpServers: claudeMcpServers } : {}),
              ...(claudeAllowedTools.length > 0 ? { allowedTools: claudeAllowedTools } : {}),
              ...(claudeDeniedTools.length > 0 ? { disallowedTools: claudeDeniedTools } : {}),
              ...(useBridgeApproval
                ? { permissionPromptTool: 'mcp__workstationforone__approval_request' }
                : {}),
              ...(cli === undefined ? {} : { cli }),
              onEvent: emit,
              onExit
            })
          })()

    runs.set(runId, {
      runId,
      sessionId: input.sessionId,
      agent: input.agent,
      workspace,
      cancel: handle.cancel,
      respondPermission: handle.respondPermission
    })
    return { runId }
  })

  ipcMain.handle(IPC.agentCancel, (_event, runId: unknown) => {
    const id = assertAgentId(runId, '运行 id')
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

    const ok = owner.respond(response.allow ? 'allow' : 'deny', response.message)
    permissionRuns.delete(response.requestId)
    return ok
  })

  const requestBridgeApproval = async (
    input: McpExternalApprovalInput
  ): Promise<McpExternalApprovalDecision> => {
    const session = repository.findSession(input.sessionId)
    if (session?.agent !== 'claude') {
      return { behavior: 'deny', message: '会话不存在或类型不匹配' }
    }
    if (!session.workspace) return { behavior: 'deny', message: '会话还没有选择工作区' }
    const workspace = assertWorkspacePath(session.workspace)
    const auto = approvalRules.check(
      { sessionId: input.sessionId, agent: 'claude', workspace },
      input.toolName
    )
    if (auto) return { behavior: 'allow', updatedInput: input.input }
    const run = [...runs.values()].find(
      (item) => item.sessionId === input.sessionId && item.agent === 'claude'
    )
    if (!run) return { behavior: 'deny', message: '会话没有进行中的运行' }

    const requestId = `${run.runId}:bridge-${randomUUID()}`
    const inputJson = JSON.stringify(input.input)
    const event: AgentRunEvent = {
      kind: 'permission',
      request: {
        requestId,
        toolName: input.toolName,
        toolUseId: input.toolUseId,
        detail: summarizeToolInput(input.toolName, input.input),
        inputPreview: inputJson.length > 1200 ? `${inputJson.slice(0, 1199)}…` : inputJson,
        workspaceScope: approvalRules.isWorkspaceEligible('claude', input.toolName)
      }
    }

    return new Promise<McpExternalApprovalDecision>((resolve) => {
      permissionRuns.set(requestId, {
        runId: run.runId,
        toolName: input.toolName,
        respond: (behavior, message) => {
          resolve(
            behavior === 'allow'
              ? { behavior: 'allow', updatedInput: input.input }
              : { behavior: 'deny', message: message?.trim() || '用户拒绝' }
          )
          return true
        }
      })
      const win = getWindow()
      if (!win || win.isDestroyed()) {
        permissionRuns.delete(requestId)
        resolve({ behavior: 'deny', message: '应用窗口不可用' })
        return
      }
      win.webContents.send(IPC.agentEvent, { runId: run.runId, event })
    })
  }

  return {
    requestBridgeApproval,
    hasApprovalRelay: (sessionId: string) => bridgeRelaySessions.has(sessionId)
  }
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
