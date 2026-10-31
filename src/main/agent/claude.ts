import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseAgentLine,
  summarizeToolInput,
  type AgentPermissionRequest,
  type AgentRunEvent
} from '../../shared/agent-stream'
import type { ProviderRuntime } from '../providers'
import { resolveAgentCli, type AgentCli } from './cli'

export { resolveAgentCli, type AgentCli } from './cli'

/**
 * CLI 侧的本地 MCP 工具白名单：5 个读取 + 6 个写入。写入工具的最终闸门是
 * 主进程的本地 MCP 桥（域权限 + 审批卡），所以允许 CLI 直接发起调用；
 * CLI 原生写入工具（Edit / Write / Bash）仍不得加入白名单。
 */
export const CLAUDE_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'LS',
  'mcp__workstationforone__tasks_list',
  'mcp__workstationforone__notes_search',
  'mcp__workstationforone__learning_due',
  'mcp__workstationforone__habits_summary',
  'mcp__workstationforone__today_overview',
  'mcp__workstationforone__tasks_create',
  'mcp__workstationforone__tasks_update',
  'mcp__workstationforone__tasks_complete',
  'mcp__workstationforone__habits_check',
  'mcp__workstationforone__learning_review',
  'mcp__workstationforone__notes_create'
] as const

const RUN_TIMEOUT_MS = 10 * 60 * 1000

export function providerEnv(provider?: ProviderRuntime): NodeJS.ProcessEnv | undefined {
  if (!provider) return undefined
  return {
    ANTHROPIC_BASE_URL: provider.baseUrl,
    ANTHROPIC_AUTH_TOKEN: provider.token,
    ANTHROPIC_MODEL: provider.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: provider.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: provider.model
  }
}

export function buildClaudeArgs(
  cli: AgentCli,
  resumeId?: string,
  provider?: ProviderRuntime,
  sessionId?: string,
  mcpConfigPath?: string,
  options?: { plugins?: string[]; allowedTools?: string[]; disallowedTools?: string[] }
): string[] {
  const args = [
    ...cli.prefixArgs,
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'manual',
    '--permission-prompts',
    'host',
    // 隔离：用户级 settings / MCP 不进入本应用的会话
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--allowedTools',
    ...new Set([...CLAUDE_ALLOWED_TOOLS, ...(options?.allowedTools ?? [])])
  ]
  if (options?.disallowedTools?.length) {
    args.push('--disallowedTools', ...new Set(options.disallowedTools))
  }
  if (provider) args.push('--model', provider.model)
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath)
  for (const plugin of options?.plugins ?? []) {
    args.push('--plugin-dir', plugin)
  }
  if (resumeId) args.push('--resume', resumeId)
  else if (sessionId) args.push('--session-id', sessionId)
  return args
}

export interface McpRuntimeEndpoint {
  url: string
  token: string
}

