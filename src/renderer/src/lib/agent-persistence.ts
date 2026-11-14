import type { AgentSessionRecord, AgentSessionSummary } from '../../../shared/ipc'
import {
  ACTIVE_AGENT_KEY,
  bindAgentPersistence,
  useWorkstation,
  type AgentPersistence
} from '../store/useWorkstation'
import type { Session } from '../types'
import { sessionFromRecord } from './agent'
import { browserStorage } from './theme'

export interface AgentHydrateDeps extends AgentPersistence {
  sessions: () => Promise<AgentSessionSummary>
}

function toSession(record: AgentSessionRecord, messageCount: number, now: number): Session {
  return sessionFromRecord(record, messageCount, now)
}

export async function hydrateAgent(deps = bridgeAgent()): Promise<void> {
  if (!deps) {
    useWorkstation.setState({ sessionsReady: true })
    return
  }

  bindAgentPersistence({
    createSession: deps.createSession,
    updateSession: deps.updateSession,
    saveMessage: deps.saveMessage
  })

  try {
    // 启动只读会话摘要与消息数量；正文在打开会话时按需读取，避免把所有历史一次性装进内存。
    const summary = await deps.sessions()
    const now = Date.now()
    const sessions = summary.sessions.map((session) =>
      toSession(session, summary.counts[session.id] ?? 0, now)
    )
    const stored = browserStorage()?.getItem(ACTIVE_AGENT_KEY)
    const activeSessionId =
      sessions.find((session) => session.id === stored && !session.archived)?.id ??
      sessions.find((session) => !session.archived)?.id ??
      ''

    useWorkstation.setState({
      sessions,
      threads: {},
      threadsLoaded: {},
      activeSessionId,
      permission: null,
      toolPermissions: {},
      toolPermissionQueues: {},
      mcpPermissions: {},
      agentQuestions: {},
      resolution: null,
      typing: false,
      pendingPrompts: [],
      streams: {},
      pendingReplyTo: null,
      sessionsReady: true
    })
  } catch (error) {
    console.error('[agent] 会话读取失败', error)
    useWorkstation.setState({
      sessions: [],
      threads: {},
      threadsLoaded: {},
      activeSessionId: '',
      permission: null,
      toolPermissions: {},
      toolPermissionQueues: {},
      mcpPermissions: {},
      agentQuestions: {},
      resolution: null,
      typing: false,
      pendingPrompts: [],
      streams: {},
      pendingReplyTo: null,
      sessionsReady: true
    })
  }
}

function bridgeAgent(): AgentHydrateDeps | undefined {
  const api = typeof window === 'undefined' ? undefined : window.ws?.agent
  if (!api) return undefined
  return {
    sessions: api.sessions,
    createSession: api.createSession,
    updateSession: api.updateSession,
    saveMessage: api.saveMessage
  }
}
