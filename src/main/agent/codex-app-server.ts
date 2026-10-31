import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentPermissionRequest, AgentRunEvent } from '../../shared/agent-stream'
import type { CodexMcpRuntime } from '../capabilities/codex-mcp'
import { isReadOnlyMcpTool } from '../mcp/tools'
import type { McpEndpoint } from '../mcp/server'
import type { ProviderRuntime } from '../providers'
import { resolveCodexCli, type AgentCli } from './cli'
import { writeCodexProviderConfig } from './codex'

const RUN_TIMEOUT_MS = 10 * 60 * 1000
const MAX_DETAIL = 120
const MAX_PREVIEW = 1200

function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberId(value: unknown): string | number | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null
}

function itemStatus(item: Record<string, unknown>): string {
  return asString(item.status) ?? 'inProgress'
}

function pathsOf(item: Record<string, unknown>): string[] {
  const changes = Array.isArray(item.changes) ? item.changes : []
  return changes
    .map((change) => asString(asRecord(change)?.path))
    .filter((path): path is string => Boolean(path))
}

function toolName(item: Record<string, unknown>, type: string): string | null {
  switch (type) {
    case 'commandExecution':
      return 'Shell'
    case 'fileChange':
      return 'Patch'
    case 'mcpToolCall': {
      const server = asString(item.server)
      const tool = asString(item.tool)
      return server && tool ? `${server}/${tool}` : 'MCP'
    }
    case 'webSearch':
      return 'WebSearch'
    case 'dynamicToolCall': {
      const namespace = asString(item.namespace)
      const tool = asString(item.tool)
      return namespace && tool ? `${namespace}/${tool}` : tool || 'Tool'
    }
    case 'collabAgentToolCall': {
      const tool = asString(item.tool)
      return tool ? `Collab ${tool}` : 'Collab'
    }
    default:
      return null
  }
}

function toolDetail(item: Record<string, unknown>, type: string): string {
  switch (type) {
    case 'commandExecution':
      return clip(asString(item.command) ?? '')
    case 'fileChange':
      return clip(pathsOf(item).join(' · '))
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return clip(JSON.stringify(item.arguments ?? {}))
    case 'webSearch':
      return clip(asString(item.query) ?? '')
    case 'collabAgentToolCall': {
      const receivers = Array.isArray(item.receiverThreadIds)
        ? item.receiverThreadIds.filter((id): id is string => typeof id === 'string')
        : []
      return clip(receivers.join(' · '))
    }
    default:
      return ''
  }
}

function resultOk(item: Record<string, unknown>, type: string): boolean {
  const status = itemStatus(item)
  if (status !== 'completed') return false
  if (type === 'commandExecution') {
    return item.exitCode === null || item.exitCode === undefined || item.exitCode === 0
  }
  if (type === 'dynamicToolCall') return item.success !== false
  return true
}

function resultDetail(item: Record<string, unknown>, type: string): string {
  if (type === 'commandExecution') return clip(asString(item.aggregatedOutput) ?? '')
  if (type === 'mcpToolCall') return clip(asString(asRecord(item.error)?.message) ?? '')
  return ''
}

export interface CodexAppServerParser {
  /** 解析一行通知；JSON-RPC 请求的响应由调用方按 id 处理 */
  parse(value: unknown): AgentRunEvent[]
  /** 最近一次见到的条目，审批卡用它补文件路径等上下文 */
  item(id: string): Record<string, unknown> | undefined
}

/**
 * app-server 的正文是 delta，完成事件又带全文。这里记住哪些条目已经流式过，
 * 完成时不再追加一遍，避免同一条回复在界面上出现两次。
 */
