import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import type { AgentCli } from '../agent/claude'
import { parseQuestions, startClaudeRun } from '../agent/claude'
import { buildAttentionNotice, type AgentNotifier, type AttentionSession } from '../agent/attention'
import type { ApprovalRuleService } from '../agent/approval-rules'
import { discoverLocalSessions } from '../agent/discover'
import { readSessionHistory } from '../agent/history'
import { buildSessionMarkdown } from '../agent/export'
import { buildContextPrompt, buildMemoryPrefix } from '../agent/context'
import { CheckpointAccumulator } from '../agent/checkpoint-accumulator'
import { filePathsFromInput, restoreFiles } from '../agent/checkpoints'
import { buildClaudeFileDiffs } from '../agent/file-diff'
import { toCheckpointView } from '../agent/checkpoints'
import { assertRecord } from '../validate'
import { imageDataUrl, imagePath, readImageBase64, removeImage, saveImage } from '../agent/images'
import { listWorkspaceEntries, readWorkspaceText } from '../agent/workspace'
import { startCodexAppServerRun } from '../agent/codex-app-server'
import { startCodexRun } from '../agent/codex'
import type { AuditLog } from '../db/audit'
import type { AgentRepository } from '../db/agent'
import type { NoteRepository } from '../db/notes'
import { clampSystemPrefix, compactTurns } from '../../shared/context-budget'
import { guardNote, scanUntrusted } from '../../shared/prompt-guard'
import type {
  McpEndpoint,
  McpExternalApprovalDecision,
  McpExternalApprovalInput,
  McpQuestionDecision,
  McpQuestionInput
} from '../mcp/server'
import type { ProviderRuntime } from '../providers'
import type { AgentCapabilityRuntime } from '../capabilities'
import type { ProviderTarget } from '../../shared/ipc'
import { IPC_CHANNELS, type AgentImportResult } from '../../shared/ipc'
import { summarizeToolInput, type AgentRunEvent } from '../../shared/agent-stream'
import { toolKind } from '../../shared/eval-metrics'
import { canForkWithCli } from '../../shared/fork'
import { planModeDenial, planModePrompt } from '../../shared/plan-mode'
import { toolSurfaceDenial } from '../../shared/tool-surface'
import {
  assertAgentCreateInput,
  assertAgentId,
  assertAgentMessage,
  assertAgentSendInput,
  assertAgentSessionPatch,
  assertAgentForkInput,
  assertImportInput,
  assertPermissionResponse,
  assertQuestionResponse,
  assertPresetInput,
  assertResumeId,
  assertAgentTeamCreateInput,
  assertTeamPostInput,
  assertWorkspacePath
} from './agent-validators'
import { TeamService } from '../agent/team'
import type { LocalModelRepository } from '../db/local-model'
import type { ExpertRepository } from '../db/experts'
import { buildExpertCandidate } from '../../shared/evolution'
import { isLocalEndpoint } from '../agent/local-model'

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
  respondQuestion: (
    requestId: string,
    answers: Record<string, string> | undefined,
    deny?: boolean
  ) => boolean
}

interface PermissionOwner {
  runId: string
  toolName: string
  /** 本次写入涉及的工作区路径；允许时先抓快照 */
  paths?: string[]
  respond: (behavior: 'allow' | 'deny', message?: string) => boolean
}

interface QuestionOwner {
  runId: string
  respond: (answers: Record<string, string> | undefined, deny: boolean) => boolean
}

export interface McpAccess {
  issue: (sessionId: string) => McpEndpoint | null
  revoke: (token: string) => void
}

