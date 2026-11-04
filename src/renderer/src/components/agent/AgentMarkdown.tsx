import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { fallbackCopy } from '../../lib/clipboard'

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

const MarkdownLink: Components['a'] = ({ href, children }) => {
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

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: MarkdownLink,
  img: ({ alt }) => <span className="w1-md-img">[图片{alt ? `: ${alt}` : ''}]</span>,
  table: ({ children }) => (
    <div className="w1-md-tablewrap">
      <table>{children}</table>
    </div>
  )
}

export function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className="w1-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
