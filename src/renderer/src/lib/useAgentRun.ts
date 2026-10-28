import { useEffect, useRef } from 'react'
import type { AgentRunEvent } from '../../../shared/agent-stream'
import type { AgentEventEnvelope } from '../../../shared/ipc'
import { useWorkstation } from '../store/useWorkstation'
import { demoReply } from './agent'

/** 把主进程推来的单个事件写进当前线程 */
function apply(event: AgentRunEvent): void {
  const store = useWorkstation.getState()
  switch (event.kind) {
    case 'text':
      store.appendAgentText(event.text)
      break
    case 'tool':
      store.upsertAgentTool(
        { id: event.id, name: event.name, meta: event.detail, status: '运行中' },
        '运行中'
      )
      break
    case 'tool-result':
      store.setAgentToolStatus(event.id, event.ok ? '完成' : '失败')
      break
    case 'error':
      store.finishAgentReply(event.message)
      break
    case 'result':
      store.finishAgentReply()
      break
    default:
      break
  }
}

/**
 * 驱动真实 CLI：发送 pendingPrompt、转发事件、维护 --resume 的会话 id。
 * 没有 preload 桥（纯浏览器调试）时退回演示回复。
 */
export function useAgentRun(): void {
  const bridge = typeof window === 'undefined' ? undefined : window.ws?.agent
  const pendingPrompt = useWorkstation((state) => state.pendingPrompt)
  const streaming = useWorkstation((state) => state.streaming)
  const activeSessionId = useWorkstation((state) => state.activeSessionId)
  // CLI 自己的 session id，按应用会话归档，用于下一轮 --resume
  const resumeIds = useRef(new Map<string, string>())
  // runId 回来之前到达的事件先存着，避免丢首帧文本
  const buffered = useRef<AgentEventEnvelope[]>([])

  // 订阅主进程事件
  useEffect(() => {
    if (!bridge) return
    return bridge.onEvent((envelope) => {
      const store = useWorkstation.getState()
      if (envelope.event.kind === 'init' && envelope.event.sessionId && store.streaming) {
        resumeIds.current.set(store.streaming.sessionId, envelope.event.sessionId)
      }
      if (!store.streaming) {
        buffered.current.push(envelope)
        return
      }
      apply(envelope.event)
    })
  }, [bridge])

  // 发送：Composer 写好 pendingPrompt，这里取走并启动
  useEffect(() => {
    if (!pendingPrompt || streaming) return
    const store = useWorkstation.getState()
    const sessionId = activeSessionId

    if (!bridge) {
      const session = store.sessions.find((item) => item.id === sessionId)
      if (!session) return
      store.takePendingPrompt()
      const reply = demoReply(session.agent)
      store.beginAgentReply(sessionId, null)
      store.appendAgentText(reply.text)
      for (const tool of reply.tools ?? []) store.upsertAgentTool(tool, tool.status)
      store.finishAgentReply()
      return
    }

    store.takePendingPrompt()
    store.beginAgentReply(sessionId, null)
    const resumeId = resumeIds.current.get(sessionId)
    void bridge
      .send({ sessionId, prompt: pendingPrompt, ...(resumeId ? { resumeId } : {}) })
      .then(({ runId }) => {
        useWorkstation.getState().bindAgentRun(runId)
        const queued = buffered.current
        buffered.current = []
        for (const envelope of queued) apply(envelope.event)
      })
      .catch((error: unknown) => {
        store.finishAgentReply(error instanceof Error ? error.message : '启动 Agent 失败')
      })
  }, [activeSessionId, bridge, pendingPrompt, streaming])
}