export interface AgentHandlerOptions {
  getWindow: () => BrowserWindow | null
  repository: AgentRepository
  /** 笔记检索作为跨会话记忆来源；省略时不注入记忆块 */
  notes?: NoteRepository
  /** 本地模型配置；省略时该接口不可用 */
  localModel?: LocalModelRepository
  /** 专家库；省略时不支持从回合提炼专家 */
  experts?: ExpertRepository
  /** 用本机模型把回合摘要升级为要点；省略或失败都保留抽取式摘要 */
  summarizeLocal?: (
    turns: Array<{ role: 'user' | 'assistant'; text: string }>
  ) => Promise<string | null>
  cli?: AgentCli | null
  getProvider?: (target: ProviderTarget) => ProviderRuntime | undefined
  codexCli?: AgentCli | null
  mcp?: McpAccess | null
  cancelPermissions?: (sessionId: string) => void
  codexHome?: string
  capabilities?: AgentCapabilityRuntime
  approvalRules: ApprovalRuleService
  /** 回退检查点写一条审计；省略时不写 */
  audit?: Pick<AuditLog, 'record'>
  /** 图片私有目录；省略时按应用数据目录派生 */
  imagesDir: string
  /** 后台审批 / 追问通知；省略时不发通知 */
  notifyAttention?: AgentNotifier
}

