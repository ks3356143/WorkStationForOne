import { existsSync, readFileSync, statSync } from 'node:fs'
import { delimiter, dirname, join, normalize } from 'node:path'

export interface AgentCli {
  bin: string
  /** 用 node 执行脚本时的前置参数（stub 或 npm 包装指向 .js 的场景） */
  prefixArgs: string[]
  viaNode: boolean
}

const MAX_SHIM_BYTES = 64 * 1024
const WINDOWS_SHIM = /\.cmd$/i
const NODE_SCRIPT = /\.(c?js|mjs)$/i

function isNodeScript(path: string): boolean {
  return NODE_SCRIPT.test(path)
}

/**
 * 从 npm 生成的 .cmd 包装里取出真正的入口。
 * npm 在 Windows 上写的是 `"%dp0%\node_modules\...\cli.exe" %*` 或
 * `"%dp0%\node_modules\...\cli.js" %*`；直接 spawn .cmd 会 EINVAL。
 */
export function shimTarget(
  text: string,
  dir: string,
  exists: (path: string) => boolean = () => true
): string | null {
  const expanded = text.replace(/%~dp0/gi, () => `${dir}\\`).replace(/%dp0%/gi, () => `${dir}\\`)
  const matches = [...expanded.matchAll(/"([^"\r\n]+\.(?:exe|js|cjs|mjs))"/gi)]
  const candidates = matches.map((match) => normalize(match[1])).filter(Boolean)
  const usable = candidates.filter(exists)
  return usable.find((candidate) => /\.exe$/i.test(candidate)) ?? usable[0] ?? null
}

function fromPath(path: string): AgentCli | null {
  if (isNodeScript(path)) {
    return { bin: process.execPath, prefixArgs: [path], viaNode: true }
  }
  return { bin: path, prefixArgs: [], viaNode: false }
}

function unwrapShim(path: string): AgentCli | null {
  try {
    if (statSync(path).size > MAX_SHIM_BYTES) return null
    const target = shimTarget(readFileSync(path, 'utf8'), dirname(path), existsSync)
    if (!target) return null
    return fromPath(target)
  } catch {
    return null
  }
}

function resolvePath(path: string): AgentCli | null {
  if (WINDOWS_SHIM.test(path)) return unwrapShim(path)
  return fromPath(path)
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

function resolveNamed(name: string, overrideName: string, env: NodeJS.ProcessEnv): AgentCli | null {
  const override = env[overrideName]?.trim()
  if (override) return resolvePath(override)
  const found = findByPath(name, env)
  return found ? resolvePath(found) : null
}

/**
 * 解析要启动的 Claude CLI：
 * 1. WS_AGENT_CLI 显式指定（冒烟用 stub，绝不碰真实模型与额度）
 * 2. PATH 上的 claude
 * 找不到返回 null，由调用方明确报错，不要静默退回演示数据。
 */
export function resolveAgentCli(env: NodeJS.ProcessEnv = process.env): AgentCli | null {
  return resolveNamed('claude', 'WS_AGENT_CLI', env)
}

/** Codex 与 Claude 共用同一套包装解析；测试只能指向 stub。 */
export function resolveCodexCli(env: NodeJS.ProcessEnv = process.env): AgentCli | null {
  return resolveNamed('codex', 'WS_CODEX_CLI', env)
}
