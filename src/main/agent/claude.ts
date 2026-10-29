import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
 * 只读工具白名单。写入类工具一律不开，也不允许 --dangerously-* 之类的开关：
 * v1 的 Agent 只能读，不能静默改用户的文件。
 */
export const CLAUDE_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'LS'] as const

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
  sessionId?: string
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
    '--allowedTools',
    ...CLAUDE_ALLOWED_TOOLS
  ]
  if (provider) args.push('--setting-sources', 'project', '--model', provider.model)
  if (resumeId) args.push('--resume', resumeId)
  else if (sessionId) args.push('--session-id', sessionId)
  return args
}

export interface ClaudeRunOptions {
  prompt: string
  /** 续接上一轮时传 Claude 自己的 session id */
  resumeId?: string
  cwd: string
  provider?: ProviderRuntime
  onEvent: (event: AgentRunEvent) => void
  onExit: (info: { code: number | null; stderr: string; cancelled: boolean }) => void
  /** 省略时按环境解析；显式传 null 表示「没有可用的 CLI」 */
  cli?: AgentCli | null
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

  const args = buildClaudeArgs(cli, options.resumeId, options.provider, sessionId)
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
