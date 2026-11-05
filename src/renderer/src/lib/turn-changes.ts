import { diffLines } from 'diff'
import type { AgentFileDiff } from '../../../shared/agent-stream'

export type TurnFileKind = 'add' | 'update' | 'delete'

export interface DiffBearingTool {
  diffs?: AgentFileDiff[]
}

export interface TurnFileChange {
  path: string
  kind: TurnFileKind
  additions: number
  deletions: number
  edits: number
  truncated: boolean
  partial: boolean
}

export interface TurnChanges {
  files: TurnFileChange[]
  additions: number
  deletions: number
  truncated: boolean
  partial: boolean
}

export function summarizeTurnChanges(tools: DiffBearingTool[] | undefined): TurnChanges | null {
  const groups = new Map<string, AgentFileDiff[]>()
  for (const tool of tools ?? []) {
    for (const diff of tool.diffs ?? []) {
      if (!diff.path) continue
      const list = groups.get(diff.path)
      if (list) list.push(diff)
      else groups.set(diff.path, [diff])
    }
  }
  if (groups.size === 0) return null

  const files: TurnFileChange[] = []
  let additions = 0
  let deletions = 0
  let truncated = false
  let partial = false

  for (const [path, diffs] of groups) {
    const first = diffs[0]
    const last = diffs[diffs.length - 1]
    if (!first || !last) continue
    const counts = countLines(first.oldText, last.newText)
    const fileTruncated = diffs.some((diff) => diff.truncated === true)
    const filePartial = diffs.some((diff) => diff.partial === true)
    files.push({
      path,
      kind: fileKind(first, last),
      additions: counts.added,
      deletions: counts.removed,
      edits: diffs.length,
      truncated: fileTruncated,
      partial: filePartial
    })
    additions += counts.added
    deletions += counts.removed
    truncated ||= fileTruncated
    partial ||= filePartial
  }

  return { files, additions, deletions, truncated, partial }
}

function fileKind(first: AgentFileDiff, last: AgentFileDiff): TurnFileKind {
  if (first.kind === 'add' || (first.oldText === '' && last.newText !== '')) return 'add'
  if (last.kind === 'delete' || (last.newText === '' && first.oldText !== '')) return 'delete'
  return 'update'
}

function countLines(oldText: string, newText: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const part of diffLines(oldText, newText)) {
    if (part.added) added += part.count ?? 0
    else if (part.removed) removed += part.count ?? 0
  }
  return { added, removed }
}
