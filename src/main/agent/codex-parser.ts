import type { AgentRunEvent } from '../../shared/agent-stream'

export const MAX_DETAIL = 120
export const MAX_PREVIEW = 1200
export const RUN_TIMEOUT_MS = 10 * 60 * 1000

export function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function numberId(value: unknown): string | number | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null
}

function itemStatus(item: Record<string, unknown>): string {
  return asString(item.status) ?? 'inProgress'
}

export function pathsOf(item: Record<string, unknown>): string[] {
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
