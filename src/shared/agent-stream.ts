export interface AgentPermissionRequest {
  requestId: string
  toolName: string
  toolUseId: string
  /** 一行摘要，优先展示文件路径 / 命令 */
  detail: string
  description?: string
  /** 输入 JSON 的截断预览，供审批卡展开查看 */
  inputPreview: string
}

/** 一次 Agent 运行推给渲染层的事件。kind 是判别式，渲染层按它分支。 */
export type AgentRunEvent =
  | { kind: 'init'; model?: string; sessionId?: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; detail: string }
  | { kind: 'tool-result'; id: string; ok: boolean; detail: string }
  | { kind: 'permission'; request: AgentPermissionRequest }
  | { kind: 'result'; ok: boolean; costUsd?: number; durationMs?: number; turns?: number }
  | { kind: 'error'; message: string }

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

/**
 * 工具调用摘要：卡片上只够放一行，优先展示「操作对象」而不是整个 input JSON。
 * 未识别的工具退回参数 JSON 的前若干字符。
 */
export function summarizeToolInput(name: string, input: unknown): string {
  const record = asRecord(input)
  if (!record) return ''
  const pick = (key: string) => asString(record[key])
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return clip(pick('file_path') ?? '')
    case 'Bash':
      return clip(pick('command') ?? '')
    case 'Grep':
      return clip(pick('pattern') ?? '')
    case 'Glob':
      return clip(pick('pattern') ?? '')
    case 'WebFetch':
      return clip(pick('url') ?? '')
    case 'Task':
      return clip(pick('description') ?? '')
    default: {
      const json = JSON.stringify(record)
      return clip(json === '{}' ? '' : json)
    }
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return clip(content)
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      const record = asRecord(block)
      if (!record) continue
      const text = asString(record.text)
      if (text) parts.push(text)
    }
    return clip(parts.join(' '))
  }
  return ''
}

/**
 * 解析 `claude -p --output-format stream-json --verbose` 的一行。
 * 一行可能带多个内容块（文本 + 并行工具调用），所以返回数组。
 * 空行、非 JSON、不认识的事件都返回空数组：流里混进无关输出不该中断整轮。
 */
export function parseAgentLine(line: string): AgentRunEvent[] {
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
  const sessionId = asString(record.session_id)

  if (type === 'system' && record.subtype === 'init') {
    return [{ kind: 'init', model: asString(record.model), sessionId }]
  }

  const message = asRecord(record.message)
  const content = message?.content

  if (type === 'assistant' && Array.isArray(content)) {
    const events: AgentRunEvent[] = []
    for (const block of content) {
      const item = asRecord(block)
      if (!item) continue
      if (item.type === 'text') {
        const text = asString(item.text)
        if (text) events.push({ kind: 'text', text })
      } else if (item.type === 'tool_use') {
        const id = asString(item.id)
        const name = asString(item.name)
        if (!id || !name) continue
        events.push({ kind: 'tool', id, name, detail: summarizeToolInput(name, item.input) })
      }
    }
    return events
  }

  if (type === 'user' && Array.isArray(content)) {
    const events: AgentRunEvent[] = []
    for (const block of content) {
      const item = asRecord(block)
      if (item?.type !== 'tool_result') continue
      const id = asString(item.tool_use_id)
      if (!id) continue
      events.push({
        kind: 'tool-result',
        id,
        ok: item.is_error !== true,
        detail: toolResultText(item.content)
      })
    }
    return events
  }

  if (type === 'result') {
    const failed = record.is_error === true || record.subtype !== 'success'
    if (failed) {
      const message = asString(record.result) ?? asString(record.subtype) ?? '执行失败'
      return [{ kind: 'error', message: clip(message) }]
    }
    return [
      {
        kind: 'result',
        ok: true,
        costUsd: typeof record.total_cost_usd === 'number' ? record.total_cost_usd : undefined,
        durationMs: typeof record.duration_ms === 'number' ? record.duration_ms : undefined,
        turns: typeof record.num_turns === 'number' ? record.num_turns : undefined
      }
    ]
  }

  return []
}

/** 把流式文本按块累积成一条消息：空块与重复的空白折叠掉。 */
export function appendStreamText(current: string, chunk: string): string {
  if (!chunk) return current
  return current ? `${current}${chunk}` : chunk
}
