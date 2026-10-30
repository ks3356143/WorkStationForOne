import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRunEvent } from '../../shared/agent-stream'
import type { ProviderRuntime } from '../providers'
import { resolveCodexCli, type AgentCli } from './cli'

const RUN_TIMEOUT_MS = 10 * 60 * 1000
const MAX_DETAIL = 120

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

function itemStatus(item: Record<string, unknown>): string {
  return asString(item.status) ?? 'in_progress'
}

/**
 * 只读沙箱 + 不询问审批：Codex 的 `exec` 没有 Claude 那样的宿主审批信道，
 * 与其加 --dangerously-* 或私自放行写入，不如让它在 read-only 沙箱里跑。
 * `-c` 只作用于这一轮子进程，不写 ~/.codex/config.toml。
 */
export function buildCodexArgs(cli: AgentCli, resumeId?: string): string[] {
  const common = [
    '--json',
    '--skip-git-repo-check',
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    'approval_policy="never"'
  ]
  if (resumeId) {
    return [...cli.prefixArgs, 'exec', 'resume', ...common, resumeId, '-']
  }
  return [...cli.prefixArgs, 'exec', ...common, '--sandbox', 'read-only', '-']
}

function toolName(item: Record<string, unknown>, type: string): string | null {
  switch (type) {
    case 'command_execution':
      return 'Shell'
    case 'file_change':
      return 'Patch'
    case 'mcp_tool_call': {
      const server = asString(item.server)
      const tool = asString(item.tool)
      return server && tool ? `${server}/${tool}` : 'MCP'
    }
    case 'web_search':
      return 'WebSearch'
    case 'collab_tool_call': {
      const tool = asString(item.tool)
      return tool ? `Collab ${tool}` : 'Collab'
    }
    default:
      return null
  }
}

function toolDetail(item: Record<string, unknown>, type: string): string {
  switch (type) {
    case 'command_execution':
      return clip(asString(item.command) ?? '')
    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes : []
      const paths = changes
        .map((change) => asString(asRecord(change)?.path))
        .filter((path): path is string => Boolean(path))
      return clip(paths.join(' · '))
    }
    case 'mcp_tool_call':
      return clip(JSON.stringify(item.arguments ?? {}))
    case 'web_search':
      return clip(asString(item.query) ?? '')
    case 'collab_tool_call': {
      const receivers = Array.isArray(item.receiver_thread_ids)
        ? item.receiver_thread_ids.filter((id): id is string => typeof id === 'string')
        : []
      return clip(receivers.join(' · '))
    }
    default:
      return ''
  }
}

function resultOk(item: Record<string, unknown>, type: string): boolean {
  const status = itemStatus(item)
  if (status === 'failed' || status === 'declined') return false
  if (type !== 'command_execution') return true
  const exitCode = item.exit_code
  return exitCode === null || exitCode === undefined || exitCode === 0
}

function resultDetail(item: Record<string, unknown>, type: string): string {
  if (type === 'command_execution') return clip(asString(item.aggregated_output) ?? '')
  if (type === 'mcp_tool_call') return clip(asString(asRecord(item.error)?.message) ?? '')
  return ''
}

/**
 * 解析 `codex exec --json` 的一行。事件类型见 ThreadEvent：
 * thread.started / item.started|updated|completed / turn.completed|failed / error。
 * 只渲染工具、正文和结论；reasoning 是模型的内部推理摘要，不展示。
 */
export function parseCodexLine(line: string): AgentRunEvent[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return []

  let payload: unknown
  try {
    payload = JSON.parse(trimmed)
  } catch {
    return []
  }
  const record = asRecord(payload)
  if (!record) return []

  const type = asString(record.type)
  if (type === 'thread.started') {
    const sessionId = asString(record.thread_id)
    return sessionId ? [{ kind: 'init', sessionId }] : []
  }
  if (type === 'turn.completed') return [{ kind: 'result', ok: true }]
  if (type === 'turn.failed') {
    const message = asString(asRecord(record.error)?.message) ?? 'Codex 回合失败'
    return [{ kind: 'error', message }]
  }
  if (type === 'error') {
    return [{ kind: 'error', message: asString(record.message) ?? 'Codex 运行出错' }]
  }
  if (type !== 'item.started' && type !== 'item.updated' && type !== 'item.completed') {
    return []
  }

  const item = asRecord(record.item)
  if (!item) return []
  const itemType = asString(item.type)
  const id = asString(item.id)
  if (!itemType || !id) return []

  if (itemType === 'agent_message') {
    if (type !== 'item.completed') return []
    const text = asString(item.text)
    return text ? [{ kind: 'text', text }] : []
  }

  const name = toolName(item, itemType)
  if (!name) return []
  const events: AgentRunEvent[] = [{ kind: 'tool', id, name, detail: toolDetail(item, itemType) }]
  if (type === 'item.completed') {
    events.push({
      kind: 'tool-result',
      id,
      ok: resultOk(item, itemType),
      detail: resultDetail(item, itemType)
    })
  }
  return events
}

