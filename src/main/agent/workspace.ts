import type { Dirent } from 'node:fs'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { WorkspaceEntry, WorkspaceFile } from '../../shared/ipc'

const MAX_ENTRIES = 300
const MAX_DEPTH = 4
const MAX_FILE_BYTES = 128 * 1024
const IGNORED = new Set(['.git', 'node_modules', 'dist', 'out', '.next', '.cache', '.turbo'])

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 只读工作区文件树；跳过依赖/构建目录，限制数量与深度。 */
export function listWorkspaceEntries(root: string): WorkspaceEntry[] {
  const base = resolve(root)
  if (!statSync(base).isDirectory()) throw new Error('工作区不是目录')
  const result: WorkspaceEntry[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || result.length >= MAX_ENTRIES) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const entry of sorted) {
      if (result.length >= MAX_ENTRIES) return
      if (entry.isSymbolicLink() || IGNORED.has(entry.name)) continue
      const full = join(dir, entry.name)
      const path = relative(base, full).split(sep).join('/')
      if (entry.isDirectory()) {
        result.push({ path, type: 'dir', size: 0 })
        walk(full, depth + 1)
      } else if (entry.isFile()) {
        let size = 0
        try {
          size = statSync(full).size
        } catch {
          continue
        }
        result.push({ path, type: 'file', size })
      }
    }
  }
  walk(base, 0)
  return result
}

/** 读取工作区内单个文本文件；拒绝越界、二进制、超大文件。 */
export function readWorkspaceText(root: string, relativePath: string): WorkspaceFile {
  const base = resolve(root)
  const raw = relativePath.trim().replaceAll('\\', '/')
  if (!raw || isAbsolute(raw) || raw.split('/').includes('..')) {
    throw new Error('文件路径无效')
  }
  const target = resolve(join(base, raw))
  if (!isInside(base, target)) throw new Error('文件不在工作区内')
  const stat = statSync(target)
  if (!stat.isFile()) throw new Error('目标不是文件')
  if (stat.size > MAX_FILE_BYTES) throw new Error('文件超过 128 KB，未预览')
  const buffer = readFileSync(target)
  if (buffer.includes(0)) throw new Error('二进制文件不能预览')
  return { path: raw, text: buffer.toString('utf8') }
}
