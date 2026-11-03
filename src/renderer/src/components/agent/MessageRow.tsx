import { memo, useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { AGENT_META } from '../../lib/agent'
import type { AgentId, ChatMessage } from '../../types'
import { ArrowIcon } from '../Glyphs'

interface MessageRowProps {
  message: ChatMessage
  agent: AgentId
  animate?: boolean
  onRetry?: () => void
  onFork?: () => void
  forking?: boolean
}

function fallbackCopy(text: string, done: () => void) {
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    document.execCommand('copy')
  } finally {
    area.remove()
  }
  done()
}

export const MessageRow = memo(function MessageRow({
  message,
  agent,
  animate = false,
  onRetry,
  onFork,
  forking = false
}: MessageRowProps) {
  const meta = AGENT_META[agent]
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    []
  )

  const copy = () => {
    const done = () => {
      setCopied(true)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(message.text).then(done, () => fallbackCopy(message.text, done))
      return
    }
    fallbackCopy(message.text, done)
  }

  if (message.role === 'user') {
    return (
      <div className="w1-umsg" data-message-id={message.id}>
        <span className="w1-ulabel">我 · {message.time}</span>
        {message.text}
      </div>
    )
  }

  const content = (
    <>
      <span className="w1-av">{meta.badge}</span>
      <div className="w1-abody">
        <div className="w1-ameta">
          <b>{meta.name}</b>
          <span>{message.time}</span>
          <span>·</span>
          <span>{meta.model}</span>
          <button type="button" className="w1-copy" aria-label="复制这条回复" onClick={copy}>
            {copied ? '已复制' : '复制'}
          </button>
          {onFork ? (
            <button
              type="button"
              className="w1-copy w1-fork"
              aria-label="从这条回复分叉会话"
              title="复制到此消息为止的对话；模型上下文从新会话开始"
              disabled={forking}
              onClick={onFork}
            >
              {forking ? '分叉中…' : '分叉'}
            </button>
          ) : null}
        </div>
        <div className={`w1-atext${message.error ? ' error' : ''}`}>{message.text}</div>
        {message.error && onRetry ? (
          <button type="button" className="w1-retry" onClick={onRetry}>
            重试
          </button>
        ) : null}
        {message.tools?.map((tool, index) => (
          <m.div
            className="w1-tool"
            key={tool.id ?? tool.name}
            initial={{ opacity: 0, transform: 'translateY(6px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            transition={{
              duration: DURATION.reveal,
              delay: Math.min(index, 6) * 0.04,
              ease: EASE_OUT
            }}
          >
            <ArrowIcon width={9} height={9} />
            <b>{tool.name}</b>
            <span>{tool.meta}</span>
            <m.em
              key={tool.status}
              initial={{ opacity: 0.45, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            >
              {tool.status}
            </m.em>
          </m.div>
        ))}
      </div>
    </>
  )

  if (!animate) {
    return (
      <div className="w1-amsg" data-message-id={message.id}>
        {content}
      </div>
    )
  }

  return (
    <m.div
      className="w1-amsg"
      data-message-id={message.id}
      initial={{ opacity: 0, transform: 'translateY(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
    >
      {content}
    </m.div>
  )
})
