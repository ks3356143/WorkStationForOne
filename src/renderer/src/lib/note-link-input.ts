export interface LinkTrigger {
  /** `[[` 中第一个方括号的下标。 */
  start: number
  /** 光标与 `[[` 之间的查询词。 */
  query: string
}

/** 光标前是否有未闭合的 `[[`。换行或已闭合的标记都不算。 */
export function linkTrigger(text: string, caret: number): LinkTrigger | null {
  const start = text.lastIndexOf('[[', Math.max(0, caret - 1))
  if (start < 0 || start + 2 > caret) return null
  const query = text.slice(start + 2, caret)
  if (query.includes('\n') || query.includes(']]') || query.includes('[[')) return null
  return { start, query }
}

/** 把光标前的半截标记替换成完整链接；紧跟的 `]]` 一并吞掉，避免重复闭合。 */
export function applyLink(
  text: string,
  trigger: LinkTrigger,
  caret: number,
  title: string
): { text: string; caret: number } {
  const consumeClose = text.startsWith(']]', caret) ? 2 : 0
  const marker = `[[${title}]]`
  return {
    text: text.slice(0, trigger.start) + marker + text.slice(caret + consumeClose),
    caret: trigger.start + marker.length
  }
}
