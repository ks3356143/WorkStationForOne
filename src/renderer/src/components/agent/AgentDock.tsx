import { SpotlightLayer } from '../effects/SpotlightLayer'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { AGENT_META, agentCommandPreview, workspaceName } from '../../lib/agent'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { selectActiveSession, selectActiveThread, useWorkstation } from '../../store/useWorkstation'
import type { AgentId, Task } from '../../types'
import type {
  AgentCheckpointView,
  AgentRollbackResult,
  McpPermissionDecision,
  ProviderProfileRecord
} from '../../../../shared/ipc'
import { FolderIcon } from '../Glyphs'
import { Composer } from './Composer'
import { DockHeader } from './DockHeader'
import { McpApprovalCard } from './McpApprovalCard'
import { MessageRow } from './MessageRow'
import { PermissionCard } from './PermissionCard'
import { QuestionCard } from './QuestionCard'
import { ToolApprovalCard } from './ToolApprovalCard'
import { WorkspaceSheet } from './WorkspaceSheet'
import { CheckpointSheet } from './CheckpointSheet'
import { friendlyMessage } from '../../lib/errors'
import { activeProviderLabel } from '../../lib/provider-label'
import { messageToNote, messageToTask } from '../../lib/agent-capture'
import { toChatMessage } from '../../lib/chat-message'
import { StatePlaceholder } from '../StatePlaceholder'
import { canForkWithCli } from '../../../../shared/fork'
import {
  INITIAL_THREAD_WINDOW,
  THREAD_WINDOW_STEP,
  threadWindowForMessage,
  threadWindowStart
} from '../../lib/thread-window'

const EMPTY_TASKS: Task[] = []

interface AgentDockProps {
  notify: (text: string, action?: { label: string; run: () => void }, duration?: number) => void
}

