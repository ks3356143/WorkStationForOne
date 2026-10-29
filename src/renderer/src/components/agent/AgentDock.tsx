import { useEffect, useLayoutEffect, useRef } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { AGENT_META, agentCommandPreview } from '../../lib/agent'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { selectActiveSession, selectActiveThread, useWorkstation } from '../../store/useWorkstation'
import type { AgentId, Task } from '../../types'
import { Composer } from './Composer'
import { DockHeader } from './DockHeader'
import { MessageRow } from './MessageRow'
import { PermissionCard } from './PermissionCard'
import { ToolApprovalCard } from './ToolApprovalCard'

const EMPTY_TASKS: Task[] = []

export function AgentDock() {
  const sessions = useWorkstation((state) => state.sessions)
  const setActiveSession = useWorkstation((state) => state.setActiveSession)
  const createAgentSession = useWorkstation((state) => state.createAgentSession)
  const activeSession = useWorkstation(selectActiveSession)
  const activeId = activeSession?.id ?? ''
  const agent = activeSession?.agent ?? 'claude'
  const thread = useWorkstation(selectActiveThread)
  const typing = useWorkstation((state) => state.typing)
  const pendingReplyTo = useWorkstation((state) => state.pendingReplyTo)
  const permission = useWorkstation((state) => state.permission)
  const toolPermission = useWorkstation((state) => state.toolPermission)
  const clearToolPermission = useWorkstation((state) => state.clearToolPermission)
  const resolution = useWorkstation((state) => state.resolution)
  const taskCount = useWorkstation((state) => state.tasks.length)
  const noteCount = useWorkstation((state) => state.noteTotal)
  const habitCount = useWorkstation((state) => state.habits.length)
  const permissionTasks = useWorkstation((state) =>
    state.permission?.sessionId === state.activeSessionId ? state.tasks : EMPTY_TASKS
  )
  const sendMessage = useWorkstation((state) => state.sendMessage)
  const resolvePermission = useWorkstation((state) => state.resolvePermission)

  const threadRef = useRef<HTMLDivElement>(null)
  const threadMeta = useRef({
    sessionId: activeId,
    length: thread.length,
    initialized: false
  })
  const counts = {
    claude: sessions.filter((session) => session.agent === 'claude').length,
    codex: sessions.filter((session) => session.agent === 'codex').length
  }
  const typingHere = typing && pendingReplyTo === activeId && Boolean(activeId)
  const animateId =
    threadMeta.current.initialized &&
    threadMeta.current.sessionId === activeId &&
    thread.length > threadMeta.current.length
      ? thread[thread.length - 1]?.id
      : undefined

  useEffect(() => {
    threadMeta.current = { sessionId: activeId, length: thread.length, initialized: true }
  }, [activeId, thread.length])

  // biome-ignore lint/correctness/useExhaustiveDependencies: thread.length / typingHere / permission 是滚动触发条件，用于在有新内容时贴底
  useLayoutEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [thread.length, typingHere, permission, activeId])

  const switchAgent = (next: AgentId) => {
    if (agent === next) return
    const session = sessions.find((item) => item.agent === next)
    if (session) setActiveSession(session.id)
  }

  if (!activeSession) {
    return (
      <aside className="w1-dock">
        <DockHeader agent="claude" counts={counts} status="idle" onSwitch={switchAgent} />
        <div className="w1-agentempty">
          <span className="w1-eyebrow">// Agent</span>
          <h2>还没有会话。</h2>
          <p>新建一个 Claude 会话。对话会存在本机，重启后还能继续。</p>
          <button className="w1-pb pri" type="button" onClick={createAgentSession}>
            新建 Claude 会话
          </button>
        </div>
      </aside>
    )
  }

  const command = agentCommandPreview(agent, activeSession.resumeId)
  const meta = AGENT_META[agent]
  const respondPermission =
    typeof window === 'undefined' ? undefined : window.ws?.agent?.respondPermission

  const resolveToolPermission = (allow: boolean) => {
    if (!toolPermission) return
    const requestId = toolPermission.requestId
    clearToolPermission()
    void respondPermission?.({
      requestId,
      allow,
      ...(allow ? {} : { message: '用户拒绝' })
    }).catch((error) => console.error('[agent] 回写审批失败', error))
  }

  return (
    <aside className="w1-dock">
      <DockHeader
        agent={agent}
        counts={counts}
        status={activeSession.status}
        onSwitch={switchAgent}
      />

      <div className="w1-term">
        <span className="pr">&gt;</span>
        <b>{command.bin}</b>
        <span className="arg">{command.args}</span>
        <span className="loc">本地</span>
      </div>

      <div className="w1-thread" ref={threadRef}>
        <m.div
          key={activeSession.id}
          className="w1-threadpad"
          initial={{ opacity: 0, transform: 'translateY(6px)' }}
          animate={{ opacity: 1, transform: 'translateY(0px)' }}
          transition={{ duration: DURATION.view, ease: EASE_OUT }}
        >
          <div className="w1-tdiv">
            // {activeSession.threadDate} · {activeSession.title}
          </div>
          <div className="w1-ctx">
            <span>上下文</span>
            <i>任务 {taskCount}</i>
            <i>笔记 {noteCount}</i>
            <i>习惯 {habitCount}</i>
            <b>只读</b>
          </div>

          {thread.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              agent={agent}
              animate={message.id === animateId}
            />
          ))}

          {typingHere ? (
            <div className="w1-typing" role="status" aria-label={`${meta.name} 正在处理`}>
              <span className="w1-av">{meta.badge}</span>
              <span className="w1-typing-dots">
                <i />
                <i />
                <i />
              </span>
              <span>正在读取上下文</span>
            </div>
          ) : null}

          <AnimatePresence initial={false}>
            {toolPermission && toolPermission.sessionId === activeSession.id ? (
              <ToolApprovalCard
                key={toolPermission.requestId}
                request={toolPermission}
                onResolve={resolveToolPermission}
              />
            ) : null}
            {permission && permission.sessionId === activeSession.id ? (
              <PermissionCard
                key={permission.id}
                permission={permission}
                tasks={permissionTasks}
                onResolve={resolvePermission}
              />
            ) : null}
          </AnimatePresence>

          {agent === 'claude' && resolution?.sessionId === activeSession.id ? (
            <m.div
              className={`w1-resolved ${resolution.decision === 'allowed' ? 'ok' : 'deny'}`}
              initial={{ opacity: 0, transform: 'translateY(6px)' }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }}
            >
              //{' '}
              {resolution.decision === 'allowed'
                ? '已允许 · 3 项任务已顺延'
                : '已拒绝 · 任务保持原样'}
            </m.div>
          ) : null}
        </m.div>
      </div>

      {agent === 'codex' && permission && permission.sessionId !== activeSession.id ? (
        <button
          className="w1-queue"
          type="button"
          onClick={() => setActiveSession(permission.sessionId)}
        >
          <span className="w1-queue-dot" />
          {permission.source} 有 1 项待审批 · 查看
        </button>
      ) : null}

      <Composer key={activeSession.id} agent={agent} typing={typing} onSend={sendMessage} />
    </aside>
  )
}
