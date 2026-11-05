/**
 * 笔记预览里的 [[双链]]：只改 mdast 的 text 节点，代码块、行内代码与已有链接不受影响。
 * 目标解析在渲染层完成；这里只负责把双链变成带内部协议的链接节点。
 */
interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
}

const NOTE_LINK = /\[\[([^[\]\n]{1,80})\]\]/g
export const NOTE_LINK_PREFIX = '#wsfo-note='

export function noteLinkHref(title: string): string {
  return NOTE_LINK_PREFIX + encodeURIComponent(title.trim())
}

export function parseNoteLinkHref(href: string): string | null {
  if (!href.startsWith(NOTE_LINK_PREFIX)) return null
  try {
    const title = decodeURIComponent(href.slice(NOTE_LINK_PREFIX.length)).trim()
    return title || null
  } catch {
    return null
  }
}

function splitNoteLinks(node: MdNode): MdNode[] | null {
  const value = node.value ?? ''
  const parts: MdNode[] = []
  let last = 0
  for (const match of value.matchAll(NOTE_LINK)) {
    const title = (match[1] ?? '').trim()
    if (!title) continue
    const index = match.index ?? 0
    if (index > last) parts.push({ type: 'text', value: value.slice(last, index) })
    parts.push({
      type: 'link',
      url: noteLinkHref(title),
      children: [{ type: 'text', value: title }]
    })
    last = index + match[0].length
  }
  if (parts.length === 0) return null
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) })
  return parts
}

function walk(parent: MdNode): void {
  const next: MdNode[] = []
  for (const child of parent.children ?? []) {
    if (child.type === 'text') {
      const parts = splitNoteLinks(child)
      if (parts) {
        next.push(...parts)
        continue
      }
    }
    // 链接内部不再生成链接，避免嵌套锚点
    if (child.type !== 'link' && child.type !== 'linkReference') walk(child)
    next.push(child)
  }
  parent.children = next
}

export function transformNoteLinks(tree: unknown): void {
  if (!tree || typeof tree !== 'object') return
  walk(tree as MdNode)
}

export function remarkNoteLinks() {
  return (tree: unknown) => transformNoteLinks(tree)
}
