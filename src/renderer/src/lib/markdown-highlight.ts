import type { Element, ElementContent, Root } from 'hast'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { createLowlight } from 'lowlight'

const HIGHLIGHT_LANGUAGES = {
  bash,
  css,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml
}

const lowlight = createLowlight(HIGHLIGHT_LANGUAGES)
lowlight.registerAlias({
  javascript: ['js', 'jsx'],
  typescript: ['ts', 'tsx'],
  markdown: ['md'],
  bash: ['sh', 'shell'],
  xml: ['html'],
  yaml: ['yml'],
  python: ['py'],
  rust: ['rs']
})

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

function highlightCode(node: Element): void {
  const classes = Array.isArray(node.properties?.className)
    ? node.properties.className.filter((value): value is string => typeof value === 'string')
    : []
  const languageClass = classes.find((value) => value.startsWith('language-'))
  if (!languageClass) return
  const value = textOf(node)
  if (!value) return
  try {
    const highlighted = lowlight.highlight(languageClass.slice('language-'.length), value)
    node.children = highlighted.children as ElementContent[]
    node.properties = { ...node.properties, className: [...classes, 'hljs'] }
  } catch {
    // 未注册的语言保留原文
  }
}

function visit(node: Root | Element, parentTag?: string): void {
  if (node.type === 'element' && node.tagName === 'code' && parentTag === 'pre') {
    highlightCode(node)
  }
  for (const child of node.children) {
    if (child.type === 'element') {
      visit(child, node.type === 'element' ? node.tagName : parentTag)
    }
  }
}

/** 只高亮 pre > code，语言表按需收窄，避免把 highlight.js 全量语言带进首包。 */
export function rehypeHighlightLite() {
  return (tree: Root) => visit(tree)
}
