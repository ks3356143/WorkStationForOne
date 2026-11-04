import { memo, useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { AGENT_META } from '../../lib/agent'
import { fallbackCopy } from '../../lib/clipboard'
import type { AgentId, ChatMessage } from '../../types'
import { AgentMarkdown } from './AgentMarkdown'
import { AgentImageThumb } from './AgentImageThumb'
import { ToolCardRow } from './ToolCardRow'
import { splitErrorText } from '../../lib/errors'

function ErrorDetail({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false)
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
      navigator.clipboard.writeText(raw).then(done, () => fallbackCopy(raw, done))
      return
    }
    fallbackCopy(raw, done)
  }

  return (
    <div className="w1-errdetail">
      <div className="w1-errdetailactions">
        <button
          type="button"
          className="w1-errdetailbtn"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '收起详情' : '查看详情'}
        </button>
        <button type="button" className="w1-errdetailbtn" onClick={copy}>
          {copied ? '已复制' : '复制详情'}
        </button>
      </div>
      {open ? <pre>{raw}</pre> : null}
    </div>
  )
}

interface MessageRowProps {
  message: ChatMessage
  agent: AgentId
  animate?: boolean
  onRetry?: () => void
  onFork?: () => void
  forkTitle?: string
  forking?: boolean
}

export const MessageRow = memo(function MessageRow({
  message,
  agent,
  animate = false,
  onRetry,
  onFork,
  forkTitle = '复制到此消息为止的对话；模型上下文从新会话开始',
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
        {message.images?.length ? (
          <div className="w1-umsgimages">
            {message.images.map((image) => (
              <AgentImageThumb key={image.id} image={image} className="w1-umsgimage" />
            ))}
          </div>
        ) : null}
        {message.contextFiles?.length ? (
          <div className="w1-uctx">
            {message.contextFiles.map((path) => (
              <span className="w1-uctxchip" key={path}>
                @{path}
              </span>
            ))}
          </div>
        ) : null}
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
              title={forkTitle}
              disabled={forking}
              onClick={onFork}
            >
              {forking ? '分叉中…' : '分叉'}
            </button>
          ) : null}
        </div>
        {message.error ? (
          (() => {
            const errorText = splitErrorText(message.text)
            return (
              <>
                <div className="w1-atext error">{errorText.message}</div>
                {errorText.detail ? <ErrorDetail raw={errorText.detail} /> : null}
              </>
            )
          })()
        ) : (
          <div className="w1-atext">
            <AgentMarkdown text={message.text} />
          </div>
        )}
        {message.error && onRetry ? (
          <button type="button" className="w1-retry" onClick={onRetry}>
            重试
          </button>
        ) : null}
        {message.tools?.map((tool, index) => (
          <ToolCardRow tool={tool} index={index} key={tool.id ?? tool.name} />
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
