export interface SlashMatch {
  /** `/` 在输入文本中的下标 */
  start: number
  query: string
}

export interface PlaceholderRange {
  start: number
  end: number
}

/** 光标前的 `/查询`；`/` 必须在行首或空白之后，避免把路径 / URL 当成指令。 */
export function matchSlash(value: string, caret: number): SlashMatch | null {
  const before = value.slice(0, Math.max(0, caret))
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before)
  if (!match) return null
  return { start: before.length - match[1].length - 1, query: match[1] }
}

/** 按名称 / 正文不区分大小写过滤模板；空查询返回全部（限量）。 */
export function filterTemplates<T extends { name: string; body: string }>(
  templates: T[],
  query: string,
  limit = 30
): T[] {
  const needle = query.toLowerCase()
  if (!needle) return templates.slice(0, limit)
  return templates
    .filter((t) => t.name.toLowerCase().includes(needle) || t.body.toLowerCase().includes(needle))
    .slice(0, limit)
}

/** 首个 `{变量}` 占位区间（不含嵌套花括号）。 */
export function firstPlaceholder(text: string): PlaceholderRange | null {
  const match = /\{[^{}]+\}/.exec(text)
  if (!match) return null
  return { start: match.index, end: match.index + match[0].length }
}

/** 用模板正文替换 `/查询` 片段，返回新文本与首个占位在新文本中的区间。 */
export function applyTemplate(
  value: string,
  start: number,
  query: string,
  body: string
): { value: string; placeholder: PlaceholderRange | null } {
  const next = value.slice(0, start) + body + value.slice(start + 1 + query.length)
  const ph = firstPlaceholder(body)
  return {
    value: next,
    placeholder: ph ? { start: start + ph.start, end: start + ph.end } : null
  }
}
