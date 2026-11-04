import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { parsePatch, structuredPatch } from 'diff'
import type { AgentFileDiff } from '../../shared/agent-stream'

const MAX_FILES = 6
const MAX_SIDE_CHARS = 24_000
const MAX_SIDE_LINES = 800
const MAX_FILE_BYTES = 512 * 1024
const FOCUS_LINES = 60

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function capText(value: string): { text: string; truncated: boolean } {
  let text = value
  let truncated = false
  const lines = text.split('\n')
  if (lines.length > MAX_SIDE_LINES) {
    text = lines.slice(0, MAX_SIDE_LINES).join('\n')
    truncated = true
  }
  if (text.length > MAX_SIDE_CHARS) {
    text = text.slice(0, MAX_SIDE_CHARS)
    const cut = text.lastIndexOf('\n')
    if (cut > MAX_SIDE_CHARS / 2) text = text.slice(0, cut)
    truncated = true
  }
  return { text, truncated }
}

function createDiff(
  path: string,
  oldText: string,
  newText: string,
  kind: AgentFileDiff['kind'],
  options: { partial?: boolean; truncated?: boolean } = {}
): AgentFileDiff {
  const oldSide = capText(oldText)
  const newSide = capText(newText)
  return {
    path: path.replaceAll('\\', '/'),
    oldText: oldSide.text,
    newText: newSide.text,
    ...(kind ? { kind } : {}),
    ...(oldSide.truncated || newSide.truncated || options.truncated ? { truncated: true } : {}),
    ...(options.partial ? { partial: true } : {})
  }
}

function workspaceRoot(cwd: string): string | null {
  try {
    return realpathSync(cwd)
  } catch {
    return null
  }
}

/**
 * 只读工作区内的文本文件。符号链接解析后仍须落在工作区内，
 * 避免审批卡读到 Agent 其实没有权限写的目录。
 */
function readWorkspaceText(cwd: string, path: string): string | null {
  const root = workspaceRoot(cwd)
  if (!root) return null
  const target = isAbsolute(path) ? path : resolve(root, path)
  let real = ''
  try {
    real = realpathSync(target)
  } catch {
    return null
  }
  const rel = relative(root, real)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  try {
    const stat = statSync(real)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null
    const text = readFileSync(real, 'utf8')
    return text.includes('\0') ? null : text
  } catch {
    return null
  }
}

function displayPath(cwd: string, path: string): string {
  const root = workspaceRoot(cwd)
  if (!root) return path
  const abs = isAbsolute(path) ? path : resolve(root, path)
  const rel = relative(root, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return path
  return rel
}

/** 连续替换；replaceAll 对齐 Claude 的 Edit.replace_all。 */
function replaceText(
  source: string,
  oldText: string,
  newText: string,
  replaceAll: boolean
): string {
  return replaceAll ? source.split(oldText).join(newText) : source.replace(oldText, newText)
}

function hunkPair(hunks: { lines: string[] }[]): { oldText: string; newText: string } | null {
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (!line || line.startsWith('\\')) continue
      const marker = line[0]
      const body = line.slice(1)
      if (marker === ' ' || marker === '-') oldLines.push(body)
      if (marker === ' ' || marker === '+') newLines.push(body)
    }
  }
  if (oldLines.length === 0 && newLines.length === 0) return null
  return { oldText: oldLines.join('\n'), newText: newLines.join('\n') }
}

/** 大文件只取改动附近的片段，避免把整份文件塞进审批卡。 */
function focusWindow(source: string, needle: string): string | null {
  const index = source.indexOf(needle)
  if (index < 0) return null
  const lines = source.split('\n')
  const startLine = source.slice(0, index).split('\n').length - 1
  const needleLines = Math.max(1, needle.split('\n').length)
  const start = Math.max(0, startLine - FOCUS_LINES)
  const end = Math.min(lines.length, startLine + needleLines + FOCUS_LINES)
  return lines.slice(start, end).join('\n')
}

function structuredDiff(
  path: string,
  oldText: string,
  newText: string,
  kind: AgentFileDiff['kind']
): AgentFileDiff | undefined {
  try {
    const patch = structuredPatch(path, path, oldText, newText, '', '', { context: 4 })
    const pair = hunkPair(patch.hunks)
    if (!pair) return undefined
    return createDiff(path, pair.oldText, pair.newText, kind, { partial: true })
  } catch {
    return undefined
  }
}

function writeDiff(input: Record<string, unknown>, cwd: string): AgentFileDiff[] | undefined {
  const path = asString(input.file_path)
  const content = asString(input.content)
  if (!path || content === undefined) return undefined
  const current = readWorkspaceText(cwd, path)
  if (current === content) return undefined
  const shownPath = displayPath(cwd, path)
  const kind: AgentFileDiff['kind'] = current === null ? 'add' : 'update'
  if (
    current !== null &&
    (current.length > MAX_SIDE_CHARS * 2 || content.length > MAX_SIDE_CHARS * 2)
  ) {
    const hunked = structuredDiff(shownPath, current, content, kind)
    if (hunked) return [hunked]
  }
  return [createDiff(shownPath, current ?? '', content, kind)]
}

