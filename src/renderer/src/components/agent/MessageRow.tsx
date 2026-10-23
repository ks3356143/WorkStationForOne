import { memo } from 'react'
import { m } from 'motion/react'
import { AGENT_META } from '../../lib/agent'
import type { AgentId, ChatMessage } from '../../types'
import { ArrowIcon } from '../Glyphs'

interface MessageRowProps {
  message: ChatMessage
  agent: AgentId
}

export const MessageRow = memo(function MessageRow({ message, agent }: MessageRowProps) {
  const meta = AGENT_META[agent]

  if (message.role === 'user') {
    return (
      <m.div
        className="w1-umsg"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="w1-ulabel">我 · {message.time}</span>
        {message.text}
      </m.div>
    )
  }

  return (
    <m.div
      className="w1-amsg"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
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
    </m.div>
  )
})