export function createCodexAppServerParser(): CodexAppServerParser {
  const streamed = new Set<string>()
  const items = new Map<string, Record<string, unknown>>()

  const parse = (value: unknown): AgentRunEvent[] => {
    let payload = value
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload)
      } catch {
        return []
      }
    }
    const record = asRecord(payload)
    if (!record) return []
    const method = asString(record.method)
    const params = asRecord(record.params)
    if (!method || !params) return []

    if (method === 'item/agentMessage/delta') {
      const id = asString(params.itemId)
      const delta = asString(params.delta)
      if (!id || !delta) return []
      streamed.add(id)
      return [{ kind: 'text', text: delta }]
    }

    if (method === 'item/started' || method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item) return []
      const id = asString(item.id)
      const type = asString(item.type)
      if (!id || !type) return []
      items.set(id, item)

      if (type === 'agentMessage') {
        if (method !== 'item/completed' || streamed.has(id)) return []
        const text = asString(item.text)
        return text ? [{ kind: 'text', text }] : []
      }
      if (type === 'reasoning' || type === 'userMessage' || type === 'hookPrompt') return []
      if (type === 'plan' || type === 'functionCallOutput') return []

      const name = toolName(item, type)
      if (!name) return []
      if (method === 'item/started') {
        return [{ kind: 'tool', id, name, detail: toolDetail(item, type) }]
      }
      return [
        {
          kind: 'tool-result',
          id,
          ok: resultOk(item, type),
          detail: resultDetail(item, type)
        }
      ]
    }

    if (method === 'turn/completed') {
      const turn = asRecord(params.turn)
      const status = asString(turn?.status)
      if (status === 'completed') return [{ kind: 'result', ok: true }]
      if (status === 'failed') {
        const message = asString(asRecord(turn?.error)?.message) ?? 'Codex 回合失败'
        return [{ kind: 'error', message }]
      }
      if (status === 'interrupted') return [{ kind: 'error', message: '回合已中断' }]
      return []
    }

    if (method === 'error') {
      if (params.willRetry === true) return []
      const message = asString(asRecord(params.error)?.message) ?? 'Codex 运行出错'
      return [{ kind: 'error', message }]
    }

    return []
  }

  return {
    parse,
    item: (id) => items.get(id)
  }
}

export function buildCodexAppServerArgs(cli: AgentCli): string[] {
  return [...cli.prefixArgs, 'app-server', '--stdio']
}

/**
 * app-server 的线程权限：`on-request` + 工作区写权限。沙箱兜住工作区，
 * 越界、联网和高风险动作会变成审批请求交给审批卡。
 * 不写 `~/.codex`；Provider 配置只落在应用自己的 codex-home。
 */
function threadParams(cwd: string): Record<string, unknown> {
  return {
    cwd,
    approvalPolicy: 'on-request',
    permissions: ':workspace'
  }
}

export interface CodexAppServerExit {
  code: number | null
  stderr: string
  cancelled: boolean
}

export interface CodexAppServerRunOptions {
  prompt: string
  /** 续接 Codex 自己的 thread id */
  resumeId?: string
  cwd: string
  provider: ProviderRuntime
  /** 工具维护的 Codex home；Provider 必须隔离，不能读写 ~/.codex */
  home: string
  /** 本回合的本地 MCP 端点；只注入子进程环境，不写 token 到配置 */
  mcp?: McpEndpoint
  /** 用户启用的外部 MCP；密钥只进子进程环境，工具策略用于审批 */
  externalMcp?: CodexMcpRuntime
  /** 透传给 app-server 的客户端版本，仅用于握手标识 */
  clientVersion?: string
  /** 规则命中时在发卡前直接放行；返回命中作用域或 null */
  autoApprove?: (toolName: string) => 'session' | 'workspace' | null
  onEvent: (event: AgentRunEvent) => void
  onExit: (info: CodexAppServerExit) => void
  /** 省略时按环境解析；显式传 null 表示「没有可用的 CLI」 */
  cli?: AgentCli | null
}

export interface CodexAppServerHandle {
  sessionId: string
  cancel: () => void
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => boolean
}

interface PendingApproval {
  id: string | number
  method: string
  params: Record<string, unknown>
}

