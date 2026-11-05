export const CAPTURE_TITLE_MAX = 80
export const CAPTURE_NOTE_MAX = 4000
export const CAPTURE_TASK_NOTES_MAX = 20_000

function clamp(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = '\n\n…（已截断）'
  return text.slice(0, Math.max(0, limit - marker.length)) + marker
}

/** 回复首行的可读标题：去掉标题井号、列表 / 引用符号与常见 Markdown 标记。 */
export function captureTitle(text: string): string {
  const line = text
    .split('\n')
    .map((row) => row.trim())
    .find(Boolean)
  if (!line) return ''
  const plain = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .trim()
  return plain.slice(0, CAPTURE_TITLE_MAX)
}

/** 笔记正文上限 4000 字，超出时截断并标注。 */
export function messageToNote(text: string): string {
  return clamp(text.trim(), CAPTURE_NOTE_MAX)
}

/** 任务标题取首行，正文进备注；空回复返回 null。 */
export function messageToTask(text: string): { title: string; notes: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const title = captureTitle(trimmed)
  if (!title) return null
  return { title, notes: clamp(trimmed, CAPTURE_TASK_NOTES_MAX) }
}
