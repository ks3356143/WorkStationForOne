import type { AgentSessionRecord, AgentThreadBundle } from '../../../shared/ipc'
import {
  ACTIVE_AGENT_KEY,
  bindAgentPersistence,
  useWorkstation,
  type AgentPersistence
} from '../store/useWorkstation'
import type { ChatMessage, Session } from '../types'
import { agentSessionDate, agentSessionMeta } from './agent'
import { toChatMessage } from './chat-message'
import { browserStorage } from './theme'

export interface AgentHydrateDeps extends AgentPersistence {
  threads: () => Promise<AgentThreadBundle>
}

function toSession(record: AgentSessionRecord, messageCount: number, now: number): Session {
  return {
    id: record.id,
    agent: record.agent,
    title: record.title,
    status: record.status,
    meta: agentSessionMeta(record.updatedAt, messageCount, now),
    threadDate: agentSessionDate(record.updatedAt, now),
    ...(record.workspace ? { workspace: record.workspace } : {}),
    ...(record.resumeId ? { resumeId: record.resumeId } : {})
  }
}

export async function hydrateAgent(deps = bridgeAgent()): Promise<void> {
  if (!deps) return

  bindAgentPersistence({
    createSession: deps.createSession,
    updateSession: deps.updateSession,
    saveMessage: deps.saveMessage
  })

  try {
    const bundle = await deps.threads()
    const now = Date.now()
    const threads: Record<string, ChatMessage[]> = {}
    const counts = new Map<string, number>()
    for (const session of bundle.sessions) {
      threads[session.id] = []
      counts.set(session.id, 0)
    }
    for (const message of bundle.messages) {
      const thread = threads[message.sessionId]
      if (!thread) continue
      thread.push(toChatMessage(message))
      counts.set(message.sessionId, (counts.get(message.sessionId) ?? 0) + 1)
    }

    const sessions = bundle.sessions.map((session) =>
      toSession(session, counts.get(session.id) ?? 0, now)
    )
    const stored = browserStorage()?.getItem(ACTIVE_AGENT_KEY)
    const activeSessionId =
      sessions.find((session) => session.id === stored)?.id ?? sessions[0]?.id ?? ''

    useWorkstation.setState({
      sessions,
      threads,
      activeSessionId,
      permission: null,
      toolPermissions: {},
      mcpPermissions: {},
      resolution: null,
      typing: false,
      pendingPrompts: [],
      streams: {},
      pendingReplyTo: null
    })
  } catch (error) {
    console.error('[agent] 会话读取失败', error)
    useWorkstation.setState({
      sessions: [],
      threads: {},
      activeSessionId: '',
      permission: null,
      toolPermissions: {},
      mcpPermissions: {},
      resolution: null,
      typing: false,
      pendingPrompts: [],
      streams: {},
      pendingReplyTo: null
    })
  }
}

function bridgeAgent(): AgentHydrateDeps | undefined {
  return typeof window === 'undefined' ? undefined : window.ws?.agent
}
