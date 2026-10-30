import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import type { AgentMessageRecord, AgentToolRecord } from '../../shared/ipc'
import { findLocalSessionFile, looksSystemic, stripSystemTags } from './discover'

export const MAX_HISTORY_MESSAGES = 200
export const MAX_HISTORY_BYTES = 2 * 1024 * 1024
export const MAX_HISTORY_TOOLS = 20

const MAX_TOOL_META = 80

interface LineRecord {
  value: Record<string, unknown>
  index: number
}

function readHistoryText(file: string): string {
  try {
    const size = statSync(file).size
    if (size <= MAX_HISTORY_BYTES) return readFileSync(file, 'utf8')
    let fd: number | null = null
    try {
      fd = openSync(file, 'r')
      const buffer = Buffer.alloc(MAX_HISTORY_BYTES)
      const bytes = readSync(fd, buffer, 0, MAX_HISTORY_BYTES, size - MAX_HISTORY_BYTES)
      const text = buffer.subarray(0, bytes).toString('utf8')
      const firstBreak = text.indexOf('\n')
      return firstBreak >= 0 ? text.slice(firstBreak + 1) : ''
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd)
        } catch {
          // 忽略关闭失败
        }
      }
    }
  } catch {
    return ''
  }
}

function parseJsonLines(content: string): LineRecord[] {
  const result: LineRecord[] = []
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const value = JSON.parse(trimmed) as unknown
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result.push({ value: value as Record<string, unknown>, index })
      }
    } catch {
      // 跳过半截或异常行
    }
  }
  return result
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const record = asRecord(block)
      if (!record) return ''
      if (record.type !== 'text' && record.type !== 'input_text' && record.type !== 'output_text') {
        return ''
      }
      return typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function clock(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function timeLabel(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function clip(value: string, max = MAX_TOOL_META): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function summarizeToolInput(input: unknown): string {
  if (typeof input === 'string') {
    const raw = input.trim()
    if (!raw) return ''
    try {
      return summarizeToolInput(JSON.parse(raw) as unknown)
    } catch {
      return clip(raw)
    }
  }
  const record = asRecord(input)
  if (record) {
    for (const key of [
      'file_path',
      'path',
      'command',
      'pattern',
      'query',
      'url',
      'description',
      'title',
      'name'
    ]) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return clip(value)
    }
    try {
      return clip(JSON.stringify(record))
    } catch {
      return ''
    }
  }
  return input === undefined || input === null ? '' : clip(String(input))
}

function toRecord(
  sessionId: string,
  agent: 'claude' | 'codex',
  resumeId: string,
  index: number,
  role: 'user' | 'assistant',
  text: string,
  createdAt: number
): AgentMessageRecord {
  return {
    id: `import-${agent}-${resumeId}-${index}`,
    sessionId,
    role,
    text,
    timeLabel: timeLabel(createdAt),
    createdAt,
    origin: 'import'
  }
}

function fallbackTimestamp(last: number, now: number): number {
  return last > 0 ? last + 1 : now
}

function toolCard(id: string, name: string, input: unknown, status = '历史'): AgentToolRecord {
  return { id, name, meta: summarizeToolInput(input), status }
}

/**
 * Claude Code JSONL：读用户/助手正文与 tool_use；tool_result 只用来回填状态。
 * 工具输出、thinking、meta 行不导入。
 */
export function parseClaudeHistory(
  sessionId: string,
  resumeId: string,
  content: string,
  now = Date.now()
): AgentMessageRecord[] {
  const messages: AgentMessageRecord[] = []
  const toolsById = new Map<string, AgentToolRecord>()
  let toolSeq = 0
  let lastTime = 0

  for (const { value: line } of parseJsonLines(content)) {
    if (line.type !== 'user' && line.type !== 'assistant') continue
    if (line.isMeta === true) continue
    const message = asRecord(line.message)
    if (!message) continue

    const resultBlocks =
      Array.isArray(message.content) && line.type === 'user'
        ? message.content
            .map((block) => asRecord(block))
            .filter((block): block is Record<string, unknown> => block?.type === 'tool_result')
        : []
    if (resultBlocks.length > 0) {
      for (const block of resultBlocks) {
        const toolId = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
        const card = toolsById.get(toolId)
        if (card) card.status = block.is_error === true ? '失败' : '完成'
      }
      continue
    }

    const tools: AgentToolRecord[] = []
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        const record = asRecord(block)
        if (record?.type !== 'tool_use') continue
        const name = typeof record.name === 'string' ? record.name : ''
        if (!name) continue
        const sourceId = typeof record.id === 'string' ? record.id : ''
        const id = sourceId || `hist-${toolSeq}`
        if (tools.length >= MAX_HISTORY_TOOLS) break
        const card = toolCard(`import-tool-${resumeId}-${toolSeq}`, name, record.input)
        toolSeq += 1
        tools.push(card)
        toolsById.set(id, card)
      }
    }

    const text = stripSystemTags(contentText(message.content)).trim()
    if (!text && tools.length === 0) continue
    if (line.type === 'user' && looksSystemic(text)) continue

    const createdAt = clock(line.timestamp) ?? fallbackTimestamp(lastTime, now)
    lastTime = createdAt
    const record = toRecord(
      sessionId,
      'claude',
      resumeId,
      messages.length,
      line.type,
      text,
      createdAt
    )
    if (tools.length > 0) record.tools = tools
    messages.push(record)
  }

  return messages.slice(-MAX_HISTORY_MESSAGES)
}