function approvalRequest(
  method: string,
  params: Record<string, unknown>,
  parser: CodexAppServerParser
): { request: AgentPermissionRequest; method: string } | null {
  const itemId = asString(params.itemId)
  if (!itemId) return null

  if (method === 'item/commandExecution/requestApproval') {
    const command = asString(params.command) ?? ''
    const reason = asString(params.reason)
    const detail = clip(command || reason || asString(params.cwd) || '')
    const preview = JSON.stringify({
      command: params.command ?? null,
      cwd: params.cwd ?? null,
      reason: params.reason ?? null,
      kind: params.kind ?? null,
      availableDecisions: params.availableDecisions ?? null
    })
    return {
      method,
      request: {
        requestId: '',
        toolName: 'Shell',
        toolUseId: itemId,
        detail,
        ...(reason ? { description: reason } : {}),
        inputPreview:
          preview.length > MAX_PREVIEW ? `${preview.slice(0, MAX_PREVIEW - 1)}…` : preview
      }
    }
  }

  if (method === 'item/fileChange/requestApproval') {
    const item = parser.item(itemId) ?? {}
    const paths = pathsOf(item)
    const reason = asString(params.reason)
    const preview = JSON.stringify({
      itemId,
      reason: params.reason ?? null,
      grantRoot: params.grantRoot ?? null,
      changes: paths
    })
    return {
      method,
      request: {
        requestId: '',
        toolName: 'Patch',
        toolUseId: itemId,
        detail: clip(paths.join(' · ')),
        description: reason ?? 'Codex 请求应用文件改动。',
        inputPreview:
          preview.length > MAX_PREVIEW ? `${preview.slice(0, MAX_PREVIEW - 1)}…` : preview
      }
    }
  }

  if (method === 'item/permissions/requestApproval') {
    const reason = asString(params.reason)
    const preview = JSON.stringify({
      cwd: params.cwd ?? null,
      reason: params.reason ?? null,
      permissions: params.permissions ?? null
    })
    return {
      method,
      request: {
        requestId: '',
        toolName: 'Permissions',
        toolUseId: itemId,
        detail: clip(reason ?? asString(params.cwd) ?? ''),
        description: reason ?? 'Codex 请求额外的文件或网络权限。',
        inputPreview:
          preview.length > MAX_PREVIEW ? `${preview.slice(0, MAX_PREVIEW - 1)}…` : preview
      }
    }
  }

  return null
}

/**
 * 启动一轮 `codex app-server --stdio`。用户文本、审批裁决都走 stdin JSON-RPC；
 * 命令行里只有固定 flag，不出现提示词、token 或用户路径。
 */
