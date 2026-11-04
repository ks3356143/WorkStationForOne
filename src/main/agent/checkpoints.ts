import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { AgentCheckpointRecord, AgentCheckpointView } from '../../shared/ipc'

export interface FileSnapshot {
  /** 工作区相对路径，统一用 / */
  path: string
  existed: boolean
  /** 原文件内容；不存在、二进制或超大时为 null */
  content: string | null
  truncated?: boolean
}

export interface RestoreResult {
  restored: number
  removed: number
  failed: string[]
}

const MAX_SNAPSHOT_BYTES = 512 * 1024

/** 从 Claude / 桥工具输入里取可能被写入的文件路径；不猜命令参数里的路径。 */
export function filePathsFromInput(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return []
  const record = input as Record<string, unknown>
  const paths: string[] = []
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) paths.push(value.trim())
  }
  if (Array.isArray(record.edits)) {
    for (const edit of record.edits) {
      if (typeof edit !== 'object' || edit === null) continue
      const path = (edit as Record<string, unknown>).file_path
      if (typeof path === 'string' && path.trim()) paths.push(path.trim())
    }
  }
  return [...new Set(paths)]
}

/** 只接受工作区内路径；符号链接解析后仍必须落在工作区。 */
function resolveInside(root: string, path: string): { abs: string; rel: string } | null {
  let realRoot = ''
  try {
    realRoot = realpathSync(root)
  } catch {
    return null
  }
  const target = isAbsolute(path) ? path : resolve(realRoot, path)
  let abs = target
  if (existsSync(target)) {
    try {
      abs = realpathSync(target)
    } catch {
      return null
    }
  }
  const rel = relative(realRoot, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return { abs, rel: rel.replaceAll('\\', '/') }
}

/**
 * 读取写入前的文件内容；写入审批到达时调用。同一路径只保留第一份，
 * 避免一个回合里多次编辑把「回合开始前」的原稿覆盖掉。
 */
export function captureFiles(root: string, paths: string[]): FileSnapshot[] {
  const seen = new Set<string>()
  const snapshots: FileSnapshot[] = []
  for (const path of paths) {
    const inside = resolveInside(root, path)
    if (!inside || seen.has(inside.rel)) continue
    seen.add(inside.rel)
    if (!existsSync(inside.abs)) {
      snapshots.push({ path: inside.rel, existed: false, content: null })
      continue
    }
    try {
      if (!statSync(inside.abs).isFile()) continue
      if (statSync(inside.abs).size > MAX_SNAPSHOT_BYTES) {
        snapshots.push({ path: inside.rel, existed: true, content: null, truncated: true })
        continue
      }
      const content = readFileSync(inside.abs, 'utf8')
      if (content.includes('\u0000')) {
        snapshots.push({ path: inside.rel, existed: true, content: null, truncated: true })
        continue
      }
      snapshots.push({ path: inside.rel, existed: true, content })
    } catch {
      // 读不到就记录为失败；不能静默当作「不存在」，否则回退会误删。
      snapshots.push({ path: inside.rel, existed: true, content: null, truncated: true })
    }
  }
  return snapshots
}

/** 列表视图只给路径与可回退状态；文件原内容留在库里供回退使用。 */
export function toCheckpointView(record: AgentCheckpointRecord): AgentCheckpointView {
  return {
    ...record,
    files: record.files.map((file) => ({
      path: file.path,
      existed: file.existed,
      ...(file.truncated ? { truncated: true } : {})
    }))
  }
}

export function restoreFiles(root: string, snapshots: FileSnapshot[]): RestoreResult {
  const result: RestoreResult = { restored: 0, removed: 0, failed: [] }
  for (const snapshot of snapshots) {
    const inside = resolveInside(root, snapshot.path)
    if (!inside || snapshot.truncated) {
      result.failed.push(snapshot.path)
      continue
    }
    try {
      if (!snapshot.existed) {
        if (existsSync(inside.abs)) rmSync(inside.abs)
        result.removed += 1
        continue
      }
      if (snapshot.content === null) {
        result.failed.push(snapshot.path)
        continue
      }
      mkdirSync(dirname(inside.abs), { recursive: true })
      writeFileSync(inside.abs, snapshot.content, 'utf8')
      result.restored += 1
    } catch {
      result.failed.push(snapshot.path)
    }
  }
  return result
}
