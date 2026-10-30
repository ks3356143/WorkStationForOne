import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolveCommand } from '../agent/cli'

const PROTOCOL_VERSION = '2025-06-18'
const DEFAULT_TIMEOUT = 10_000
const MAX_OUTPUT = 1024 * 1024

export interface McpProbeInput {
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  version: string
  timeoutMs?: number
}

export interface McpToolInfo {
  name: string
  description: string
  readOnly: boolean
  destructive: boolean
}

export interface McpProbeResult {
  tools: McpToolInfo[]
}

interface JsonRpcResponse {
  id?: number | string
  result?: unknown
  error?: { code?: number; message?: string }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function toolInfoFrom(value: unknown): McpToolInfo[] {
  const result = asRecord(value)
  const tools = Array.isArray(result.tools) ? result.tools : []
  return tools
    .map((tool) => {
      const record = asRecord(tool)
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      if (!name) return null
      const annotations = asRecord(record.annotations)
      const readOnly =
        record.readOnlyHint === true ||
        annotations.readOnlyHint === true ||
        record.readOnly === true
      const destructive = record.destructiveHint === true || annotations.destructiveHint === true
      return {
        name,
        description: typeof record.description === 'string' ? record.description.trim() : '',
        readOnly,
        destructive
      }
    })
    .filter((tool): tool is McpToolInfo => tool !== null)
}

function rpcError(response: JsonRpcResponse): string {
  const message = response.error?.message
  return typeof message === 'string' && message ? message : 'MCP Server 返回错误'
}

/**
 * npx / uvx 会再拉子进程；只 kill 包装进程会留下真正运行 MCP Server 的 node。
 * Windows 用 taskkill /T 杀掉整棵树，避免测试连接后残留后台进程。
 */
function killTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) {
    child.kill()
    return
  }
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5000
      })
      return
    } catch {
      // 回退到普通 kill
    }
  }
  try {
    child.kill()
  } catch {
    // 进程可能已退出
  }
}

function initializeParams(version: string): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'WorkStationForOne', version }
  }
}

function probeStdio(input: McpProbeInput): Promise<McpProbeResult> {
  return new Promise((resolve, reject) => {
    const command = input.command ?? ''
    const resolved = resolveCommand(command)
    if (!resolved) {
      reject(new Error(`找不到 MCP 命令：${command}`))
      return
    }
    const child = spawn(resolved.bin, [...resolved.prefixArgs, ...(input.args ?? [])], {
      env: {
        ...process.env,
        ...input.env,
        ...(resolved.viaNode ? { ELECTRON_RUN_AS_NODE: '1' } : {})
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    }) as ChildProcessWithoutNullStreams
    let settled = false
    let initialized = false
    let buffer = ''
    let stderr = ''
    let stdoutBytes = 0
    const timer = setTimeout(() => {
      finish(new Error('MCP 连接超时'))
    }, input.timeoutMs ?? DEFAULT_TIMEOUT)

    const send = (payload: Record<string, unknown>) => {
      try {
        child.stdin.write(`${JSON.stringify(payload)}\n`)
      } catch {
        finish(new Error('MCP Server 已关闭输入'))
      }
    }

    const finish = (error?: Error, result?: McpProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      killTree(child)
      if (error) reject(error)
      else resolve(result ?? { tools: [] })
    }

    const onMessage = (message: JsonRpcResponse) => {
      if (message.id === 1) {
        if (message.error) {
          finish(new Error(rpcError(message)))
          return
        }
        initialized = true
        send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
        return
      }
      if (message.id === 2) {
        if (message.error) {
          finish(new Error(rpcError(message)))
          return
        }
        finish(undefined, { tools: toolInfoFrom(message.result) })
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_OUTPUT) {
        finish(new Error('MCP Server 输出过大'))
        return
      }
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) {
          try {
            onMessage(JSON.parse(line) as JsonRpcResponse)
          } catch {
            // 忽略非 JSON 日志
          }
        }
        index = buffer.indexOf('\n')
      }
    })
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 2000) stderr += chunk.slice(0, 2000 - stderr.length)
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (!settled) {
        const detail = stderr.trim().split(/\r?\n/).at(-1) ?? ''
        finish(
          new Error(
            initialized
              ? `MCP Server 提前退出${code === null ? '' : `（${code}）`}${detail ? `：${detail}` : ''}`
              : detail || `MCP Server 退出${code === null ? '' : `（${code}）`}`
          )
        )
      }
    })

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: initializeParams(input.version)
    })
  })
}

function parseRpcText(text: string, id: number, contentType: string): JsonRpcResponse {
  if (contentType.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      const value = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (!value || value === '[DONE]') continue
      try {
        const parsed = JSON.parse(value) as JsonRpcResponse
        if (parsed.id === id) return parsed
      } catch {
        // 继续找下一行
      }
    }
    throw new Error('MCP SSE 响应里没有 initialize 结果')
  }
  const parsed = JSON.parse(text) as JsonRpcResponse
  if (parsed.id !== id) throw new Error('MCP 响应 id 不匹配')
  return parsed
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
}

async function probeHttp(input: McpProbeInput): Promise<McpProbeResult> {
  const url = input.url ?? ''
  if (!/^https?:\/\//i.test(url)) throw new Error('MCP URL 无效')
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT
  const baseHeaders: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
    ...input.headers
  }
  const initResponse = await postJson(
    url,
    baseHeaders,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: initializeParams(input.version)
    },
    timeoutMs
  )
  if (!initResponse.ok) throw new Error(`MCP HTTP ${initResponse.status}`)
  const sessionId = initResponse.headers.get('mcp-session-id')
  const contentType = initResponse.headers.get('content-type') ?? ''
  const init = parseRpcText(await initResponse.text(), 1, contentType)
  if (init.error) throw new Error(rpcError(init))
  const headers = sessionId ? { ...baseHeaders, 'mcp-session-id': sessionId } : baseHeaders

  const notification = await postJson(
    url,
    headers,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    timeoutMs
  )
  if (!notification.ok && notification.status !== 202 && notification.status !== 204) {
    throw new Error(`MCP initialized 通知失败：HTTP ${notification.status}`)
  }
  const listResponse = await postJson(
    url,
    headers,
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    timeoutMs
  )
  if (!listResponse.ok) throw new Error(`MCP HTTP ${listResponse.status}`)
  const listType = listResponse.headers.get('content-type') ?? ''
  const list = parseRpcText(await listResponse.text(), 2, listType)
  if (list.error) throw new Error(rpcError(list))
  return { tools: toolInfoFrom(list.result) }
}

/** 连接一次外部 MCP Server，完成 initialize + tools/list 后立刻退出。 */
export async function probeMcpServer(input: McpProbeInput): Promise<McpProbeResult> {
  if (input.transport === 'http') return probeHttp(input)
  return probeStdio(input)
}
