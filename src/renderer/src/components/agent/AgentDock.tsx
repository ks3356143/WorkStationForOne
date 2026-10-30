import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { AGENT_META, agentCommandPreview, workspaceName } from '../../lib/agent'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { selectActiveSession, selectActiveThread, useWorkstation } from '../../store/useWorkstation'
import type { AgentId, Task } from '../../types'
import type { McpPermissionDecision } from '../../../../shared/ipc'
import { FolderIcon } from '../Glyphs'
import { Composer } from './Composer'
import { DockHeader } from './DockHeader'
import { McpApprovalCard } from './McpApprovalCard'
import { MessageRow } from './MessageRow'
import { PermissionCard } from './PermissionCard'
import { ToolApprovalCard } from './ToolApprovalCard'
import { WorkspaceSheet } from './WorkspaceSheet'

const EMPTY_TASKS: Task[] = []

export function AgentDock() {
  const sessions = useWorkstation((state) => state.sessions)
  const setActiveSession = useWorkstation((state) => state.setActiveSession)
  const createAgentSession = useWorkstation((state) => state.createAgentSession)
  const activeSession = useWorkstation(selectActiveSession)
  const activeId = activeSession?.id ?? ''
  const agent = activeSession?.agent ?? 'claude'
  const thread = useWorkstation(selectActiveThread)
  const streamHere = useWorkstation((state) => state.streams[state.activeSessionId])
  const queuedHere = useWorkstation((state) =>
    state.pendingPrompts.some((prompt) => prompt.sessionId === state.activeSessionId)
  )
  const permission = useWorkstation((state) => state.permission)
  const toolPermission = useWorkstation((state) => state.toolPermissions[state.activeSessionId])
  const clearToolPermission = useWorkstation((state) => state.clearToolPermission)
  const mcpPermission = useWorkstation((state) => state.mcpPermissions[state.activeSessionId])
  const clearMcpPermission = useWorkstation((state) => state.clearMcpPermission)
  // 后台会话的审批不抢占当前聊天，但要在输入栏上方留一个入口
  const pendingElsewhereId = useWorkstation((state) => {
    const pending = state.sessions.find(
      (session) =>
        session.id !== state.activeSessionId &&
        Boolean(
          state.toolPermissions[session.id] ||
            state.mcpPermissions[session.id] ||
            state.permission?.sessionId === session.id
        )
    )
    return pending?.id ?? ''
  })
  const pendingElsewhereCount = useWorkstation(
    (state) =>
      state.sessions.filter(
        (session) =>
          session.id !== state.activeSessionId &&
          Boolean(
            state.toolPermissions[session.id] ||
              state.mcpPermissions[session.id] ||
              state.permission?.sessionId === session.id
          )
      ).length
  )
  const resolution = useWorkstation((state) => state.resolution)
  const taskCount = useWorkstation((state) => state.tasks.length)
  const noteCount = useWorkstation((state) => state.noteTotal)
  const habitCount = useWorkstation((state) => state.habits.length)
  const permissionTasks = useWorkstation((state) =>
    state.permission?.sessionId === state.activeSessionId ? state.tasks : EMPTY_TASKS
  )
  const sendMessage = useWorkstation((state) => state.sendMessage)
  const resolvePermission = useWorkstation((state) => state.resolvePermission)
  const setAgentWorkspace = useWorkstation((state) => state.setAgentWorkspace)
  const [codexApproval, setCodexApproval] = useState(false)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => {
      void window.ws?.provider
        .list()
        .then((list) => {
          if (alive)
            setCodexApproval(list.some((profile) => profile.target === 'codex' && profile.active))
        })
        .catch(() => {
          if (alive) setCodexApproval(false)
        })
    }
    load()
    window.addEventListener('ws:provider-changed', load)
    return () => {
      alive = false
      window.removeEventListener('ws:provider-changed', load)
    }
  }, [])

  const threadRef = useRef<HTMLDivElement>(null)
  const threadMeta = useRef({
    sessionId: activeId,
    length: thread.length,
    initialized: false
  })
  const artifacts = useMemo(() => {
    const root = activeSession?.workspace?.replaceAll('\\', '/').replace(/\/+$/, '')
    const seen = new Set<string>()
    const result: { path: string; name: string }[] = []
    for (const message of thread) {
      for (const tool of message.tools ?? []) {
        if (!/write|edit|patch/i.test(tool.name)) continue
        const raw = tool.meta.split(/\r?\n/)[0]?.trim() ?? ''
        const pathLike = raw.includes('/') || raw.includes('\\') || /\.[A-Za-z0-9]{1,8}$/.test(raw)
        if (!raw || !pathLike) continue
        const normalized = raw.replaceAll('\\', '/')
        let path = normalized
        if (root && normalized.startsWith(`${root}/`)) path = normalized.slice(root.length + 1)
        else if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) continue
        if (path.includes('..') || seen.has(path)) continue
        seen.add(path)
        result.push({ path, name: path.split('/').at(-1) ?? path })
      }
    }
    return result
  }, [activeSession?.workspace, thread])
  const counts = {
    claude: sessions.filter((session) => session.agent === 'claude').length,
    codex: sessions.filter((session) => session.agent === 'codex').length
  }
  // 只看当前会话：别的会话在跑不该锁住这里的输入
  const typingHere = Boolean(activeId) && (Boolean(streamHere) || queuedHere)
  const animateId =
    threadMeta.current.initialized &&
    threadMeta.current.sessionId === activeId &&
    thread.length > threadMeta.current.length
      ? thread[thread.length - 1]?.id
      : undefined

  useEffect(() => {
    threadMeta.current = { sessionId: activeId, length: thread.length, initialized: true }
  }, [activeId, thread.length])

  // 主进程 60 秒超时后不会再发事件；卡片最多多留 1 秒再自行收起。
  useEffect(() => {
    if (!mcpPermission) return
    const { sessionId, requestId } = mcpPermission
    const timer = window.setTimeout(() => {
      const current = useWorkstation.getState().mcpPermissions[sessionId]
      if (current?.requestId === requestId) clearMcpPermission(sessionId)
    }, 61_000)
    return () => window.clearTimeout(timer)
  }, [mcpPermission, clearMcpPermission])

  // 有审批卡时窗口变窄也要把卡贴到可见区域，避免被输入栏盖住。
  useEffect(() => {
    if (!mcpPermission) return
    const onResize = () => {
      const node = threadRef.current
      if (node) node.scrollTop = node.scrollHeight
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mcpPermission])

  // biome-ignore lint/correctness/useExhaustiveDependencies: thread.length / typingHere / permission / mcpPermission 是滚动触发条件，用于在有新内容时贴底
  useLayoutEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [thread.length, typingHere, permission, mcpPermission, activeId])

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
          <p>新建一个 Claude 或 Codex 会话。对话会存在本机，重启后还能继续。</p>
          <div className="w1-agentempty-actions">
            <button className="w1-pb pri" type="button" onClick={() => createAgentSession()}>
              新建 Claude 会话
            </button>
            <button className="w1-pb" type="button" onClick={() => createAgentSession('codex')}>
              新建 Codex 会话
            </button>
          </div>
        </div>
      </aside>
    )
  }

  const command = agentCommandPreview(agent, activeSession.resumeId, codexApproval)
  const meta = AGENT_META[agent]
  const writeApproval = agent === 'claude' || codexApproval
  const respondPermission =
    typeof window === 'undefined' ? undefined : window.ws?.agent?.respondPermission

  const pickWorkspace = () => {
    const bridge = typeof window === 'undefined' ? undefined : window.ws?.agent
    if (!bridge?.pickWorkspace || workspaceBusy || typingHere) return
    setWorkspaceBusy(true)
    setWorkspaceError(null)
    void bridge
      .pickWorkspace(activeSession.workspace)
      .then((path) => {
        if (path) setAgentWorkspace(activeSession.id, path)
      })
      .catch((error: unknown) => {
        setWorkspaceError(error instanceof Error ? error.message : '选择工作区失败')
      })
      .finally(() => setWorkspaceBusy(false))
  }

  const resolveMcpPermission = (decision: McpPermissionDecision) => {
    if (!mcpPermission) return
    const { requestId, sessionId } = mcpPermission
    clearMcpPermission(sessionId)
    void window.ws?.mcp
      ?.respondPermission({ requestId, decision })
      .catch((error) => console.error('[agent] MCP 审批回写失败', error))
  }

  const resolveToolPermission = (decision: 'once' | 'session' | 'workspace' | 'deny') => {
    if (!toolPermission) return
    const { requestId, sessionId } = toolPermission
    const allow = decision !== 'deny'
    clearToolPermission(sessionId)
    void respondPermission?.({
      requestId,
      allow,
      ...(allow ? { scope: decision } : { message: '用户拒绝' })
    })
      .then((ok) => {
        if (!ok) console.error('[agent] 审批请求已失效')
      })
      .catch((error) => {
        console.error('[agent] 回写审批失败', error)
        if (!useWorkstation.getState().toolPermissions[sessionId]) {
          useWorkstation.getState().setToolPermission(sessionId, toolPermission)
        }
      })
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
        <button
          className={`w1-aworkspace${activeSession.workspace ? ' on' : ' missing'}`}
          type="button"
          title={activeSession.workspace ?? '选择 Agent 工作区'}
          aria-label={activeSession.workspace ? '更换 Agent 工作区' : '选择 Agent 工作区'}
          disabled={typingHere || workspaceBusy}
          onClick={pickWorkspace}
        >
          <FolderIcon width={11} height={11} />
          <span>{workspaceBusy ? '选择中…' : workspaceName(activeSession.workspace)}</span>
        </button>
        <button
          className="w1-aworkspacefiles"
          type="button"
          title="查看工作区文件与本回合产物"
          disabled={!activeSession.workspace}
          onClick={() => setWorkspaceOpen(true)}
        >
          文件
        </button>
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
            <b>{writeApproval ? '审批' : '只读'}</b>
          </div>

          {!activeSession.workspace ? (
            <div className="w1-aworkspacegate">
              <span className="w1-aworkspacegateicon">
                <FolderIcon width={18} height={18} />
              </span>
              <span className="w1-aworkspacegatecopy">
                <b>先选择一个工作区</b>
                <p>{workspaceError ?? `${meta.name} 会在这个目录里运行；不会使用应用安装目录。`}</p>
              </span>
              <button
                className="w1-pb pri"
                type="button"
                disabled={typingHere || workspaceBusy}
                onClick={pickWorkspace}
              >
                {workspaceBusy ? '选择中…' : '选择目录'}
              </button>
            </div>
          ) : null}

          {thread.some((message) => message.imported) ? (
            <div className="w1-importnote" role="status">
              <b>历史</b>
              导入自本机 CLI 的只读历史 · 新消息继续由 CLI 续接
            </div>
          ) : null}

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
            {mcpPermission && mcpPermission.sessionId === activeSession.id ? (
              <McpApprovalCard
                key={mcpPermission.requestId}
                request={mcpPermission}
                onResolve={resolveMcpPermission}
              />
            ) : null}
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

      {pendingElsewhereId && pendingElsewhereCount > 0 ? (
        <button
          className="w1-queue"
          type="button"
          onClick={() => setActiveSession(pendingElsewhereId)}
        >
          <span className="w1-queue-dot" />
          其它会话有 {pendingElsewhereCount} 项待审批 · 查看
        </button>
      ) : null}

      <AnimatePresence>
        {workspaceOpen && activeSession.workspace ? (
          <WorkspaceSheet
            sessionId={activeSession.id}
            workspace={activeSession.workspace}
            artifacts={artifacts}
            onClose={() => setWorkspaceOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      <Composer
        key={activeSession.id}
        agent={agent}
        typing={typingHere}
        writeApproval={writeApproval}
        workspace={activeSession.workspace}
        onSend={sendMessage}
      />
    </aside>
  )
}