export interface CodexRunOptions {
  prompt: string
  /** 续接上一轮时传 Codex 自己的 thread id */
  resumeId?: string
  cwd: string
  /** 工具自己的 Provider；设置后使用隔离的 CODEX_HOME，不碰 ~/.codex */
  provider?: ProviderRuntime
  /** 工具维护的 Codex home；provider 存在时必须提供 */
  home?: string
  onEvent: (event: AgentRunEvent) => void
  onExit: (info: { code: number | null; stderr: string; cancelled: boolean }) => void
  /** 省略时按环境解析；显式传 null 表示「没有可用的 CLI」 */
  cli?: AgentCli | null
}

/** 写入工具自己的 Codex 配置；token 只通过子进程环境注入，不落文件。 */
export function writeCodexProviderConfig(home: string, provider: ProviderRuntime): void {
  mkdirSync(home, { recursive: true })
  const config = [
    `model = ${JSON.stringify(provider.model)}`,
    'model_provider = "workstation"',
    '',
    '[model_providers.workstation]',
    'name = "WorkStationForOne"',
    `base_url = ${JSON.stringify(provider.baseUrl)}`,
    `wire_api = ${JSON.stringify(provider.wireApi)}`,
    'env_key = "WS_CODEX_PROVIDER_TOKEN"',
    'requires_openai_auth = false',
    ''
  ].join('\n')
  writeFileSync(join(home, 'config.toml'), config, { encoding: 'utf8', mode: 0o600 })
}

export interface CodexRunHandle {
  sessionId: string
  cancel: () => void
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => boolean
}

/**
 * 启动一次 `codex exec --json`：提示词走 stdin，stdout 按 JSONL 解析。
 * 每轮一个进程，续接靠 thread_id；不修改用户的 Codex 配置或登录状态。
 */
export function startCodexRun(options: CodexRunOptions): CodexRunHandle {
  const cli = options.cli === undefined ? resolveCodexCli() : options.cli
  const sessionId = randomUUID()
  let cancelled = false
  let settled = false
  let sawResult = false
  let sawError = false
  let stderr = ''

  if (!cli) {
    options.onEvent({ kind: 'error', message: '未找到 Codex CLI，请先安装并登录 codex' })
    options.onExit({ code: null, stderr: '', cancelled: false })
    return { sessionId, cancel: () => {}, respondPermission: () => false }
  }

  if (options.provider && !options.home) {
    options.onEvent({ kind: 'error', message: 'Codex Provider 缺少隔离目录' })
    options.onExit({ code: null, stderr: '', cancelled: false })
    return { sessionId, cancel: () => {}, respondPermission: () => false }
  }
  if (options.provider && options.home) {
    writeCodexProviderConfig(options.home, options.provider)
  }

  const args = buildCodexArgs(cli, options.resumeId)
  const child: ChildProcessWithoutNullStreams = spawn(cli.bin, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(cli.viaNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      ...(options.provider
        ? {
            CODEX_HOME: options.home,
            WS_CODEX_PROVIDER_TOKEN: options.provider.token
          }
        : {})
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    // 参数只有常量与 thread id，用户文本全部走 stdin
    shell: false,
    windowsHide: true
  })

  const handleLine = (line: string) => {
    for (const event of parseCodexLine(line)) {
      if (event.kind === 'result') sawResult = true
      if (event.kind === 'error') sawError = true
      options.onEvent(event)
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
    stderr = `${stderr}${chunk}`.slice(-4000)
  })

  const settle = (code: number | null) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    flush('', true)
    if (!cancelled && !sawResult && !sawError && code === 0) {
      sawResult = true
      options.onEvent({ kind: 'result', ok: true })
    }
    options.onExit({ code, stderr, cancelled })
  }

  const timer = setTimeout(() => {
    cancelled = true
    child.kill()
  }, RUN_TIMEOUT_MS)

  child.on('error', (error) => {
    options.onEvent({ kind: 'error', message: `启动 Codex CLI 失败：${error.message}` })
    settle(null)
  })
  child.on('close', (code) => settle(code))

  child.stdin.on('error', () => {
    // CLI 提前退出时写 stdin 会 EPIPE，交给 close 处理
  })
  child.stdin.end(options.prompt)

  return {
    sessionId,
    cancel: () => {
      cancelled = true
      child.kill()
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 1500)
    },
    respondPermission: () => false
  }
}
