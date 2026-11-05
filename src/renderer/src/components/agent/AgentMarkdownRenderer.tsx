import { useEffect, useMemo, useRef, useState } from 'react'
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
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fallbackCopy } from '../../lib/clipboard'
import { parseNoteLinkHref, remarkNoteLinks } from '../../lib/note-markdown'
import type { NoteLinkContext } from './AgentMarkdown'

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
  if (node.tagName !== 'code') return
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

function visit(node: Root | Element): void {
  if (node.type === 'element') highlightCode(node)
  for (const child of node.children) {
    if (child.type === 'element') visit(child)
  }
}

function rehypeHighlightLite() {
  return (tree: Root) => visit(tree)
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    []
  )

  const copy = () => {
    const text = preRef.current?.textContent ?? ''
    if (!text) return
    const done = () => {
      setCopied(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done))
      return
    }
    fallbackCopy(text, done)
  }

  return (
    <div className="w1-md-code">
      <button className="w1-md-copy" type="button" aria-label="复制代码" onClick={copy}>
        {copied ? '已复制' : '复制'}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  )
}

function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const external = typeof href === 'string' && /^https?:\/\//i.test(href)
  if (!external) return <span className="w1-md-linkplain">{children}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
      }}
    >
      {children}
    </a>
  )
}

/** Agent 回复不传 noteLinks：渲染结果与原来的纯 Markdown 一致。 */
function markdownComponents(noteLinks?: NoteLinkContext): Components {
  return {
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ href, children }) => {
      const title = typeof href === 'string' ? parseNoteLinkHref(href) : null
      if (title && noteLinks) {
        const state = noteLinks.state(title)
        if (!state.ok) {
          return (
            <span className="w1-nlink missing" title={state.reason}>
              {children}
            </span>
          )
        }
        return (
          <button
            type="button"
            className="w1-nlink"
            title={`打开笔记：${title}`}
            onClick={() => noteLinks.open(title)}
          >
            {children}
          </button>
        )
      }
      return <MarkdownLink href={href}>{children}</MarkdownLink>
    },
    img: ({ alt }) => <span className="w1-md-img">[图片{alt ? `: ${alt}` : ''}]</span>,
    table: ({ children }) => (
      <div className="w1-md-tablewrap">
        <table>{children}</table>
      </div>
    )
  }
}

export default function AgentMarkdownRenderer({
  text,
  noteLinks
}: {
  text: string
  noteLinks?: NoteLinkContext
}) {
  const components = useMemo(() => markdownComponents(noteLinks), [noteLinks])
  const remarkPlugins = useMemo(
    () => (noteLinks ? [remarkGfm, remarkNoteLinks] : [remarkGfm]),
    [noteLinks]
  )
  return (
    <div className="w1-md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeHighlightLite]}
        skipHtml
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