export interface AgentBridgeHandlers {
  requestBridgeApproval: (input: McpExternalApprovalInput) => Promise<McpExternalApprovalDecision>
  requestBridgeQuestion: (input: McpQuestionInput) => Promise<McpQuestionDecision>
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
    notes,
    localModel,
    experts,
    summarizeLocal,
    cli,
    getProvider,
    codexCli,
    mcp,
    cancelPermissions,
    codexHome,
    capabilities,
    approvalRules,
    audit,
    imagesDir,
    notifyAttention
  } = options
  const runs = new Map<string, ActiveRun>()
  // Codex app-server 与 stub 的审批 id 只在各自进程内唯一；加 run 前缀后才不会串台
  const permissionRuns = new Map<string, PermissionOwner>()
  /** 每个运行只保留一份「写入前」快照；成功与否都保留，便于用户回退。 */
  const checkpointRuns = new Map<string, CheckpointAccumulator>()
  const questionRuns = new Map<string, QuestionOwner>()
  // 只有配置了外部 MCP 的 Claude 会话才暴露桥内审批中继
  const bridgeRelaySessions = new Set<string>()
  let seq = 0
  // 评估落痕的每运行序号；运行结束即清理，避免长会话累积
  const toolSeqByRun = new Map<string, number>()
  const nextToolSeq = (runId: string): number => {
    const next = (toolSeqByRun.get(runId) ?? 0) + 1
    toolSeqByRun.set(runId, next)
    return next
  }
  const recordTool = (
    runId: string,
    sessionId: string,
    toolName: string,
    kind: string,
    decision: string
  ): void => {
    try {
      repository.recordToolCall({
        runId,
        sessionId,
        seq: nextToolSeq(runId),
        toolName,
        kind,
        decision,
        at: Date.now()
      })
    } catch (error) {
      console.error('[agent] 工具落痕失败', error)
    }
  }

  const notifyEvent = (session: AttentionSession, event: AgentRunEvent) => {
    if (!notifyAttention) return
    if (event.kind !== 'permission' && event.kind !== 'question') return
    notifyAttention(buildAttentionNotice(session, event))
  }

  ipcMain.handle(IPC.agentThreads, () => ({
    sessions: repository.listSessions(),
    messages: repository.listMessages()
  }))

  ipcMain.handle(IPC.agentSessions, () => ({
    sessions: repository.listSessions(),
    counts: repository.messageCounts()
  }))

  ipcMain.handle(IPC.agentThread, (_event, id: unknown) => {
    const sessionId = assertAgentId(id, '会话 id')
    if (!repository.findSession(sessionId)) throw new Error('会话不存在')
    return repository.listMessagesForSession(sessionId)
  })

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

  ipcMain.handle(IPC.agentSaveImage, (_event, value: unknown) => {
    const input = assertRecord(value, '图片')
    if (typeof input.data !== 'string' || typeof input.mime !== 'string') {
      throw new TypeError('图片参数无效')
    }
    const name = typeof input.name === 'string' ? input.name.slice(0, 80) : undefined
    return saveImage(imagesDir, {
      mime: input.mime,
      data: input.data,
      ...(name ? { name } : {})
    })
  })

  ipcMain.handle(IPC.agentImageData, (_event, value: unknown) => {
    const image = assertRecord(value, '图片引用')
    const id = assertAgentId(image.id, '图片 id')
    const mime = typeof image.mime === 'string' ? image.mime : ''
    const name = typeof image.name === 'string' ? image.name : 'image'
    const size = typeof image.size === 'number' ? image.size : 0
    return imageDataUrl(imagesDir, { id, mime, name, size })
  })

  // 只删没有消息引用的附件；已发送/分叉复用的图片必须保留。
  ipcMain.handle(IPC.agentDiscardImage, (_event, value: unknown) => {
    const image = assertRecord(value, '图片引用')
    const id = assertAgentId(image.id, '图片 id')
    if (repository.listImageRefs().some((item) => item.id === id)) return false
    return removeImage(imagesDir, {
      id,
      mime: typeof image.mime === 'string' ? image.mime : '',
      name: typeof image.name === 'string' ? image.name : 'image',
      size: typeof image.size === 'number' ? image.size : 0
    })
  })

  ipcMain.handle(IPC.agentPresets, () => repository.listPresets())

  ipcMain.handle(IPC.agentCheckpoints, (_event, value: unknown) => {
    const sessionId = assertAgentId(value, '会话 id')
    return repository.listCheckpoints(sessionId).map(toCheckpointView)
  })

  ipcMain.handle(IPC.agentRollback, (_event, value: unknown) => {
    const checkpointId = assertAgentId(value, '检查点 id')
    const checkpoint = repository.findCheckpoint(checkpointId)
    if (!checkpoint) throw new Error('检查点不存在')
    const session = repository.findSession(checkpoint.sessionId)
    if (!session?.workspace) throw new Error('会话工作区已不存在')
    if (runs.has(checkpoint.runId) || [...runs.values()].some((r) => r.sessionId === session.id)) {
      throw new Error('会话还在运行，先停止后再回退')
    }
    const result = restoreFiles(assertWorkspacePath(session.workspace), checkpoint.files)
    repository.markCheckpointRestored(checkpointId, Date.now())
    audit?.record({
      at: Date.now(),
      domain: 'system',
      action: 'settings',
      targetId: checkpoint.id,
      title: `rollback ${checkpoint.summary}`,
      source: 'ui',
      detail: `restored=${result.restored} removed=${result.removed} failed=${result.failed.length}`
    })
    return result
  })

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

  ipcMain.handle(IPC.agentTeamCreate, (_event, value: unknown) =>
    new TeamService(repository).create(assertAgentTeamCreateInput(value))
  )
  ipcMain.handle(IPC.agentTeamList, () => new TeamService(repository).list())
  ipcMain.handle(IPC.agentTeamPost, (_event, value: unknown) => {
    const input = assertTeamPostInput(value)
    return new TeamService(repository).post(input.teamId, input.sessionId, input.role, input.text)
  })
  ipcMain.handle(IPC.agentTeamNotes, (_event, value: unknown) =>
    new TeamService(repository).notes(assertAgentId(value, '团队 id'))
  )
  ipcMain.handle(IPC.agentLocalModelGet, () => {
    if (!localModel) throw new Error('本地模型配置不可用')
    return localModel.get()
  })
  ipcMain.handle(IPC.agentLocalModelSet, (_event, value: unknown) => {
    if (!localModel) throw new Error('本地模型配置不可用')
    const record = value as Record<string, unknown>
    const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
    const model = typeof record.model === 'string' ? record.model.trim() : ''
    const enabled = record.enabled === true
    if (enabled && !isLocalEndpoint(baseUrl)) {
      throw new TypeError('本地模型只接受 127.0.0.1 / localhost 的 http(s) 端点')
    }
    if (model.length > 120) throw new TypeError('模型名过长')
    return localModel.save({ baseUrl, model, enabled })
  })

  ipcMain.handle(IPC.agentEvolveExpert, (_event, value: unknown) => {
    if (!experts) throw new Error('专家库不可用')
    const input = (value ?? {}) as Record<string, unknown>
    const sessionId = assertAgentId(input.sessionId, '会话 id')
    const messageId = assertAgentId(input.messageId, '消息 id')
    const messages = repository.listMessagesForSession(sessionId)
    const index = messages.findIndex((message) => message.id === messageId)
    if (index < 0) throw new Error('消息不存在')
    const assistant = messages[index]
    if (assistant.role !== 'assistant' || assistant.error) {
      throw new TypeError('只能从成功的助手回复提炼专家')
    }
    const userText =
      [...messages.slice(0, index)].reverse().find((message) => message.role === 'user')?.text ?? ''
    const candidate = buildExpertCandidate({
      userText,
      assistantText: assistant.text,
      toolNames: (assistant.tools ?? []).map((tool) => tool.name)
    })
    if (!candidate) throw new TypeError('该回复没有可提炼的工具步骤')
    return experts.saveExpert({
      name: candidate.name,
      description: candidate.description,
      persona: candidate.persona,
      tools: []
    })
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
    const sessionImages = repository.listImageRefsForSession(sessionId)
    const removed = repository.removeSession(sessionId)
    if (removed && sessionImages.length > 0) {
      // 分叉会话会复制图片引用；只清理已经没有任何消息引用的文件。
      const remaining = new Set(repository.listImageRefs().map((image) => image.id))
      for (const image of sessionImages) {
        if (!remaining.has(image.id)) removeImage(imagesDir, image)
      }
    }
    return removed
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
    const planMode = session.planMode === true
    // 工具面按 Agent 全局生效；读取失败时退回「全部启用」，不阻断会话
    let surfacePolicy = { disabledClaudeTools: [], codexFlags: [], codexDeniedTools: [] } as {
      disabledClaudeTools: string[]
      codexFlags: string[]
      codexDeniedTools: string[]
    }
    let toolPriority = ''
    if (capabilities) {
      try {
        surfacePolicy = capabilities.toolSurface.nativePolicy(input.agent)
        toolPriority = capabilities.toolSurface.priorityPrompt(input.agent)
      } catch (error) {
        console.error('[agent] 读取工具面设置失败，本轮按默认启用处理', error)
      }
    }
    // 记忆 / 摘要走系统提示侧（append-system-prompt / developerInstructions），不污染用户消息；
    // 检索失败不阻断发送，降级为无前缀。
    let memory: Array<{ label: string; text: string }> = []
    if (notes) {
      try {
        memory = notes.search(input.prompt, 3).map((hit) => ({
          label: `note:${hit.text
            .split('\n')[0]
            .replace(/["<>\r\n]/g, ' ')
            .trim()
            .slice(0, 40)}`,
          text: hit.snippet
        }))
      } catch (error) {
        console.error('[agent] 记忆检索失败，本轮不注入记忆块', error)
      }
    }
    const memoryPrefix = buildMemoryPrefix({ digest: session.contextDigest, memory })
    // 市场导入的人设属于第三方内容：可疑时只加只读警告，不改原文。
    const personaText = session.persona
      ? scanUntrusted(session.persona).suspicious
        ? `${guardNote(true)}\n${session.persona}`
        : session.persona
      : ''
    // 记忆 / 人设 / 工具优先级同走 Claude appendSystemPrompt / Codex developerInstructions。
    // Windows 命令行总长有限，超长前缀会直接 spawn 失败，这里统一收紧上限。
    toolPriority = clampSystemPrefix(
      [memoryPrefix, personaText, toolPriority].filter(Boolean).join('\n\n')
    )
    const disabledNames =
      input.agent === 'claude' ? surfacePolicy.disabledClaudeTools : surfacePolicy.codexDeniedTools
    const disabledToolDenial = (toolName: string) => toolSurfaceDenial(toolName, disabledNames)
    // 文件内容只在这一步进内存；发送前失败不会留下没有收尾的运行记录。
    const contextPrompt = buildContextPrompt(workspace, input.prompt, input.contextFiles ?? [])
    const prompt = planMode ? planModePrompt(contextPrompt) : contextPrompt
    const codexInstructions = clampSystemPrefix(
      [planMode ? '[计划模式] 只读调查并给出计划，不要修改文件或执行写入命令。' : '', toolPriority]
        .filter(Boolean)
        .join('\n\n')
    )
    const codexProvider = input.agent === 'codex' ? getProvider?.('codex') : undefined
    const codexServer = Boolean(codexProvider && codexHome)
    if (input.images?.length && input.agent === 'codex' && !codexServer) {
      throw new Error('Codex 继承 CLI 的只读模式不支持图片；请启用 Codex Provider 后再发送')
    }
    const claudeImages =
      input.agent === 'claude'
        ? (input.images ?? []).map((image) => ({
            mime: image.mime,
            data: readImageBase64(imagesDir, image)
          }))
        : undefined
    const codexImages =
      input.agent === 'codex'
        ? (input.images ?? []).map((image) => imagePath(imagesDir, image))
        : undefined
    if (forkPending && input.agent === 'codex' && !codexServer) {
      throw new Error('Codex Provider 未启用，无法真分叉')
    }
    seq += 1
    const runId = `run-${seq}`
    const checkpoints = new CheckpointAccumulator(workspace)
    checkpointRuns.set(runId, checkpoints)
    const onWriteIntent = (paths: string[], toolName: string) => {
      checkpoints.capture(paths, toolName)
    }
    let runResult: Extract<AgentRunEvent, { kind: 'result' }> | null = null
    // 助手正文在渲染层落库（done 之后），主进程这里独立累积一份用于回合摘要。
    let streamedText = ''
    repository.recordRunStart(runId, input.sessionId, Date.now())

    const emit = (runEvent: AgentRunEvent) => {
      let event = runEvent
      if (runEvent.kind === 'tool') {
        recordTool(runId, input.sessionId, runEvent.name, toolKind(runEvent.name), 'observed')
      }
      if (runEvent.kind === 'text') streamedText += runEvent.text
      if (runEvent.kind === 'result') runResult = runEvent
      if (runEvent.kind === 'init' && runEvent.sessionId) {
        // init 表示 CLI 已接受续接 / 分叉；这一刻才把新 session id 落库。
        // CLI 返回值同样不可信：落库前过防 flag 注入校验，不合法则不写。
        try {
          repository.updateSession(input.sessionId, {
            resumeId: assertResumeId(runEvent.sessionId, '续接会话 id'),
            pendingFork: false,
            forkTurnId: null
          })
        } catch (error) {
          console.error('[agent] 忽略非法的 CLI 续接 id', error)
        }
      }
      if (runEvent.kind === 'permission') {
        const disabledDenial = disabledToolDenial(runEvent.request.toolName)
        const denial =
          disabledDenial ??
          (planMode ? planModeDenial(input.agent, runEvent.request.toolName) : null)
        if (denial) {
          // 计划模式 / 工具面关闭都不发卡：直接拒绝，避免任何链路把写入放进来。
          runs.get(runId)?.respondPermission(runEvent.request.requestId, 'deny', denial)
          return
        }
        const scoped = `${runId}:${runEvent.request.requestId}`
        permissionRuns.set(scoped, {
          runId,
          toolName: runEvent.request.toolName,
          paths: runEvent.request.diffs?.map((diff) => diff.path) ?? [],
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
      if (runEvent.kind === 'question') {
        const scoped = `${runId}:${runEvent.request.requestId}`
        questionRuns.set(scoped, {
          runId,
          respond: (answers, deny) =>
            runs.get(runId)?.respondQuestion(runEvent.request.requestId, answers, deny) ?? false
        })
        event = {
          ...runEvent,
          request: { ...runEvent.request, requestId: scoped }
        }
      }
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC.agentEvent, { runId, event })
      notifyEvent(session, event)
    }

    const runtimePathPrefix = capabilities?.runtimePathPrefix() ?? ''
    let codexExternalMcp: Awaited<ReturnType<AgentCapabilityRuntime['codexMcp']>> | undefined
    if (input.agent === 'codex' && codexProvider && codexHome && capabilities) {
      try {
        codexExternalMcp = await capabilities.codexMcp()
      } catch (error) {
        const detail = error instanceof Error ? error.message : '读取 Codex 外部 MCP 配置失败'
        checkpointRuns.delete(runId)
        repository.finishRun(runId, { ok: false, cancelled: false })
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
        if (mcpEndpoint) mcp?.revoke(mcpEndpoint.token)
        checkpointRuns.delete(runId)
        repository.finishRun(runId, { ok: false, cancelled: false })
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
      checkpointRuns.delete(runId)
      toolSeqByRun.delete(runId)
      const pendingFiles = checkpoints.take()
      if (pendingFiles.length > 0) {
        try {
          repository.saveCheckpoint({
            id: `checkpoint-${randomUUID()}`,
            sessionId: input.sessionId,
            runId,
            summary: checkpoints.summary(),
            files: pendingFiles,
            createdAt: Date.now()
          })
        } catch (error) {
          console.error('[agent] 保存检查点失败', error)
        }
      }
      bridgeRelaySessions.delete(input.sessionId)
      if (mcpEndpoint) mcp?.revoke(mcpEndpoint.token)
      cancelPermissions?.(input.sessionId)
      for (const [requestId, owner] of permissionRuns) {
        if (owner.runId !== runId) continue
        // 桥内中继的 Promise 必须收尾，否则外部 MCP 调用会一直挂着
        owner.respond('deny', '会话已结束')
        permissionRuns.delete(requestId)
      }
      for (const [requestId, owner] of questionRuns) {
        if (owner.runId !== runId) continue
        // 桥内问答是一个等待 MCP 响应的 Promise，退出时必须收尾
        owner.respond(undefined, true)
        questionRuns.delete(requestId)
      }
      repository.finishRun(runId, {
        ok: !cancelled && (runResult?.ok ?? code === 0),
        cancelled,
        ...(runResult?.costUsd !== undefined ? { costUsd: runResult.costUsd } : {}),
        ...(runResult?.durationMs !== undefined ? { durationMs: runResult.durationMs } : {}),
        ...(runResult?.turns !== undefined ? { turns: runResult.turns } : {})
      })
      // 回合成功后刷新滚动摘要：长线程压缩成首条意图 + 最近若干条，下一轮续摘要而非断片。
      if (!cancelled && (runResult?.ok ?? code === 0)) {
        try {
          const turns = repository
            .listMessagesForSession(input.sessionId)
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }))
          // 助手正文由渲染层在 done 后落库，这里补上本轮正文，避免摘要落后一轮。
          if (streamedText.trim()) turns.push({ role: 'assistant', text: streamedText })
          const digest = compactTurns(turns)
          if (digest) repository.updateSession(input.sessionId, { contextDigest: digest })
          // 本机模型摘要作为异步升级；失败保留抽取式摘要，不影响回合结束。
          if (digest && summarizeLocal) {
            void summarizeLocal(turns)
              .then((summary) => {
                if (!summary) return
                // 慢请求可能晚于下一轮：只有摘要仍是本轮写入的那份才允许升级。
                if (repository.findSession(input.sessionId)?.contextDigest !== digest) return
                repository.updateSession(input.sessionId, { contextDigest: summary })
              })
              .catch(() => undefined)
          }
        } catch (error) {
          console.error('[agent] 滚动摘要更新失败', error)
        }
      }
      if (cancelled) {
        emit({ kind: 'error', message: '已取消' })
        return
      }
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/).at(-1) ?? ''
        emit({ kind: 'error', message: detail || `CLI 退出码 ${code}` })
        return
      }
      // 进程已经退出、run 也已从表中移除；这时再通知渲染层结束回合，
      // 否则用户看到回复后立刻发送可能撞上「这个会话还在进行中」。
      emit({ kind: 'done' })
    }

    const autoApprove = (toolName: string) => {
      // 工具面关闭的原生工具不自动放行，也不经规则放行
      if (disabledToolDenial(toolName)) return null
      // 计划模式：只读工具直接放行（沙箱仍禁止写入），写入类工具不自动放行。
      if (planMode) return planModeDenial(input.agent, toolName) ? null : 'session'
      return approvalRules.check(
        { sessionId: input.sessionId, agent: input.agent, workspace },
        toolName
      )
    }

    const handle =
      input.agent === 'codex'
        ? (() => {
            // 自定义 Provider 用 app-server 的工作区审批模式；继承 CLI 时仍走
            // exec 只读，避免为了写入去读改用户自己的 ~/.codex 配置。
            if (codexProvider && codexHome) {
              return startCodexAppServerRun({
                prompt,
                ...(resumeId ? { resumeId } : {}),
                ...(forkPending ? { forkThread: true } : {}),
                ...(forkTurnId ? { forkTurnId } : {}),
                ...(runtimePathPrefix ? { runtimePathPrefix } : {}),
                cwd: workspace,
                provider: codexProvider,
                home: codexHome,
                autoApprove,
                ...(mcpEndpoint ? { mcp: mcpEndpoint } : {}),
                ...(codexExternalMcp && codexExternalMcp.servers.length > 0
                  ? { externalMcp: codexExternalMcp }
                  : {}),
                ...(planMode ? { planMode: true } : {}),
                ...(surfacePolicy.codexFlags.length > 0 ? { flags: surfacePolicy.codexFlags } : {}),
                ...(runtimePathPrefix ? { runtimePathPrefix } : {}),
                ...(codexInstructions ? { developerInstructions: codexInstructions } : {}),
                ...(codexImages?.length ? { images: codexImages } : {}),
                clientVersion: app.getVersion(),
                ...(codexCli === undefined ? {} : { cli: codexCli }),
                onWriteIntent,
                onEvent: emit,
                onExit
              })
            }
            return startCodexRun({
              prompt,
              ...(resumeId ? { resumeId } : {}),
              cwd: workspace,
              ...(surfacePolicy.codexFlags.length > 0 ? { flags: surfacePolicy.codexFlags } : {}),
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
              prompt,
              ...(resumeId ? { resumeId } : {}),
              ...(forkPending ? { forkSession: true } : {}),
              ...(planMode ? { planMode: true } : {}),
              ...(claudeImages?.length ? { images: claudeImages } : {}),
              cwd: workspace,
              autoApprove,
              onWriteIntent,
              ...(provider ? { provider } : {}),
              ...(mcpEndpoint ? { mcp: mcpEndpoint } : {}),
              ...(claudePlugins.length > 0 ? { plugins: claudePlugins } : {}),
              ...(claudeMcpServers.length > 0 ? { mcpServers: claudeMcpServers } : {}),
              ...(claudeAllowedTools.length > 0 ? { allowedTools: claudeAllowedTools } : {}),
              ...(claudeDeniedTools.length > 0 ? { disallowedTools: claudeDeniedTools } : {}),
              ...(surfacePolicy.disabledClaudeTools.length > 0
                ? { disabledTools: surfacePolicy.disabledClaudeTools }
                : {}),
              ...(toolPriority ? { appendSystemPrompt: toolPriority } : {}),
              ...(runtimePathPrefix ? { runtimePathPrefix } : {}),
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
      respondPermission: handle.respondPermission,
      respondQuestion:
        (handle as { respondQuestion?: ActiveRun['respondQuestion'] }).respondQuestion ??
        (() => false)
    })
    return { runId }
  })

  ipcMain.handle(IPC.agentQuestionResponse, (_event, value: unknown) => {
    const response = assertQuestionResponse(value)
    const owner = questionRuns.get(response.requestId)
    const run = owner ? runs.get(owner.runId) : undefined
    if (!owner || !run) return false
    const ok = owner.respond(response.answers, response.deny === true)
    if (ok) questionRuns.delete(response.requestId)
    return ok
  })

  ipcMain.handle(IPC.agentCancel, (_event, runId: unknown) => {
    const id = assertAgentId(runId, '运行 id')
    // 只发取消，不立即删 run：进程异步退出前仍要锁住会话，避免同 resume id 并发双进程。
    runs.get(id)?.cancel()
  })

  ipcMain.handle(IPC.agentPermissionResponse, (_event, value: unknown) => {
    const response = assertPermissionResponse(value)
    const owner = permissionRuns.get(response.requestId)
    const run = owner ? runs.get(owner.runId) : undefined
    if (!owner || !run) return false
    if (response.allow && owner.paths?.length) {
      checkpointRuns.get(owner.runId)?.capture(owner.paths, owner.toolName)
    }

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
    // 只有真正回写到 CLI 的决策才落痕；回写失败按拒绝记录。
    recordTool(
      owner.runId,
      run.sessionId,
      owner.toolName,
      'approval',
      response.allow && ok ? 'allow' : 'deny'
    )
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
    const denied = capabilities
      ? toolSurfaceDenial(
          input.toolName,
          capabilities.toolSurface.nativePolicy('claude').disabledClaudeTools
        )
      : null
    if (denied) return { behavior: 'deny', message: denied }
    const denial = session.planMode ? planModeDenial('claude', input.toolName) : null
    if (denial) return { behavior: 'deny', message: denial }
    const auto = approvalRules.check(
      { sessionId: input.sessionId, agent: 'claude', workspace },
      input.toolName
    )
    const run = [...runs.values()].find(
      (item) => item.sessionId === input.sessionId && item.agent === 'claude'
    )
    if (auto) {
      const paths = filePathsFromInput(input.input)
      if (run && paths.length) checkpointRuns.get(run.runId)?.capture(paths, input.toolName)
      return { behavior: 'allow', updatedInput: input.input }
    }
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
        diffs: buildClaudeFileDiffs(input.toolName, input.input, workspace),
        workspaceScope: approvalRules.isWorkspaceEligible('claude', input.toolName)
      }
    }

    return new Promise<McpExternalApprovalDecision>((resolve) => {
      permissionRuns.set(requestId, {
        runId: run.runId,
        toolName: input.toolName,
        paths: filePathsFromInput(input.input),
        respond: (behavior, message) => {
          if (behavior === 'allow') {
            const paths = filePathsFromInput(input.input)
            if (paths.length) checkpointRuns.get(run.runId)?.capture(paths, input.toolName)
          }
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
      notifyEvent(session, event)
    })
  }

  const requestBridgeQuestion = async (input: McpQuestionInput): Promise<McpQuestionDecision> => {
    const session = repository.findSession(input.sessionId)
    if (session?.agent !== 'claude') {
      return { behavior: 'deny', message: '会话不存在或类型不匹配' }
    }
    const questions = parseQuestions(input.input)
    if (!questions) return { behavior: 'deny', message: 'AskUserQuestion 参数无效' }
    const run = [...runs.values()].find(
      (item) => item.sessionId === input.sessionId && item.agent === 'claude'
    )
    if (!run) return { behavior: 'deny', message: '会话没有进行中的运行' }

    const requestId = `${run.runId}:bridge-q-${randomUUID()}`
    const event: AgentRunEvent = {
      kind: 'question',
      request: { requestId, toolUseId: input.toolUseId, questions }
    }

    return new Promise<McpQuestionDecision>((resolve) => {
      questionRuns.set(requestId, {
        runId: run.runId,
        respond: (answers, deny) => {
          if (deny || !answers) {
            resolve({ behavior: 'deny', message: '用户拒绝回答' })
            return true
          }
          const scoped: Record<string, string> = {}
          for (const question of questions) {
            const answer = answers[question.question]?.trim()
            if (!answer) {
              resolve({ behavior: 'deny', message: '问答答案不完整' })
              return true
            }
            scoped[question.question] = answer
          }
          resolve({ behavior: 'allow', answers: scoped })
          return true
        }
      })
      const win = getWindow()
      if (!win || win.isDestroyed()) {
        questionRuns.delete(requestId)
        resolve({ behavior: 'deny', message: '应用窗口不可用' })
        return
      }
      win.webContents.send(IPC.agentEvent, { runId: run.runId, event })
      notifyEvent(session, event)
    })
  }

  return {
    requestBridgeApproval,
    requestBridgeQuestion,
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
  assertQuestionResponse,
  assertPresetInput,
  assertWorkspacePath
} as const
