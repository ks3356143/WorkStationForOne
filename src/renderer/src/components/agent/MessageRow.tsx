import { memo } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { AGENT_META } from '../../lib/agent'
import type { AgentId, ChatMessage } from '../../types'
import { ArrowIcon } from '../Glyphs'

interface MessageRowProps {
  message: ChatMessage
  agent: AgentId
  animate?: boolean
}

export const MessageRow = memo(function MessageRow({ message, agent, animate = false }: MessageRowProps) {
  const meta = AGENT_META[agent]

  if (message.role === 'user') {
    return (
      <div className="w1-umsg">
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
        </div>
        <div className="w1-atext">{message.text}</div>
        {message.tools?.map((tool) => (
          <div className="w1-tool" key={tool.name}>
            <ArrowIcon width={9} height={9} />
            <b>{tool.name}</b>
            <span>{tool.meta}</span>
            <em>{tool.status}</em>
          </div>
        ))}
      </div>
    </>
  )

  if (!animate) {
    return <div className="w1-amsg">{content}</div>
  }

  return (
    <m.div
      className="w1-amsg"
      initial={{ opacity: 0, transform: 'translateY(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
    >
      {content}
    </m.div>
  )
})