export function startCodexAppServerRun(options: CodexAppServerRunOptions): CodexAppServerHandle {
  const cli = options.cli === undefined ? resolveCodexCli() : options.cli
  const sessionId = randomUUID()
  let cancelled = false
  let settled = false
  let sawTerminal = false
  let stderr = ''
  let nextRequestId = 1
  let lineBuffer = ''
  let threadId = ''

  const parser = createCodexAppServerParser()
  const pendingApprovals = new Map<string, PendingApproval>()
  const requestMethods = new Map<number, string>()

  if (!cli) {
    options.onEvent({ kind: 'error', message: '未找到 Codex CLI，请先安装并登录 codex' })
    options.onExit({ code: null, stderr: '', cancelled: false })
    return { sessionId, cancel: () => {}, respondPermission: () => false }
  }

  try {
    writeCodexProviderConfig(options.home, options.provider, {
      ...(options.mcp ? { mcp: { url: options.mcp.url } } : {}),
      ...(options.externalMcp ? { external: options.externalMcp } : {})
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.onEvent({ kind: 'error', message: `写入 Codex Provider 配置失败：${message}` })
    options.onExit({ code: null, stderr: '', cancelled: false })
    return { sessionId, cancel: () => {}, respondPermission: () => false }
  }

  const child: ChildProcessWithoutNullStreams = spawn(cli.bin, buildCodexAppServerArgs(cli), {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(cli.viaNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      CODEX_HOME: options.home,
      WS_CODEX_PROVIDER_TOKEN: options.provider.token,
      ...(options.mcp ? { WS_CODEX_MCP_TOKEN: options.mcp.token } : {}),
      ...(options.externalMcp?.env ?? {})
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true
  })

  const send = (payload: Record<string, unknown>): boolean => {
    if (settled) return false
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
      return true
    } catch {
      return false
    }
  }

  const request = (method: string, params: Record<string, unknown>): number => {
    const id = nextRequestId
    nextRequestId += 1
    requestMethods.set(id, method)
    send({ id, method, params })
    return id
  }

  const finish = (code: number | null) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    flush('', true)
    pendingApprovals.clear()
    options.onExit({ code, stderr, cancelled })
  }

  const terminate = (code: number | null) => {
    if (settled) return
    child.kill()
    finish(code)
  }

  const fail = (message: string) => {
    if (settled) return
    options.onEvent({ kind: 'error', message })
    terminate(0)
  }

  const respondApproval = (
    id: string | number,
    method: string,
    params: Record<string, unknown>,
    allow: boolean
  ): boolean => {
    if (method === 'mcp_elicitation') {
      return send({
        id,
        result: {
          action: allow ? 'accept' : 'decline',
          content: allow ? {} : null,
          _meta: null
        }
      })
    }
    if (method === 'item/permissions/requestApproval') {
      const requested = asRecord(params.permissions) ?? {}
      const granted: Record<string, unknown> = {}
      if (allow) {
        if (asRecord(requested.network)) granted.network = requested.network
        if (asRecord(requested.fileSystem)) granted.fileSystem = requested.fileSystem
      }
      return send({ id, result: { permissions: granted, scope: 'turn' } })
    }
    return send({
      id,
      result: { decision: allow ? 'accept' : 'decline' }
    })
  }

  const handleServerRequest = (record: Record<string, unknown>) => {
    const method = asString(record.method)
    if (!method) return
    const id = numberId(record.id)
    if (id === null) return
    const params = asRecord(record.params) ?? {}

    const approval = approvalRequest(method, params, parser)
    if (approval) {
      if (options.autoApprove?.(approval.request.toolName)) {
        // 规则命中时不发卡也不登记 pending：本轮直接放行，审批链接不到它
        respondApproval(id, method, params, true)
        return
      }
      const requestId = String(id)
      approval.request.requestId = requestId
      pendingApprovals.set(requestId, { id, method, params })
      options.onEvent({ kind: 'permission', request: approval.request })
      return
    }

    if (method === 'mcpServer/elicitation/request') {
      const meta = asRecord(params._meta)
      if (asString(meta?.codex_approval_kind) === 'mcp_tool_call') {
        const serverName = asString(params.serverName) ?? 'MCP'
        const message = asString(params.message) ?? ''
        const namedTool =
          asString(meta?.tool_name) ?? message.match(/tool\s+"([^"]+)"/i)?.[1] ?? null
        // 名字解析不出来时仍用占位符查外部策略 / 展示详情，但审批卡不能冒充可持久工具
        const tool = namedTool ?? 'tool'
        if (serverName === 'workstationforone' && isReadOnlyMcpTool(tool)) {
          // 读工具已经在本地桥侧放行并审计，不再让用户重复点一次 Codex 审批。
          send({ id, result: { action: 'accept', content: {}, _meta: null } })
          return
        }
        // 外部 MCP 的工具级策略是第二道闸：allow 自动接受，deny 直接拒绝，
        // 其余（含没测过工具的新 Server）仍进入审批卡。
        const externalPolicy = options.externalMcp?.policies[serverName]?.[tool]
        if (externalPolicy === 'allow') {
          send({ id, result: { action: 'accept', content: {}, _meta: null } })
          return
        }
        if (externalPolicy === 'deny') {
          send({ id, result: { action: 'decline', content: null, _meta: null } })
          return
        }
        // 未解析出工具名时不伪装成 `MCP · server/tool`：该前缀是工作区规则的资格标记
        const toolName = namedTool
          ? `MCP · ${serverName}/${tool}`
          : `MCP 未解析工具 · ${serverName}`
        if (options.autoApprove?.(toolName)) {
          send({ id, result: { action: 'accept', content: {}, _meta: null } })
          return
        }
        const description = asString(meta?.tool_description)
        const preview = JSON.stringify({
          serverName,
          tool,
          toolParams: meta?.tool_params ?? {},
          message
        })
        const requestId = String(id)
        pendingApprovals.set(requestId, { id, method: 'mcp_elicitation', params })
        options.onEvent({
          kind: 'permission',
          request: {
            requestId,
            toolName,
            toolUseId: asString(params.turnId) ?? serverName,
            detail: clip(description ?? message),
            ...(description ? { description: `允许 ${serverName} 调用 ${tool}？` } : {}),
            inputPreview:
              preview.length > MAX_PREVIEW ? `${preview.slice(0, MAX_PREVIEW - 1)}…` : preview
          }
        })
        return
      }
      send({ id, result: { action: 'decline', content: null, _meta: null } })
      return
    }

    if (method === 'item/tool/requestUserInput') {
      send({ id, result: { answers: {} } })
      return
    }
    // 不认识的宿主请求不猜测回应方式，明确拒绝而不是私自放行。
    send({ id, error: { code: -32601, message: 'WorkStationForOne 不支持该宿主请求' } })
  }

  const handleNotification = (method: string, params: Record<string, unknown>) => {
    const events = parser.parse({ method, params })
    for (const event of events) {
      if (event.kind === 'result' || event.kind === 'error') sawTerminal = true
      options.onEvent(event)
    }
    if (method === 'turn/completed') {
      terminate(0)
      return
    }
    if (method === 'error' && params.willRetry !== true) terminate(0)
  }

  const handleResponse = (record: Record<string, unknown>) => {
    const id = typeof record.id === 'number' ? record.id : null
    if (id === null) return
    const method = requestMethods.get(id)
    if (!method) return
    requestMethods.delete(id)
    const error = asRecord(record.error)
    if (error) {
      const message = asString(error.message) ?? 'Codex app-server 请求失败'
      if (method === 'thread/resume') {
        fail(`无法续接 Codex 会话：${message}。请新建一个 Codex 会话。`)
      } else {
        fail(`Codex ${method} 失败：${message}`)
      }
      return
    }
    const result = asRecord(record.result) ?? {}

    if (method === 'initialize') {
      send({ method: 'initialized' })
      const params = { ...threadParams(options.cwd) }
      if (options.resumeId) {
        request('thread/resume', { threadId: options.resumeId, ...params })
      } else {
        request('thread/start', params)
      }
      return
    }

    if (method === 'thread/start' || method === 'thread/resume') {
      const thread = asRecord(result.thread)
      const idValue = asString(thread?.id)
      if (!idValue) {
        fail('Codex 未返回可用的线程 id')
        return
      }
      threadId = idValue
      options.onEvent({
        kind: 'init',
        sessionId: idValue,
        ...(asString(result.model) ? { model: asString(result.model) } : {})
      })
      request('turn/start', {
        threadId,
        input: [{ type: 'text', text: options.prompt }]
      })
      return
    }

    if (method === 'turn/start') {
      const turn = asRecord(result.turn)
      if (!turn || asString(turn.id) === undefined) {
        fail('Codex 未返回回合 id')
      }
    }
  }

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) return
    let payload: unknown
    try {
      payload = JSON.parse(trimmed)
    } catch {
      return
    }
    const record = asRecord(payload)
    if (!record) return
    if (record.id !== undefined && record.method !== undefined) {
      handleServerRequest(record)
      return
    }
    if (record.id !== undefined) {
      handleResponse(record)
      return
    }
    const method = asString(record.method)
    if (!method) return
    handleNotification(method, asRecord(record.params) ?? {})
  }

  const flush = (chunk: string, final: boolean) => {
    lineBuffer += chunk
    const lines = lineBuffer.split(/\r?\n/)
    lineBuffer = final ? '' : (lines.pop() ?? '')
    for (const line of lines) handleLine(line)
    if (final && lineBuffer.trim()) handleLine(lineBuffer)
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => flush(chunk, false))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4000)
  })

  const timer = setTimeout(() => {
    cancelled = true
    terminate(null)
  }, RUN_TIMEOUT_MS)

  child.on('error', (error) => {
    if (settled) return
    options.onEvent({ kind: 'error', message: `启动 Codex app-server 失败：${error.message}` })
    finish(null)
  })
  child.on('close', (code) => {
    if (settled) return
    flush('', true)
    if (!cancelled && !sawTerminal) {
      if (code === 0) {
        options.onEvent({ kind: 'error', message: 'Codex 进程结束，但没有返回完成事件' })
      }
    }
    finish(code)
  })

  child.stdin.on('error', () => {
    // 进程提前退出时写 stdin 会 EPIPE，交给 close 处理
  })

  request('initialize', {
    clientInfo: {
      name: 'workstation-for-one',
      title: 'WorkStationForOne',
      version: options.clientVersion ?? '1.0.0'
    },
    capabilities: { experimentalApi: true }
  })

  return {
    sessionId,
    cancel: () => {
      cancelled = true
      child.kill()
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 1500)
    },
    respondPermission: (requestId, behavior) => {
      const pending = pendingApprovals.get(requestId)
      if (!pending || settled) return false
      pendingApprovals.delete(requestId)
      return respondApproval(pending.id, pending.method, pending.params, behavior === 'allow')
    }
  }
}
