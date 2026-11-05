import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { fallbackCopy } from '../../lib/clipboard'
import { parseNoteLinkHref, remarkNoteLinks } from '../../lib/note-markdown'

/** 笔记预览用：把 [[双链]] 解析到真实笔记并支持点击打开。 */
export interface NoteLinkContext {
  open: (title: string) => void
  state: (title: string) => { ok: boolean; reason?: string }
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

export function AgentMarkdown({ text, noteLinks }: { text: string; noteLinks?: NoteLinkContext }) {
  const components = useMemo(() => markdownComponents(noteLinks), [noteLinks])
  const remarkPlugins = useMemo(
    () => (noteLinks ? [remarkGfm, remarkNoteLinks] : [remarkGfm]),
    [noteLinks]
  )
  return (
    <div className="w1-md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
