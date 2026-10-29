/** 笔记之间的引用标记：`[[笔记首行]]`。 */
export interface NoteLinkToken {
  title: string
  /** 完整标记 `[[…]]` 的起始下标。 */
  start: number
  /** 完整标记结束后的下标。 */
  end: number
}

const MARKER = /\[\[([^\n]*?)\]\]/g
const MAX_LINK_NAME = 40

/**
 * 提取正文里的引用标记。标题去首尾空白，空标题、跨行与嵌套标记都忽略——
 * 宁可少建一条边，也不要把半截文字当成链接名。
 */
export function parseNoteLinks(text: string): NoteLinkToken[] {
  const links: NoteLinkToken[] = []
  for (const match of text.matchAll(MARKER)) {
    const title = match[1].trim()
    if (!title) continue
    if (title.includes('[[') || title.includes(']]')) continue
    const start = match.index ?? 0
    links.push({ title, start, end: start + match[0].length })
  }
  return links
}

/**
 * 笔记没有独立标题字段，用「第一个非空行」当链接名：
 * 比正文前 40 字稳定，也能被用户在编辑时直接命名。方括号会破坏语法，先剥掉。
 */
export function noteLinkName(text: string): string {
  const line = text.split(/\r?\n/).find((part) => part.trim().length > 0)
  if (!line) return ''
  const cleaned = line
    .trim()
    .replace(/\[\[|\]\]/g, '')
    .trim()
  return [...cleaned].slice(0, MAX_LINK_NAME).join('')
}