export interface McpServerConfig {
  name: string
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface ClaudeRunOptions {
  prompt: string
  /** 续接上一轮时传 Claude 自己的 session id */
  resumeId?: string
  cwd: string
  provider?: ProviderRuntime
  /** 本地只读 MCP 桥；token 只写进临时配置文件 */
  mcp?: McpRuntimeEndpoint
  /** 应用私有的外部 MCP Server；只在临时配置里出现 */
  mcpServers?: McpServerConfig[]
  /** 应用私有插件目录；只对本次会话生效 */
  plugins?: string[]
  /** 外部 MCP 工具白名单（allow），只影响本次会话 */
  allowedTools?: string[]
  /** 外部 MCP 工具拒绝列表（deny），只影响本次会话 */
  disallowedTools?: string[]
  /** 规则命中时在发卡前直接放行；返回命中作用域或 null */
  autoApprove?: (toolName: string) => 'session' | 'workspace' | null
  onEvent: (event: AgentRunEvent) => void
  onExit: (info: { code: number | null; stderr: string; cancelled: boolean }) => void
  /** 省略时按环境解析；显式传 null 表示「没有可用的 CLI」 */
  cli?: AgentCli | null
}

interface McpConfigFile {
  path: string
  cleanup: () => void
}

function writeMcpConfig(
  mcp?: McpRuntimeEndpoint,
  servers: McpServerConfig[] = []
): McpConfigFile | null {
  if (!mcp && servers.length === 0) return null
  try {
    const dir = mkdtempSync(join(tmpdir(), 'ws-mcp-'))
    const path = join(dir, 'mcp.json')
    const mcpServers: Record<string, unknown> = {}
    if (mcp) {
      mcpServers.workstationforone = {
        type: 'http',
        url: mcp.url,
        headers: { Authorization: `Bearer ${mcp.token}` }
      }
    }
    for (const server of servers) {
      if (server.type === 'stdio') {
        mcpServers[server.name] = {
          type: 'stdio',
          command: server.command ?? '',
          args: server.args ?? [],
          ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {})
        }
      } else {
        mcpServers[server.name] = {
          type: 'http',
          url: server.url ?? '',
          ...(server.headers && Object.keys(server.headers).length > 0
            ? { headers: server.headers }
            : {})
        }
      }
    }
    const config = { mcpServers }
    writeFileSync(path, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 })
    return {
      path,
      cleanup: () => {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // 临时配置删不掉不影响本轮结束
        }
      }
    }
  } catch {
    return null
  }
}

export interface RunHandle {
  /** 新会话的 Claude session id，首轮结束后可用于 --resume */
  sessionId: string
  cancel: () => void
  /** 回写 can_use_tool 的裁决；requestId 不存在时返回 false */
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => boolean
}

/**
 * 启动一次 `claude -p`：提示词走 stdin（不进命令行），stdout 逐行解析成事件。
 * 每轮一个进程，续接靠 --resume，避免维护长连接带来的状态机复杂度。
 */
