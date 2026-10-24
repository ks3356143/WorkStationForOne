import { useEffect, useRef } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { AGENT_META, agentCommandPreview } from '../../lib/agent'
import { selectActiveSession, selectActiveThread, useWorkstation } from '../../store/useWorkstation'
import type { AgentId, Task } from '../../types'
import { Composer } from './Composer'
import { DockHeader } from './DockHeader'
import { MessageRow } from './MessageRow'
import { PermissionCard } from './PermissionCard'

const EMPTY_TASKS: Task[] = []

export function AgentDock() {
  const sessions = useWorkstation((state) => state.sessions)
  const setActiveSession = useWorkstation((state) => state.setActiveSession)
  const activeSession = useWorkstation(selectActiveSession)
  const agent = activeSession.agent
  const thread = useWorkstation(selectActiveThread)
  const typing = useWorkstation((state) => state.typing)
  const pendingReplyTo = useWorkstation((state) => state.pendingReplyTo)
  const permission = useWorkstation((state) => state.permission)
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
  const counts = {
    claude: sessions.filter((session) => session.agent === 'claude').length,
    codex: sessions.filter((session) => session.agent === 'codex').length
  }
  const typingHere = typing && pendingReplyTo === activeSession.id

  useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [thread.length, typingHere, permission, activeSession.id])

  const switchAgent = (next: AgentId) => {
    if (agent === next) return
    const session = sessions.find((item) => item.agent === next)
    if (session) setActiveSession(session.id)
  }

  const command = agentCommandPreview(agent, activeSession.id)
  const meta = AGENT_META[agent]

  return (
    <aside className="w1-dock">
      <DockHeader agent={agent} counts={counts} status={activeSession.status} onSwitch={switchAgent} />

      <div className="w1-term">
        <span className="pr">&gt;</span>
        <b>{command.bin}</b>
        <span className="arg">{command.args}</span>
        <span className="loc">本地</span>
      </div>

      <div className="w1-thread" ref={threadRef}>
        <div className="w1-tdiv">// {activeSession.threadDate} · {activeSession.title}</div>
        <div className="w1-ctx">
          <span>上下文</span>
          <i>任务 {taskCount}</i>
          <i>笔记 {noteCount}</i>
          <i>习惯 {habitCount}</i>
          <b>只读</b>
        </div>

        {thread.map((message) => (
          <MessageRow key={message.id} message={message} agent={agent} />
        ))}

        {typingHere ? (
          <div className="w1-typing" aria-label={`${meta.name} 正在处理`}>
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
          {permission && permission.sessionId === activeSession.id ? (
            <PermissionCard
              key={permission.id}
              permission={permission}
              tasks={permissionTasks}
              onResolve={resolvePermission}
            />
          ) : null}
        </AnimatePresence>

        {agent === 'claude' && resolution ? (
          <m.div
            className={`w1-resolved ${resolution === 'allowed' ? 'ok' : 'deny'}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            // {resolution === 'allowed' ? '已允许 · 3 项任务已顺延' : '已拒绝 · 任务保持原样'}
          </m.div>
        ) : null}
      </div>

      {agent === 'codex' && permission && permission.sessionId !== activeSession.id ? (
        <button className="w1-queue" type="button" onClick={() => setActiveSession(permission.sessionId)}>
          <span className="w1-queue-dot" />
          {permission.source} 有 1 项待审批 · 查看
        </button>
      ) : null}

      <Composer agent={agent} typing={typing} onSend={sendMessage} />
    </aside>
  )
}