/** Codex rollout：读 response_item.message 正文与 function_call；output 只回填状态。 */
export function parseCodexHistory(
  sessionId: string,
  resumeId: string,
  content: string,
  now = Date.now()
): AgentMessageRecord[] {
  const messages: AgentMessageRecord[] = []
  const toolsById = new Map<string, AgentToolRecord>()
  let pendingTools: AgentToolRecord[] = []
  let toolSeq = 0
  let lastTime = 0

  const flushPending = (createdAt: number) => {
    if (pendingTools.length === 0) return
    const record = toRecord(
      sessionId,
      'codex',
      resumeId,
      messages.length,
      'assistant',
      '',
      createdAt
    )
    record.tools = pendingTools
    messages.push(record)
    pendingTools = []
  }

  for (const { value: line } of parseJsonLines(content)) {
    if (line.type !== 'response_item') continue
    const payload = asRecord(line.payload)
    if (!payload) continue

    if (payload.type === 'function_call') {
      const name = typeof payload.name === 'string' ? payload.name : ''
      if (!name) continue
      if (pendingTools.length >= MAX_HISTORY_TOOLS) continue
      const callId = typeof payload.call_id === 'string' ? payload.call_id : ''
      const id = callId || `hist-${toolSeq}`
      const card = toolCard(`import-tool-${resumeId}-${toolSeq}`, name, payload.arguments)
      toolSeq += 1
      pendingTools.push(card)
      toolsById.set(id, card)
      continue
    }

    if (payload.type === 'function_call_output') {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : ''
      const card = toolsById.get(callId)
      if (card) {
        card.status = payload.output === undefined || payload.output === null ? '历史' : '完成'
      }
      continue
    }

    if (payload.type !== 'message') continue

    const role = payload.role
    if (role !== 'user' && role !== 'assistant') continue
    const text = stripSystemTags(contentText(payload.content)).trim()
    if (!text) continue
    if (role === 'user' && looksSystemic(text)) continue

    const createdAt = clock(line.timestamp) ?? fallbackTimestamp(lastTime, now)
    lastTime = createdAt
    if (role === 'user') flushPending(Math.max(createdAt - 1, 0))
    const tools = role === 'assistant' && pendingTools.length > 0 ? pendingTools : []
    if (role === 'assistant') pendingTools = []
    const record = toRecord(sessionId, 'codex', resumeId, messages.length, role, text, createdAt)
    if (tools.length > 0) record.tools = tools
    messages.push(record)
  }

  flushPending(lastTime || now)
  return messages.slice(-MAX_HISTORY_MESSAGES)
}

export interface SessionHistoryOptions {
  sessionId: string
  agent: 'claude' | 'codex'
  resumeId: string
  home: string
  scanRoot?: string
  now?: number
}

/** 读取本机会话历史；文件不存在或无法解析时返回空数组，不阻断导入。 */
export function readSessionHistory(options: SessionHistoryOptions): AgentMessageRecord[] {
  const file = findLocalSessionFile(options.home, options.agent, options.resumeId, options.scanRoot)
  if (!file) return []
  const content = readHistoryText(file)
  if (!content) return []
  return options.agent === 'claude'
    ? parseClaudeHistory(options.sessionId, options.resumeId, content, options.now)
    : parseCodexHistory(options.sessionId, options.resumeId, content, options.now)
}
