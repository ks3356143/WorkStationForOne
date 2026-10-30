import type { Dirent } from 'node:fs'
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DiscoveredAgentSession } from '../../shared/ipc'

const MAX_FILES = 300
const MAX_PER_AGENT = 60
const MAX_HEAD = 128 * 1024
const MAX_LINES = 240

interface ParsedSession {
  agent: 'claude' | 'codex'
  resumeId: string
  title: string
  workspace: string
  updatedAt: number
}

function readHead(file: string): string {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const buffer = Buffer.alloc(MAX_HEAD)
    const bytes = readSync(fd, buffer, 0, MAX_HEAD, 0)
    return buffer.subarray(0, bytes).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // 忽略关闭失败
      }
    }
  }
}

function walkFiles(root: string, depth: number, out: string[]): void {
  if (out.length >= MAX_FILES) return
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (entry.isSymbolicLink()) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (depth < 5) walkFiles(full, depth + 1, out)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full)
    }
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return ''
      const record = block as Record<string, unknown>
      if (record.type !== 'text' && record.type !== 'input_text') return ''
      return typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function cleanTitle(text: string, fallback: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat ? flat.slice(0, 60) : fallback
}

export function stripSystemTags(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/<local-command-[^>]*>[\s\S]*?<\/local-command-[^>]*>/gi, ' ')
    .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/gi, ' ')
    .trim()
}

/** Codex 有时把环境说明塞进 user 角色，不能当成会话标题或历史正文。 */
export function looksSystemic(text: string): boolean {
  const head = text.trimStart().toLowerCase()
  return (
    head.startsWith('<environment_context') ||
    head.startsWith('<user_instructions') ||
    head.startsWith('<permissions') ||
    head.startsWith('# agents.md')
  )
}

function parseLines(file: string): Record<string, unknown>[] {
  const head = readHead(file)
  const result: Record<string, unknown>[] = []
  for (const line of head.split(/\r?\n/).slice(0, MAX_LINES)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const value = JSON.parse(trimmed) as unknown
      if (typeof value === 'object' && value !== null) {
        result.push(value as Record<string, unknown>)
      }
    } catch {
      // 跳过半截/异常行
    }
  }
  return result
}

function parseClaude(file: string): ParsedSession | null {
  const lines = parseLines(file)
  const resumeId = basename(file, '.jsonl')
  if (!/^[0-9a-zA-Z-]+$/.test(resumeId)) return null
  let workspace = ''
  let summary = ''
  let title = ''
  for (const line of lines) {
    if (!workspace && typeof line.cwd === 'string') workspace = line.cwd
    if (!summary && line.type === 'summary' && typeof line.summary === 'string') {
      summary = stripSystemTags(line.summary)
    }
    if (!title && line.type === 'user' && line.isMeta !== true && !('toolUseResult' in line)) {
      const message =
        typeof line.message === 'object' && line.message !== null
          ? (line.message as Record<string, unknown>)
          : {}
      const text = stripSystemTags(textFromContent(message.content))
      if (text && !looksSystemic(text)) title = text
    }
  }
  if (!workspace) return null
  let updatedAt = Date.now()
  try {
    updatedAt = statSync(file).mtimeMs
  } catch {
    // 用当前时间兜底
  }
  return {
    agent: 'claude',
    resumeId,
    title: cleanTitle(summary || title, basename(workspace) || 'Claude 会话'),
    workspace,
    updatedAt
  }
}

function parseCodex(file: string): ParsedSession | null {
  const lines = parseLines(file)
  let workspace = ''
  let resumeId = ''
  let title = ''
  for (const line of lines) {
    const payload =
      typeof line.payload === 'object' && line.payload !== null
        ? (line.payload as Record<string, unknown>)
        : {}
    if (line.type === 'session_meta') {
      resumeId =
        typeof payload.session_id === 'string'
          ? payload.session_id
          : typeof payload.id === 'string'
            ? payload.id
            : ''
      if (!workspace && typeof payload.cwd === 'string') workspace = payload.cwd
    }
    if (!title && line.type === 'response_item' && payload.role === 'user') {
      const text = stripSystemTags(textFromContent(payload.content))
      if (text && !looksSystemic(text)) title = text
    }
    if (workspace && resumeId && title) break
  }
  if (!workspace || !resumeId) return null
  let updatedAt = Date.now()
  try {
    updatedAt = statSync(file).mtimeMs
  } catch {
    // 用当前时间兜底
  }
  return {
    agent: 'codex',
    resumeId,
    title: cleanTitle(title, basename(workspace) || 'Codex 会话'),
    workspace,
    updatedAt
  }
}

function existsDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * 只读发现本机 Claude / Codex CLI 的会话元数据。
 * scanRoot 同时作为 .claude / .codex 的父目录（自动化 fixture 用）。
 */
export function discoverLocalSessions(
  home: string,
  existing: Set<string>,
  scanRoot?: string
): DiscoveredAgentSession[] {
  const base = scanRoot ?? home
  const claudeFiles: string[] = []
  const codexFiles: string[] = []
  walkFiles(join(base, '.claude', 'projects'), 0, claudeFiles)
  walkFiles(join(base, '.codex', 'sessions'), 0, codexFiles)

  const byMtime = (a: string, b: string) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs
    } catch {
      return 0
    }
  }
  claudeFiles.sort(byMtime)
  codexFiles.sort(byMtime)

  const seen = new Set<string>()
  const result: DiscoveredAgentSession[] = []
  const add = (parsed: ParsedSession | null) => {
    if (!parsed) return
    const key = `${parsed.agent}:${parsed.resumeId}`
    if (seen.has(key)) return
    seen.add(key)
    result.push({
      ...parsed,
      workspaceExists: existsDirectory(parsed.workspace),
      imported: existing.has(key)
    })
  }
  for (const file of claudeFiles.slice(0, MAX_PER_AGENT)) add(parseClaude(file))
  for (const file of codexFiles.slice(0, MAX_PER_AGENT)) add(parseCodex(file))
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 按 resume id 找回本机 JSONL 文件，供导入历史使用。
 * 只读、最多扫 300 个文件；找不到时返回 null，导入仍成功但没有历史。
 */
export function findLocalSessionFile(
  home: string,
  agent: 'claude' | 'codex',
  resumeId: string,
  scanRoot?: string
): string | null {
  const base = scanRoot ?? home
  const files: string[] = []
  walkFiles(join(base, agent === 'claude' ? '.claude/projects' : '.codex/sessions'), 0, files)
  if (agent === 'claude') {
    return files.find((file) => basename(file, '.jsonl') === resumeId) ?? null
  }
  for (const file of files) {
    for (const line of parseLines(file)) {
      if (line.type !== 'session_meta') continue
      const payload =
        typeof line.payload === 'object' && line.payload !== null
          ? (line.payload as Record<string, unknown>)
          : {}
      const id =
        typeof payload.session_id === 'string'
          ? payload.session_id
          : typeof payload.id === 'string'
            ? payload.id
            : ''
      if (id === resumeId) return file
      break
    }
  }
  return null
}
