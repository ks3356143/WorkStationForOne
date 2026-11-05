import { describe, expect, it } from 'vitest'
import {
  NOTE_LINK_PREFIX,
  noteLinkHref,
  parseNoteLinkHref,
  transformNoteLinks
} from './note-markdown'

interface Node {
  type: string
  value?: string
  url?: string
  children?: Node[]
}

const text = (value: string): Node => ({ type: 'text', value })

function treeWith(...children: Node[]): Node {
  return { type: 'root', children }
}

describe('note markdown · 双链节点', () => {
  it('把文本里的双链拆成 text + link，保留前后文字', () => {
    const tree = treeWith({
      type: 'paragraph',
      children: [text('先看 [[目标 笔记]]，再看 [[第二篇]]')]
    })
    transformNoteLinks(tree)
    const children = tree.children?.[0]?.children ?? []
    expect(children.map((node) => node.type)).toEqual(['text', 'link', 'text', 'link'])
    expect(children[1]?.url).toBe(noteLinkHref('目标 笔记'))
    expect(children[1]?.children?.[0]?.value).toBe('目标 笔记')
    expect(children[3]?.url).toBe(noteLinkHref('第二篇'))
  })

  it('忽略空标题，不产生空链接', () => {
    const tree = treeWith({ type: 'paragraph', children: [text('空 [[   ]] 链接')] })
    transformNoteLinks(tree)
    expect(tree.children?.[0]?.children?.every((node) => node.type === 'text')).toBe(true)
  })

  it('代码块、行内代码与已有链接不受影响', () => {
    const tree = treeWith(
      { type: 'code', value: '[[代码里的不算]]' },
      {
        type: 'paragraph',
        children: [
          { type: 'inlineCode', value: '[[行内代码]]' },
          text(' 正文 [[目标]]'),
          { type: 'link', url: 'https://example.com', children: [text('[[外链文本]]')] }
        ]
      }
    )
    transformNoteLinks(tree)
    expect(tree.children?.[0]?.value).toBe('[[代码里的不算]]')
    const paragraph = tree.children?.[1]?.children ?? []
    const inline = paragraph.find((node) => node.type === 'inlineCode')
    const external = paragraph.find((node) => node.url === 'https://example.com')
    const internal = paragraph.filter((node) => node.url?.startsWith(NOTE_LINK_PREFIX))
    expect(inline?.value).toBe('[[行内代码]]')
    expect(external?.children?.[0]?.value).toBe('[[外链文本]]')
    expect(internal).toHaveLength(1)
  })

  it('href 编解码可往返中文与特殊字符', () => {
    for (const title of ['目标笔记', '带 空格', 'a/b#c%20d']) {
      const href = noteLinkHref(title)
      expect(href.startsWith(NOTE_LINK_PREFIX)).toBe(true)
      expect(parseNoteLinkHref(href)).toBe(title)
    }
    expect(parseNoteLinkHref('#other')).toBeNull()
    expect(parseNoteLinkHref(`${NOTE_LINK_PREFIX}%E0%A4%A`)).toBeNull()
  })
})
