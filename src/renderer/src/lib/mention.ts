import type { WorkspaceEntry } from '../../../shared/ipc'

export interface MentionMatch {
  /** `@` 在输入框文本中的下标 */
  start: number
  query: string
}

/** 光标前的 `@查询`；`@` 必须在行首或空白之后，避免把邮箱当成提及。 */
export function matchMention(value: string, caret: number): MentionMatch | null {
  const before = value.slice(0, Math.max(0, caret))
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (!match) return null
  return { start: before.length - match[1].length - 1, query: match[1] }
}

export function filterWorkspaceFiles(
  entries: WorkspaceEntry[],
  query: string,
  limit = 40
): WorkspaceEntry[] {
  const needle = query.toLowerCase()
  return entries
    .filter((entry) => entry.type === 'file' && entry.path.toLowerCase().includes(needle))
    .slice(0, limit)
}

export function removeMention(value: string, start: number, query: string): string {
  return value.slice(0, start) + value.slice(start + 1 + query.length)
}
