import { useEffect } from 'react'
import { useWorkstation } from '../store/useWorkstation'
import { demoReply } from './agent'

export function useDemoReply(): void {
  const pendingAgent = useWorkstation(
    (state) => state.sessions.find((session) => session.id === state.pendingReplyTo)?.agent
  )
  const receiveReply = useWorkstation((state) => state.receiveReply)

  useEffect(() => {
    if (!pendingAgent) return
    const reply = demoReply(pendingAgent)
    const timer = window.setTimeout(() => receiveReply(reply.text, reply.tools), 1100)
    return () => window.clearTimeout(timer)
  }, [pendingAgent, receiveReply])
}