export function startClaudeRun(options: ClaudeRunOptions): RunHandle {
  const cli = options.cli === undefined ? resolveAgentCli() : options.cli
  const sessionId = randomUUID()
  let cancelled = false
  let settled = false
  let stderr = ''

  if (!cli) {
    options.onEvent({ kind: 'error', message: '未找到 Claude CLI，请先安装并登录 claude' })
    options.onExit({ code: null, stderr: '', cancelled: false })
    return { sessionId, cancel: () => {}, respondPermission: () => false }
  }

  const mcpConfig = writeMcpConfig(options.mcp, options.mcpServers)
  if ((options.mcp || options.mcpServers?.length) && !mcpConfig) {
    console.error('[agent] MCP 临时配置写入失败，本轮不启用数据桥与外部 MCP')
  }
  const args = buildClaudeArgs(
    cli,
    options.resumeId,
    options.provider,
    sessionId,
    mcpConfig?.path,
    {
      ...(options.plugins ? { plugins: options.plugins } : {}),
      ...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
      ...(options.disallowedTools ? { disallowedTools: options.disallowedTools } : {})
    }
  )
  const overrides = providerEnv(options.provider)
  const childEnv = {
    ...process.env,
    ...(cli.viaNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    ...overrides
  }

  const child: ChildProcessWithoutNullStreams = spawn(cli.bin, args, {
    cwd: options.cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    // 所有参数都是常量或 UUID，用户文本只走 stdin，因此不需要也不允许 shell
    shell: false,
    windowsHide: true
  })

  const pendingPermissions = new Map<
    string,
    { input: Record<string, unknown>; toolUseId: string }
  >()
  let inputClosed = false
  const closeInput = () => {
    if (inputClosed) return
    inputClosed = true
    child.stdin.end()
  }

  const writeControlResponse = (requestId: string, response: Record<string, unknown>) => {
    if (inputClosed) return false
    child.stdin.write(
      `${JSON.stringify({
        type: 'control_response',
        response: { subtype: 'success', request_id: requestId, response }
      })}\n`
    )
    return true
  }

  const handleControlRequest = (payload: Record<string, unknown>): boolean => {
    if (payload.type !== 'control_request') return false
    const request = payload.request
    if (typeof request !== 'object' || request === null) return true
    const entry = request as Record<string, unknown>
    if (entry.subtype !== 'can_use_tool') return true
    const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
    const toolName = typeof entry.tool_name === 'string' ? entry.tool_name : ''
    const toolUseId = typeof entry.tool_use_id === 'string' ? entry.tool_use_id : ''
    if (!requestId || !toolName) return true
    if (toolName === 'AskUserQuestion') {
      // v1 的审批卡只处理工具权限，不实现宿主内问答。
      writeControlResponse(requestId, {
        behavior: 'deny',
        message: 'WorkStationForOne 暂不支持交互问答',
        toolUseID: toolUseId
      })
      return true
    }
    const input =
      typeof entry.input === 'object' && entry.input !== null
        ? (entry.input as Record<string, unknown>)
        : {}
    if (options.autoApprove?.(toolName)) {
      // 规则命中时不发卡也不登记 pending：本轮直接放行，审批链接不到它
      writeControlResponse(requestId, {
        behavior: 'allow',
        updatedInput: input,
        toolUseID: toolUseId
      })
      return true
    }
    const inputJson = JSON.stringify(input)
    const permissionRequest: AgentPermissionRequest = {
      requestId,
      toolName,
      toolUseId,
      detail: summarizeToolInput(toolName, input),
      inputPreview: inputJson.length > 1200 ? `${inputJson.slice(0, 1199)}…` : inputJson
    }
    if (typeof entry.description === 'string' && entry.description.trim()) {
      permissionRequest.description = entry.description.trim()
    }
    pendingPermissions.set(requestId, { input, toolUseId })
    options.onEvent({ kind: 'permission', request: permissionRequest })
    return true
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
    if (typeof payload === 'object' && payload !== null) {
      if (handleControlRequest(payload as Record<string, unknown>)) return
    }
    for (const event of parseAgentLine(trimmed)) {
      options.onEvent(event)
      if (event.kind === 'result' || event.kind === 'error') closeInput()
    }
  }

  let buffer = ''
  const flush = (chunk: string, final: boolean) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = final ? '' : (lines.pop() ?? '')
    for (const line of lines) handleLine(line)
    if (final && buffer.trim()) handleLine(buffer)
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => flush(chunk, false))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    // 只留尾部：CLI 的报错常常很长，整段留着没用
    stderr = `${stderr}${chunk}`.slice(-4000)
  })

  const settle = (code: number | null) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    pendingPermissions.clear()
    inputClosed = true
    flush('', true)
    mcpConfig?.cleanup()
    options.onExit({ code, stderr, cancelled })
  }

  const timer = setTimeout(() => {
    cancelled = true
    child.kill()
  }, RUN_TIMEOUT_MS)

  child.on('error', (error) => {
    options.onEvent({ kind: 'error', message: `启动 CLI 失败：${error.message}` })
    settle(null)
  })
  child.on('close', (code) => settle(code))

  child.stdin.on('error', () => {
    // CLI 提前退出时写 stdin 会 EPIPE，交给 close 处理，这里吞掉
  })
  // stream-json 输入：用户消息走 stdin，保持打开以接收 can_use_tool 的回写。
  child.stdin.write(
    `${JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: options.prompt }] },
      parent_tool_use_id: null
    })}\n`
  )

  return {
    sessionId,
    cancel: () => {
      cancelled = true
      child.kill()
      // 给一点时间优雅退出，超时强杀，避免残留进程
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 1500)
    },
    respondPermission: (requestId, behavior, message) => {
      const pending = pendingPermissions.get(requestId)
      if (!pending || inputClosed) return false
      const response =
        behavior === 'allow'
          ? {
              behavior: 'allow',
              updatedInput: pending.input,
              toolUseID: pending.toolUseId
            }
          : {
              behavior: 'deny',
              message: message?.trim() || '用户拒绝',
              toolUseID: pending.toolUseId
            }
      const ok = writeControlResponse(requestId, response as unknown as Record<string, unknown>)
      pendingPermissions.delete(requestId)
      return ok
    }
  }
}
