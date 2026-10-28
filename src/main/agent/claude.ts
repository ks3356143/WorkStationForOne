import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { parseAgentLine, type AgentRunEvent } from '../../shared/agent-stream'

export interface AgentCli {
  bin: string
  /** 用 node 执行脚本时的前置参数（WS_AGENT_CLI 指向 .cjs 的场景） */
  prefixArgs: string[]
  viaNode: boolean
}

/**
 * 只读工具白名单。写入类工具一律不开，也不允许 --dangerously-* 之类的开关：
 * v1 的 Agent 只能读，不能静默改用户的文件。
 */
export const CLAUDE_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'LS'] as const

const RUN_TIMEOUT_MS = 10 * 60 * 1000

function isScript(path: string): boolean {
  return /\.(c?js|mjs)$/i.test(path)
}

/** 在 PATH 里找可执行文件；Windows 上优先 .exe，其次 .cmd。 */
function findByPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const candidates = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`] : [name]
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = join(dir, candidate)
      if (existsSync(full)) return full
    }
  }
  return null
}

/**
 * 解析要启动的 CLI：
 * 1. WS_AGENT_CLI 显式指定（冒烟用 stub，绝不碰真实模型与额度）
 * 2. PATH 上的 claude
 * 找不到返回 null，由调用方明确报错，不要静默退回演示数据。
 */
export function resolveAgentCli(env: NodeJS.ProcessEnv = process.env): AgentCli | null {
  const override = env.WS_AGENT_CLI?.trim()
  if (override) {
    if (isScript(override)) {
      return { bin: process.execPath, prefixArgs: [override], viaNode: true }
    }
    return { bin: override, prefixArgs: [], viaNode: false }
  }
  const found = findByPath('claude', env)
  if (!found) return null
  if (isScript(found)) return { bin: process.execPath, prefixArgs: [found], viaNode: true }
  return { bin: found, prefixArgs: [], viaNode: false }
}

export interface ClaudeRunOptions {
  prompt: string
  /** 续接上一轮时传 Claude 自己的 session id */
  resumeId?: string
  cwd: string
  onEvent: (event: AgentRunEvent) => void
  onExit: (info: { code: number | null; stderr: string; cancelled: boolean }) => void
  /** 省略时按环境解析；显式传 null 表示「没有可用的 CLI」 */
  cli?: AgentCli | null
}

export interface RunHandle {
  /** 新会话的 Claude session id，首轮结束后可用于 --resume */
  sessionId: string
  cancel: () => void
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
    return { sessionId, cancel: () => {} }
  }

  const args = [
    ...cli.prefixArgs,
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'default',
    '--allowedTools',
    ...CLAUDE_ALLOWED_TOOLS
  ]
  if (options.resumeId) args.push('--resume', options.resumeId)
  else args.push('--session-id', sessionId)

  const child: ChildProcessWithoutNullStreams = spawn(cli.bin, args, {
    cwd: options.cwd,
    env: cli.viaNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // 所有参数都是常量或 UUID，用户文本只走 stdin，因此不需要也不允许 shell
    shell: false,
    windowsHide: true
  })

  let buffer = ''
  const flush = (chunk: string, final: boolean) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = final ? '' : (lines.pop() ?? '')
    for (const line of lines) {
      for (const event of parseAgentLine(line)) options.onEvent(event)
    }
    if (final && buffer.trim()) {
      for (const event of parseAgentLine(buffer)) options.onEvent(event)
    }
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
  child.stdin.end(options.prompt)

  return {
    sessionId,
    cancel: () => {
      cancelled = true
      child.kill()
      // 给一点时间优雅退出，超时强杀，避免残留进程
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 1500)
    }
  }
}
