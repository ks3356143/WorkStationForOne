import { useEffect, useRef } from 'react'
import type { AgentRunEvent } from '../../../shared/agent-stream'
import type { AgentEventEnvelope } from '../../../shared/ipc'
import { useWorkstation } from '../store/useWorkstation'
import { demoReply } from './agent'

/** 把主进程推来的事件写进对应会话的线程 */
function apply(event: AgentRunEvent, sessionId: string): void {
  const store = useWorkstation.getState()
  switch (event.kind) {
    case 'init':
      if (event.sessionId) store.setAgentResume(sessionId, event.sessionId)
      break
    case 'text':
      store.appendAgentText(sessionId, event.text)
      break
    case 'tool':
      store.upsertAgentTool(
        sessionId,
        { id: event.id, name: event.name, meta: event.detail, status: '运行中' },
        '运行中'
      )
      break
    case 'tool-result':
      store.setAgentToolStatus(sessionId, event.id, event.ok ? '完成' : '失败')
      break
    case 'permission':
      store.setToolPermission(sessionId, event.request)
      break
    case 'error':
      store.finishAgentReply(sessionId, event.message)
      break
    case 'result':
      store.finishAgentReply(sessionId)
      break
    default:
      break
  }
}

/**
 * 驱动真实 CLI：待发送提示词按会话出队，事件按 runId 回到发起会话。
 * 同一会话仍串行；不同会话可以同时拥有自己的子进程与流。
 */
export function useAgentRun(): void {
  const bridge = typeof window === 'undefined' ? undefined : window.ws?.agent
  const pendingPrompts = useWorkstation((state) => state.pendingPrompts)
  // 流集合变化时重新挑选可启动的提示词：某会话结束后，它排队的下一条才能出发
  const runningKey = useWorkstation((state) => Object.keys(state.streams).join('|'))
  // runId 回来之前到达的事件先按 run 缓存；bind 后再回放到正确会话
  const runSessions = useRef(new Map<string, string>())
  const finishedRuns = useRef(new Set<string>())
  const buffered = useRef<AgentEventEnvelope[]>([])

  // 订阅主进程事件
  useEffect(() => {
    if (!bridge) return
    return bridge.onEvent((envelope) => {
      // 主进程在 result 之后还会补一条退出事件；流已收尾就不再重复写
      if (finishedRuns.current.has(envelope.runId)) return
      const sessionId = runSessions.current.get(envelope.runId)
      if (!sessionId) {
        buffered.current.push(envelope)
        return
      }
      apply(envelope.event, sessionId)
      if (envelope.event.kind === 'result' || envelope.event.kind === 'error') {
        runSessions.current.delete(envelope.runId)
        finishedRuns.current.add(envelope.runId)
        buffered.current = buffered.current.filter((item) => item.runId !== envelope.runId)
      }
    })
  }, [bridge])

  // MCP 询问模式：主进程串行发来写入请求，按请求自带的会话落卡
  useEffect(() => {
    const mcp = typeof window === 'undefined' ? undefined : window.ws?.mcp
    if (!mcp?.onPermission) return
    return mcp.onPermission((request) => {
      useWorkstation.getState().setMcpPermission(request)
      window.setTimeout(() => {
        const current = useWorkstation.getState().mcpPermissions[request.sessionId]
        if (current?.requestId === request.requestId) {
          useWorkstation.getState().clearMcpPermission(request.sessionId)
        }
      }, 61_000)
    })
  }, [])

  // 发送：一个提示词只启动一个会话；同一会话串行，不同会话互不阻塞
  // biome-ignore lint/correctness/useExhaustiveDependencies: runningKey 不参与函数体，只用于会话结束后复查队列
  useEffect(() => {
    if (!pendingPrompts.length) return
    const store = useWorkstation.getState()
    const next = store.pendingPrompts.find((item) => !store.streams[item.sessionId])
    if (!next) return
    const session = store.sessions.find((item) => item.id === next.sessionId)
    useWorkstation.getState().takePendingPrompt(next.sessionId)
    if (!session) return

    if (!bridge) {
      const reply = demoReply(session.agent)
      store.beginAgentReply(session.id, null)
      apply({ kind: 'text', text: reply.text }, session.id)
      for (const tool of reply.tools ?? []) {
        apply(
          { kind: 'tool', id: tool.id ?? tool.name, name: tool.name, detail: tool.meta },
          session.id
        )
        apply({ kind: 'tool-result', id: tool.id ?? tool.name, ok: true, detail: '' }, session.id)
      }
      store.finishAgentReply(session.id)
      return
    }

    store.beginAgentReply(session.id, null)
    const resumeId = session.resumeId
    void bridge
      .send({
        sessionId: session.id,
        agent: session.agent,
        prompt: next.prompt,
        ...(resumeId ? { resumeId } : {})
      })
      .then(({ runId }) => {
        useWorkstation.getState().bindAgentRun(session.id, runId)
        runSessions.current.set(runId, session.id)
        const queued = buffered.current
        buffered.current = []
        for (const envelope of queued) {
          if (envelope.runId === runId) apply(envelope.event, session.id)
          else buffered.current.push(envelope)
        }
      })
      .catch((error: unknown) => {
        useWorkstation
          .getState()
          .finishAgentReply(session.id, error instanceof Error ? error.message : '启动 Agent 失败')
      })
  }, [bridge, pendingPrompts, runningKey])
}