export function AgentDock({ notify }: AgentDockProps) {
  const sessions = useWorkstation((state) => state.sessions)
  const setActiveSession = useWorkstation((state) => state.setActiveSession)
  const addNote = useWorkstation((state) => state.addNote)
  const addTask = useWorkstation((state) => state.addTask)
  const agentDraftRequest = useWorkstation((state) => state.agentDraftRequest)
  const agentDraftText = useWorkstation((state) => state.agentDraftText)
  const agentDraftSessionId = useWorkstation((state) => state.agentDraftSessionId)
  const consumeAgentDraft = useWorkstation((state) => state.consumeAgentDraft)
  const createAgentSession = useWorkstation((state) => state.createAgentSession)
  const removeAgentSession = useWorkstation((state) => state.removeAgentSession)
  const toggleAgentPlanMode = useWorkstation((state) => state.toggleAgentPlanMode)
  const addForkedSession = useWorkstation((state) => state.addForkedSession)
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
  const agentQuestion = useWorkstation((state) => state.agentQuestions[state.activeSessionId])
  const clearAgentQuestion = useWorkstation((state) => state.clearAgentQuestion)
  const agentJumpMessageId = useWorkstation((state) => state.agentJumpMessageId)
  const clearAgentJump = useWorkstation((state) => state.clearAgentJump)
  const threadLoaded = useWorkstation((state) =>
    Boolean(state.threadsLoaded[state.activeSessionId])
  )
  const agentAttentionRequestId = useWorkstation((state) => state.agentAttentionRequestId)
  // 后台会话的审批不抢占当前聊天，但要在输入栏上方留一个入口
  const pendingElsewhereId = useWorkstation((state) => {
    const pending = state.sessions.find(
      (session) =>
        session.id !== state.activeSessionId &&
        Boolean(
          state.toolPermissions[session.id] ||
            state.mcpPermissions[session.id] ||
            state.agentQuestions[session.id] ||
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
              state.agentQuestions[session.id] ||
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
  const retryMessage = useWorkstation((state) => state.retryMessage)
  const resolvePermission = useWorkstation((state) => state.resolvePermission)
  const setAgentWorkspace = useWorkstation((state) => state.setAgentWorkspace)
  const [codexApproval, setCodexApproval] = useState(false)
  const [providers, setProviders] = useState<ProviderProfileRecord[]>([])
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [checkpointsOpen, setCheckpointsOpen] = useState(false)
  const [checkpoints, setCheckpoints] = useState<AgentCheckpointView[]>([])
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [forkingId, setForkingId] = useState<string | null>(null)
  const [deleteState, setDeleteState] = useState<'idle' | 'armed' | 'busy' | 'error'>('idle')
  const [stopRequested, setStopRequested] = useState(false)
  const deleteTimer = useRef<number | null>(null)
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  // biome-ignore lint/correctness/useExhaustiveDependencies: 切换会话时收起删除二次确认并复位停止状态
  useEffect(() => {
    setDeleteState('idle')
    setStopRequested(false)
    if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
  }, [activeId])

  useEffect(
    () => () => {
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
    },
    []
  )

  useEffect(() => {
    if (!activeId || threadLoaded) return
    const api = typeof window === 'undefined' ? undefined : window.ws?.agent
    if (!api?.thread) {
      useWorkstation.getState().setAgentThread(activeId, [])
      return
    }
    let alive = true
    void api
      .thread(activeId)
      .then((records) => {
        if (!alive) return
        // 会话可能在读取期间被删除，别把线程写回一个已不存在的会话。
        if (!useWorkstation.getState().sessions.some((session) => session.id === activeId)) return
        useWorkstation.getState().setAgentThread(activeId, records.map(toChatMessage))
      })
      .catch((error: unknown) => {
        if (!alive) return
        // 不标记为已加载：切回这个会话时会再次尝试。
        notifyRef.current(friendlyMessage(error, '读取会话失败'))
      })
    return () => {
      alive = false
    }
  }, [activeId, threadLoaded])

  useEffect(() => {
    let alive = true
    const load = () => {
      void window.ws?.provider
        .list()
        .then((list) => {
          if (!alive) return
          setProviders(list)
          setCodexApproval(list.some((profile) => profile.target === 'codex' && profile.active))
        })
        .catch(() => {
          if (alive) {
            setProviders([])
            setCodexApproval(false)
          }
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
  const nearBottomRef = useRef(true)
  const lastScrollSession = useRef(activeId)
  const [approvalAway, setApprovalAway] = useState(false)
  const threadMeta = useRef({
    sessionId: activeId,
    length: thread.length,
    initialized: false
  })
  const [threadWindow, setThreadWindow] = useState({
    sessionId: activeId,
    count: INITIAL_THREAD_WINDOW
  })
  const visibleCount =
    threadWindow.sessionId === activeId ? threadWindow.count : INITIAL_THREAD_WINDOW
  const windowStart = threadWindowStart(thread.length, visibleCount)
  const visibleThread = windowStart > 0 ? thread.slice(windowStart) : thread
  const earlierRef = useRef<HTMLDivElement>(null)
  const scrollAdjustRef = useRef<{ sessionId: string; height: number; top: number } | null>(null)

  const loadEarlier = useCallback(() => {
    if (windowStart <= 0) return
    const node = threadRef.current
    if (node) {
      // 记下加载前的滚动高度；渲染后把 scrollTop 补回去，画面不跳。
      scrollAdjustRef.current = {
        sessionId: activeId,
        height: node.scrollHeight,
        top: node.scrollTop
      }
      nearBottomRef.current = false
    }
    setThreadWindow({
      sessionId: activeId,
      count: Math.min(thread.length, visibleCount + THREAD_WINDOW_STEP)
    })
  }, [activeId, thread.length, visibleCount, windowStart])

  useLayoutEffect(() => {
    if (threadWindow.sessionId !== activeId) return
    const adjust = scrollAdjustRef.current
    if (!adjust || adjust.sessionId !== activeId) return
    const node = threadRef.current
    if (!node) return
    scrollAdjustRef.current = null
    node.scrollTop = adjust.top + (node.scrollHeight - adjust.height)
    nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96
  }, [threadWindow, activeId])

  useEffect(() => {
    if (windowStart <= 0) return
    const root = threadRef.current
    const target = earlierRef.current
    if (!root || !target || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadEarlier()
      },
      { root, rootMargin: '320px 0px 0px 0px' }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [windowStart, loadEarlier])

  useEffect(() => {
    if (!agentJumpMessageId || !activeId) return
    const index = thread.findIndex((message) => message.id === agentJumpMessageId)
    if (index < 0) return
    const needed = threadWindowForMessage(thread.length, visibleCount, index)
    if (needed > visibleCount) {
      setThreadWindow({ sessionId: activeId, count: needed })
      return
    }
    const root = threadRef.current
    if (!root) return
    const node = root.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(agentJumpMessageId)}"]`
    )
    if (!node) return
    clearAgentJump()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    node.classList.add('w1-msg-jump')
    window.setTimeout(() => node.classList.remove('w1-msg-jump'), 1800)
  }, [agentJumpMessageId, activeId, thread, visibleCount, clearAgentJump])
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
    claude: sessions.filter((session) => session.agent === 'claude' && !session.archived).length,
    codex: sessions.filter((session) => session.agent === 'codex' && !session.archived).length
  }
  // 只看当前会话：别的会话在跑不该锁住这里的输入
  const typingHere = Boolean(activeId) && (Boolean(streamHere) || queuedHere)
  const checkpointsByRun = useMemo(() => {
    const map = new Map<string, AgentCheckpointView>()
    for (const checkpoint of checkpoints) map.set(checkpoint.runId, checkpoint)
    return map
  }, [checkpoints])
  const latestCheckpointRunId = checkpoints[0]?.runId

  // biome-ignore lint/correctness/useExhaustiveDependencies: 回合结束、线程加载与检查点面板关闭都要重新拉一次
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.ws?.agent
    if (!api || !activeId) {
      setCheckpoints([])
      return
    }
    let alive = true
    void api
      .checkpoints(activeId)
      .then((list) => {
        if (alive) setCheckpoints(list)
      })
      .catch(() => {
        if (alive) setCheckpoints([])
      })
    return () => {
      alive = false
    }
  }, [activeId, typingHere, threadLoaded, checkpointsOpen])

  const rollbackTurn = useCallback(
    async (checkpoint: AgentCheckpointView): Promise<AgentRollbackResult> => {
      const api = typeof window === 'undefined' ? undefined : window.ws?.agent
      if (!api) throw new Error('当前环境没有 preload 桥')
      const result = await api.rollback(checkpoint.id)
      setCheckpoints((list) =>
        list.map((item) => (item.id === checkpoint.id ? { ...item, restoredAt: Date.now() } : item))
      )
      return result
    },
    []
  )

  useEffect(() => {
    if (!typingHere) setStopRequested(false)
  }, [typingHere])

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

  const approvalKey =
    toolPermission?.requestId ??
    mcpPermission?.requestId ??
    agentQuestion?.requestId ??
    permission?.id ??
    ''

  // 有审批卡时窗口变窄也要把卡贴到可见区域，避免被输入栏盖住。
  useEffect(() => {
    if (!approvalKey) return
    const onResize = () => {
      const node = threadRef.current
      if (node && nearBottomRef.current) node.scrollTop = node.scrollHeight
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [approvalKey])

  // 只看用户是否原本停在底部：读历史时不抢滚动；审批卡在视野外则给一个入口。
  // biome-ignore lint/correctness/useExhaustiveDependencies: thread.length / typingHere / approvalKey / activeId 是滚动触发条件
  useLayoutEffect(() => {
    const node = threadRef.current
    if (!node) return
    if (lastScrollSession.current !== activeId) {
      lastScrollSession.current = activeId
      nearBottomRef.current = true
      setApprovalAway(false)
    }
    if (nearBottomRef.current) {
      node.scrollTop = node.scrollHeight
      setApprovalAway(false)
    } else if (approvalKey) {
      setApprovalAway(true)
    }
  }, [thread.length, typingHere, approvalKey, activeId])

  // diff 展开、代码高亮等子内容会在挂载后改变高度；用户原本贴底时继续跟随。
  useEffect(() => {
    if (!activeId) return
    const node = threadRef.current
    const content = node?.querySelector<HTMLElement>('.w1-threadpad')
    if (!node || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // content-visibility 会在滚动时改变离屏高度；用户已经滚到顶部时不要把他拉回底部。
      if (nearBottomRef.current && node.scrollTop > 0) node.scrollTop = node.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [activeId])

  const onThreadScroll = () => {
    const node = threadRef.current
    if (!node) return
    const near = node.scrollHeight - node.scrollTop - node.clientHeight < 96
    nearBottomRef.current = near
    // IntersectionObserver 在部分合成帧里会漏掉程序化滚动；滚到顶部时直接补一批。
    if (node.scrollTop < 240 && windowStart > 0) loadEarlier()
    if (near && approvalAway) setApprovalAway(false)
  }

  const scrollToApproval = () => {
    const card = threadRef.current?.querySelector('.w1-perm')
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    setApprovalAway(false)
  }

  // 通知点击后即使线程此前停在更早的消息，也要把待处理卡带回视野。
  useEffect(() => {
    if (!agentAttentionRequestId) return
    const frame = requestAnimationFrame(() => {
      const card = threadRef.current?.querySelector('.w1-perm')
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      setApprovalAway(false)
      useWorkstation.getState().clearAgentAttention()
    })
    return () => cancelAnimationFrame(frame)
  }, [agentAttentionRequestId])

  const switchAgent = (next: AgentId) => {
    if (agent === next) return
    const session = sessions.find((item) => item.agent === next && !item.archived)
    if (session) {
      setActiveSession(session.id)
      return
    }
    // 没有该 Agent 的会话时直接新建：标签页不能点了没反应
    createAgentSession(next)
  }

  if (!activeSession) {
    return (
      <aside className="w1-dock">
        <DockHeader agent="claude" counts={counts} status="idle" onSwitch={switchAgent} />
        <div className="w1-agentempty" data-spotlight>
          <SpotlightLayer />
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

  const command = agentCommandPreview(
    agent,
    activeSession.resumeId,
    codexApproval,
    activeSession.pendingFork === true
  )
  const meta = AGENT_META[agent]
  const writeApproval = agent === 'claude' || codexApproval
  const respondPermission =
    typeof window === 'undefined' ? undefined : window.ws?.agent?.respondPermission

  const exportSession = () => {
    const bridge = typeof window === 'undefined' ? undefined : window.ws?.agent
    if (!bridge?.exportSession || exportState === 'busy') return
    setExportState('busy')
    void bridge
      .exportSession(activeSession.id)
      .then((result) => {
        if (result.canceled) {
          setExportState('idle')
          return
        }
        setExportState('done')
        window.setTimeout(() => setExportState('idle'), 1800)
      })
      .catch((error: unknown) => {
        console.error('[agent] 导出会话失败', error)
        setExportState('error')
        window.setTimeout(() => setExportState('idle'), 2200)
      })
  }

  const stopHere = () => {
    const runId = streamHere?.runId
    if (!runId || stopRequested) return
    const bridge = typeof window === 'undefined' ? undefined : window.ws?.agent
    if (!bridge?.cancel) {
      notify('当前环境不支持停止运行')
      return
    }
    setStopRequested(true)
    void bridge
      .cancel(runId)
      .then(() => notify(queuedHere ? '已请求停止；排队的提示词会继续发送' : '已请求停止'))
      .catch((error: unknown) => {
        setStopRequested(false)
        notify(error instanceof Error ? error.message : '停止失败')
      })
  }

  const deleteSession = () => {
    if (typingHere || deleteState === 'busy') return
    if (deleteState !== 'armed') {
      setDeleteState('armed')
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
      deleteTimer.current = window.setTimeout(() => setDeleteState('idle'), 4000)
      return
    }
    if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
    const bridge = typeof window === 'undefined' ? undefined : window.ws?.agent
    if (!bridge?.deleteSession) return
    setDeleteState('busy')
    void bridge
      .deleteSession(activeSession.id)
      .then((removed) => {
        if (!removed) throw new Error('会话不存在')
        removeAgentSession(activeSession.id)
      })
      .catch((error: unknown) => {
        console.error('[agent] 删除会话失败', error)
        setDeleteState('error')
        deleteTimer.current = window.setTimeout(() => setDeleteState('idle'), 2400)
      })
  }

  /** 把助手回复收进笔记 / 任务：标题取首行，正文按主进程上限截断。 */
  const captureNote = (text: string) => {
    const body = messageToNote(text)
    if (!body) {
      notify('这条回复没有可保存的正文')
      return
    }
    addNote(body, 'Agent')
    notify('已存为笔记 · 标签 Agent')
  }

  const captureTask = (text: string) => {
    const next = messageToTask(text)
    if (!next) {
      notify('这条回复没有可保存的正文')
      return
    }
    addTask({ title: next.title, notes: next.notes })
    notify('已建任务 · 标题取自首行')
  }

  const forkMessage = (messageId: string) => {
    const bridge = typeof window === 'undefined' ? undefined : window.ws?.agent
    if (!bridge?.forkSession || forkingId) return
    setForkingId(messageId)
    void bridge
      .forkSession({ sessionId: activeSession.id, messageId })
      .then((result) => {
        addForkedSession(result)
        notify(
          result.mode === 'cli'
            ? '已从 CLI 真分叉：下一条消息延续原上下文'
            : '已复制到此消息：较早位置无法真分叉',
          undefined,
          4200
        )
      })
      .catch((error: unknown) => console.error('[agent] 分叉会话失败', error))
      .finally(() => setForkingId(null))
  }

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
        setWorkspaceError(friendlyMessage(error, '选择工作区失败'))
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

  const resolveQuestion = (answers: Record<string, string> | null) => {
    if (!agentQuestion || !activeSession) return
    const { requestId } = agentQuestion
    const sessionId = activeSession.id
    clearAgentQuestion(sessionId)
    void window.ws?.agent
      ?.respondQuestion({ requestId, ...(answers ? { answers } : { deny: true }) })
      .then((ok) => {
        if (!ok) console.error('[agent] 问答请求已失效')
      })
      .catch((error) => {
        console.error('[agent] 回写问答失败', error)
        if (!useWorkstation.getState().agentQuestions[sessionId]) {
          useWorkstation.getState().setAgentQuestion(sessionId, { ...agentQuestion })
        }
      })
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
          // 必须换一个新对象：卡片 key 仍是同一个 requestId，AnimatePresence 会复用旧实例，
          // 而 ToolApprovalCard 只在新 request 身份变化时把 busy 复位，否则恢复后的卡片会一直禁用。
          useWorkstation.getState().setToolPermission(sessionId, { ...toolPermission })
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
        <button
          className="w1-aworkspacefiles"
          type="button"
          title="查看并回退文件检查点"
          disabled={!activeSession.workspace}
          onClick={() => setCheckpointsOpen(true)}
        >
          检查点
        </button>
        <button
          className="w1-aworkspacefiles"
          type="button"
          title="导出当前会话为 Markdown"
          disabled={exportState === 'busy'}
          onClick={exportSession}
        >
          {exportState === 'busy'
            ? '导出中…'
            : exportState === 'done'
              ? '已导出'
              : exportState === 'error'
                ? '导出失败'
                : '导出'}
        </button>
        <button
          className={`w1-aworkspacefiles w1-adelete${deleteState === 'armed' ? ' armed' : ''}`}
          type="button"
          title={typingHere ? '会话运行中，先停止再删除' : '删除当前会话（消息一并删除）'}
          aria-label="删除当前会话"
          disabled={typingHere || deleteState === 'busy'}
          onClick={deleteSession}
        >
          {deleteState === 'busy'
            ? '删除中…'
            : deleteState === 'armed'
              ? '确认删除'
              : deleteState === 'error'
                ? '删除失败'
                : '删除'}
        </button>
        <span className="loc">本地</span>
      </div>

      <div className="w1-thread" ref={threadRef} onScroll={onThreadScroll}>
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
            <b>{activeSession.planMode ? '计划' : writeApproval ? '审批' : '只读'}</b>
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

          {!threadLoaded ? (
            <StatePlaceholder kind="loading" title="正在读取会话…" rows={4} />
          ) : (
            <>
              {windowStart > 0 ? (
                <div className="w1-threadmore" ref={earlierRef}>
                  <button type="button" onClick={loadEarlier}>
                    加载更早的 {Math.min(THREAD_WINDOW_STEP, windowStart)} 条 · 还有 {windowStart}{' '}
                    条
                  </button>
                </div>
              ) : null}

              {thread.some((message) => message.imported) ? (
                <div className="w1-importnote" role="status">
                  <b>历史</b>
                  导入自本机 CLI 的只读历史 · 新消息继续由 CLI 续接
                </div>
              ) : null}

              {visibleThread.map((message, visibleIndex) => {
                const index = windowStart + visibleIndex
                const runCheckpoint = message.runId
                  ? checkpointsByRun.get(message.runId)
                  : undefined
                return (
                  <MessageRow
                    key={message.id}
                    message={message}
                    agent={agent}
                    animate={message.id === animateId}
                    onSaveNote={
                      message.role === 'assistant' && !message.error && message.text.trim()
                        ? () => captureNote(message.text)
                        : undefined
                    }
                    onSaveTask={
                      message.role === 'assistant' && !message.error && message.text.trim()
                        ? () => captureTask(message.text)
                        : undefined
                    }
                    onFork={
                      message.role === 'assistant' && !typingHere
                        ? () => forkMessage(message.id)
                        : undefined
                    }
                    forkTitle={
                      canForkWithCli(
                        { agent, resumeId: activeSession.resumeId },
                        thread,
                        message.id
                      )
                        ? '从这条回复真分叉：下一条消息延续 CLI 上下文'
                        : '复制到此消息；只有最新回复能真分叉'
                    }
                    forking={forkingId === message.id}
                    turnCheckpoint={runCheckpoint}
                    turnRollbackEnabled={
                      runCheckpoint
                        ? message.runId === latestCheckpointRunId && !runCheckpoint.restoredAt
                        : false
                    }
                    onRollbackTurn={rollbackTurn}
                    running={typingHere}
                    notify={notify}
                    onRetry={
                      message.error && !message.imported && !typingHere
                        ? () => {
                            for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
                              const previous = thread[cursor]
                              if (previous?.role === 'user') {
                                retryMessage(previous.text, previous.contextFiles, previous.images)
                                break
                              }
                            }
                          }
                        : undefined
                    }
                  />
                )
              })}
            </>
          )}

          {threadLoaded && typingHere && !agentQuestion ? (
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
            {agentQuestion ? (
              <QuestionCard
                key={agentQuestion.requestId}
                request={agentQuestion}
                onResolve={resolveQuestion}
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

      {approvalAway ? (
        <button className="w1-queue" type="button" onClick={scrollToApproval}>
          <span className="w1-queue-dot" />
          当前会话有 1 项待审批 · 查看
        </button>
      ) : null}

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
        {checkpointsOpen && activeSession.workspace ? (
          <CheckpointSheet
            sessionId={activeSession.id}
            running={typingHere}
            onClose={() => setCheckpointsOpen(false)}
            notify={notify}
          />
        ) : null}
      </AnimatePresence>

      <Composer
        key={`${activeSession.id}:${activeSession.workspace ?? ''}`}
        sessionId={activeSession.id}
        agent={agent}
        typing={typingHere}
        writeApproval={writeApproval}
        planMode={activeSession.planMode === true}
        onTogglePlanMode={() => toggleAgentPlanMode(activeSession.id)}
        providerLabel={activeProviderLabel(providers, agent)}
        threadReady={threadLoaded}
        workspace={activeSession.workspace}
        runId={streamHere?.runId ?? null}
        queued={queuedHere}
        stopping={stopRequested}
        draftRequest={agentDraftRequest}
        draftText={agentDraftText}
        draftSessionId={agentDraftSessionId}
        onDraftApplied={consumeAgentDraft}
        onSend={sendMessage}
        onStop={stopHere}
      />
    </aside>
  )
}