function editDiff(input: Record<string, unknown>, cwd: string): AgentFileDiff[] | undefined {
  const path = asString(input.file_path)
  const oldText = asString(input.old_string)
  const newText = asString(input.new_string)
  if (!path || oldText === undefined || newText === undefined || oldText === newText)
    return undefined
  const replaceAll = input.replace_all === true
  const current = readWorkspaceText(cwd, path)
  const shownPath = displayPath(cwd, path)

  if (current === null || !current.includes(oldText)) {
    return [createDiff(shownPath, oldText, newText, 'update')]
  }
  if (current.length <= MAX_SIDE_CHARS && current.split('\n').length <= MAX_SIDE_LINES) {
    const next = replaceText(current, oldText, newText, replaceAll)
    return next === current ? undefined : [createDiff(shownPath, current, next, 'update')]
  }
  const window = focusWindow(current, oldText)
  if (window) {
    const next = replaceText(window, oldText, newText, replaceAll)
    return [createDiff(shownPath, window, next, 'update', { partial: true })]
  }
  const next = replaceText(current, oldText, newText, replaceAll)
  const hunked = structuredDiff(shownPath, current, next, 'update')
  return hunked ? [hunked] : [createDiff(shownPath, oldText, newText, 'update', { partial: true })]
}

function multiEditDiff(input: Record<string, unknown>, cwd: string): AgentFileDiff[] | undefined {
  const path = asString(input.file_path)
  const edits = Array.isArray(input.edits) ? input.edits : []
  if (!path || edits.length === 0) return undefined
  const current = readWorkspaceText(cwd, path)
  const shownPath = displayPath(cwd, path)

  if (
    current === null ||
    current.length > MAX_SIDE_CHARS ||
    current.split('\n').length > MAX_SIDE_LINES
  ) {
    const first = asRecord(edits[0])
    if (!first) return undefined
    const diff = editDiff(
      {
        file_path: path,
        old_string: first.old_string,
        new_string: first.new_string,
        ...(first.replace_all === true ? { replace_all: true } : {})
      },
      cwd
    )?.[0]
    if (!diff) return undefined
    return [{ ...diff, path: shownPath, partial: true }]
  }

  let next = current
  for (const raw of edits) {
    const edit = asRecord(raw)
    if (!edit) continue
    const oldText = asString(edit.old_string)
    const newText = asString(edit.new_string)
    if (oldText === undefined || newText === undefined) continue
    next = replaceText(next, oldText, newText, edit.replace_all === true)
  }
  return next === current ? undefined : [createDiff(shownPath, current, next, 'update')]
}

/**
 * Claude 的文件写入工具 → 改动预览。只处理 Write / Edit / MultiEdit；
 * 其余工具没有可靠的“改前 / 改后”对照，交回原来的 JSON 摘要。
 */
export function buildClaudeFileDiffs(
  toolName: string,
  input: unknown,
  cwd: string
): AgentFileDiff[] | undefined {
  const record = asRecord(input)
  if (!record) return undefined
  if (toolName === 'Write') return writeDiff(record, cwd)
  if (toolName === 'Edit') return editDiff(record, cwd)
  if (toolName === 'MultiEdit') return multiEditDiff(record, cwd)
  return undefined
}

function parseMarkerPatch(text: string): { oldText: string; newText: string } | null {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length === 0) return null
  if (lines.every((line) => line.startsWith('+'))) {
    return { oldText: '', newText: lines.map((line) => line.slice(1)).join('\n') }
  }
  if (lines.every((line) => line.startsWith('-'))) {
    return { oldText: lines.map((line) => line.slice(1)).join('\n'), newText: '' }
  }
  return null
}

function parseUnifiedPatch(text: string): { oldText: string; newText: string } | null {
  const candidates = [text, `--- a/file\n+++ b/file\n${text}`]
  for (const candidate of candidates) {
    try {
      const parsed = parsePatch(candidate)
      const hunks = parsed.flatMap((patch) => patch.hunks)
      const pair = hunkPair(hunks)
      if (pair) return pair
    } catch {
      // 换一种带文件头的形式再试
    }
  }
  return parseMarkerPatch(text)
}

function changeKind(value: unknown): AgentFileDiff['kind'] {
  const type = asRecord(value)?.type ?? (typeof value === 'string' ? value : undefined)
  return type === 'add' || type === 'delete' || type === 'update' ? type : undefined
}

/**
 * Codex 的 fileChange.changes[] 已经带统一 diff；这里把它还原成
 * 组件需要的两侧文本。只保留 hunk 片段，不会读取或执行任何文件。
 */
export function buildCodexFileDiffs(changes: unknown): AgentFileDiff[] | undefined {
  if (!Array.isArray(changes)) return undefined
  const diffs: AgentFileDiff[] = []
  for (const raw of changes) {
    if (diffs.length >= MAX_FILES) break
    const change = asRecord(raw)
    if (!change) continue
    const path = asString(change.path)
    const patchText = asString(change.diff)
    if (!path || !patchText?.trim()) continue
    const pair = parseUnifiedPatch(patchText)
    if (!pair) continue
    const kind =
      changeKind(change.kind) ?? (pair.oldText ? (pair.newText ? 'update' : 'delete') : 'add')
    diffs.push(createDiff(path, pair.oldText, pair.newText, kind, { partial: true }))
  }
  return diffs.length > 0 ? diffs : undefined
}
