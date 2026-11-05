import type { Element, ElementContent, Root } from 'hast'
import { describe, expect, it } from 'vitest'
import { rehypeHighlightLite } from './markdown-highlight'

function codeRoot(language: string | undefined, inline = false): Root {
  const code: Element = {
    type: 'element',
    tagName: 'code',
    properties: {
      ...(language ? { className: [`language-${language}`] } : {})
    },
    children: [{ type: 'text', value: 'const answer = 42' }]
  }
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: inline ? 'p' : 'pre',
        properties: {},
        children: [code]
      }
    ]
  }
}

function codeNode(tree: Root): Element {
  const block = tree.children[0] as Element
  return block.children[0] as Element
}

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

function hasClass(node: ElementContent, name: string): boolean {
  if (node.type !== 'element') return false
  const classes = Array.isArray(node.properties?.className)
    ? node.properties.className.map(String)
    : []
  return classes.includes(name) || node.children.some((child) => hasClass(child, name))
}

describe('rehypeHighlightLite', () => {
  it('高亮 pre > code 并给根节点加 hljs 类', () => {
    const tree = codeRoot('typescript')
    rehypeHighlightLite()(tree)
    const code = codeNode(tree)

    expect(code.properties?.className).toContain('hljs')
    expect(hasClass(code, 'hljs-keyword')).toBe(true)
    expect(textOf(code)).toBe('const answer = 42')
  })

  it('支持语言别名', () => {
    const tree = codeRoot('ts')
    rehypeHighlightLite()(tree)

    expect(hasClass(codeNode(tree), 'hljs-keyword')).toBe(true)
  })

  it('未注册语言保留纯文本且不抛错', () => {
    const tree = codeRoot('not-a-language')
    expect(() => rehypeHighlightLite()(tree)).not.toThrow()

    const code = codeNode(tree)
    expect(code.properties?.className).toEqual(['language-not-a-language'])
    expect(code.children).toEqual([{ type: 'text', value: 'const answer = 42' }])
  })

  it('不处理没有语言或内联的 code', () => {
    const inline = codeRoot('ts', true)
    rehypeHighlightLite()(inline)
    expect(inline.children[0] as Element).toBeDefined()
    expect(((inline.children[0] as Element).children[0] as Element).properties?.className).toEqual([
      'language-ts'
    ])

    const plain = codeRoot(undefined)
    rehypeHighlightLite()(plain)
    expect(codeNode(plain).properties?.className).toBeUndefined()
  })
})
