/** 一处文件改动的预览；内容已按主进程上限截断。 */
export interface AgentFileDiff {
  path: string
  /** 改动前内容；新增文件为空 */
  oldText: string
  /** 改动后内容；删除文件为空 */
  newText: string
  kind?: 'add' | 'update' | 'delete'
  /** 任一侧因大小限制被截断 */
  truncated?: boolean
  /** 只包含改动附近的片段，不是完整文件 */
  partial?: boolean
}

export interface AgentPermissionRequest {
  requestId: string
  toolName: string
  toolUseId: string
  /** 一行摘要，优先展示文件路径 / 命令 */
  detail: string
  description?: string
  /** 输入 JSON 的截断预览，供审批卡展开查看 */
  inputPreview: string
  /** 文件写入类工具的改动预览；没有可读内容时省略 */
  diffs?: AgentFileDiff[]
  /** 主进程判定该工具是否可「此工作区允许」；渲染层只用于决定按钮是否显示 */
  workspaceScope?: boolean
}

export interface AgentQuestionOption {
  label: string
  description?: string
  preview?: string
}

export interface AgentQuestion {
  question: string
  header: string
  options: AgentQuestionOption[]
  multiSelect?: boolean
}

export interface AgentQuestionRequest {
  requestId: string
  toolUseId: string
  questions: AgentQuestion[]
}

/** 一次 Agent 运行推给渲染层的事件。kind 是判别式，渲染层按它分支。 */
export type AgentRunEvent =
  | { kind: 'init'; model?: string; sessionId?: string }
  | { kind: 'turn'; turnId: string }
  | { kind: 'text'; text: string; turnId?: string }
  | {
      kind: 'tool'
      id: string
      name: string
      detail: string
      diffs?: AgentFileDiff[]
      turnId?: string
    }
  | { kind: 'tool-result'; id: string; ok: boolean; detail: string; turnId?: string }
  | { kind: 'permission'; request: AgentPermissionRequest }
  | { kind: 'question'; request: AgentQuestionRequest }
  | {
      kind: 'result'
      ok: boolean
      costUsd?: number
      durationMs?: number
      turns?: number
      turnId?: string
    }
  | { kind: 'error'; message: string }
  /** CLI 进程已退出且成功结束；此时才允许同一会话开始下一轮 */
  | { kind: 'done' }

const MAX_DETAIL = 120
const MAX_ERROR = 900

/** CLI 只给 subtype 时也要说人话，不能把内部字段甩给用户。 */
const RESULT_SUBTYPE_MESSAGES: Record<string, string> = {
  error_during_execution: 'CLI 执行失败，但没有返回具体原因',
  error_max_turns: '达到最大轮次限制',
  error_max_budget_usd: '达到本轮预算上限',
  error_max_structured_output_retries: '结构化输出重试次数用尽'
}

function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat
}

function clipError(value: string): string {
  const flat = value.trim()
  return flat.length > MAX_ERROR ? `${flat.slice(0, MAX_ERROR - 1)}…` : flat
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

/** 工具事件的可选补充信息；主进程用它带上文件 diff，解析器本身保持纯函数。 */
export type AgentToolEnricher = (
  name: string,
  input: unknown
) => { diffs?: AgentFileDiff[] } | undefined

/**
 * 解析 `claude -p --output-format stream-json --verbose` 的一行。
 * 一行可能带多个内容块（文本 + 并行工具调用），所以返回数组。
 * 空行、非 JSON、不认识的事件都返回空数组：流里混进无关输出不该中断整轮。
 */
export function parseAgentLine(line: string, enrichTool?: AgentToolEnricher): AgentRunEvent[] {
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
        const extra = enrichTool?.(name, item.input)
        events.push({
          kind: 'tool',
          id,
          name,
          detail: summarizeToolInput(name, item.input),
          ...(extra?.diffs?.length ? { diffs: extra.diffs } : {})
        })
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
      const subtype = asString(record.subtype)
      const message =
        asString(record.result) ??
        (subtype ? (RESULT_SUBTYPE_MESSAGES[subtype] ?? subtype) : undefined) ??
        '执行失败'
      return [{ kind: 'error', message: clipError(message) }]
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
