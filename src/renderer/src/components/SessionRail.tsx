import { BeamLayer } from './effects/BeamLayer'
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import type { AgentSessionSearchHit } from '../../../shared/ipc'
import { sortPinnedFirst } from '../lib/agent'
import { useListAnimate } from '../lib/use-list-animate'
import { useWorkstation } from '../store/useWorkstation'
import { ClaudeGlyph, CodexGlyph, PlusIcon } from './Glyphs'
import { StatePlaceholder } from './StatePlaceholder'

function highlight(text: string, query: string): ReactNode {
  if (!query) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.split(new RegExp(`(${escaped})`, 'ig')).map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: 高亮片段按切分位置稳定，索引即位置
      <mark key={index}>{part}</mark>
    ) : (
      part
    )
  )
}

export function SessionRail() {
  const sessions = useWorkstation((state) => state.sessions)
  const sessionsReady = useWorkstation((state) => state.sessionsReady)
  const activeSessionId = useWorkstation((state) => state.activeSessionId)
  const setActiveSession = useWorkstation((state) => state.setActiveSession)
  const openAgentMessage = useWorkstation((state) => state.openAgentMessage)
  const renameAgentSession = useWorkstation((state) => state.renameAgentSession)
  const toggleAgentSessionPin = useWorkstation((state) => state.toggleAgentSessionPin)
  const createAgentSession = useWorkstation((state) => state.createAgentSession)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<AgentSessionSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const cancelRename = useRef(false)
  const searchSeq = useRef(0)
  const trimmed = query.trim()
  const visibleSessions = sessions.filter((session) => !session.archived)

  useEffect(() => {
    if (!trimmed) {
      setHits(null)
      setSearching(false)
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const timer = window.setTimeout(() => {
      const bridge = window.ws?.agent
      if (!bridge?.searchSessions) {
        setHits(null)
        setSearching(false)
        return
      }
      bridge
        .searchSessions(trimmed)
        .then((list) => {
          if (seq === searchSeq.current) {
            setHits(list)
            setSearching(false)
          }
        })
        .catch(() => {
          if (seq === searchSeq.current) {
            setHits(null)
            setSearching(false)
          }
        })
    }, 160)
    return () => window.clearTimeout(timer)
  }, [trimmed])

  const localMatches = trimmed
    ? visibleSessions.filter(
        (session) =>
          session.title.toLowerCase().includes(trimmed.toLowerCase()) ||
          session.meta.toLowerCase().includes(trimmed.toLowerCase())
      )
    : []
  const results = (
    hits ??
    localMatches.map((session) => ({
      session: {
        id: session.id,
        agent: session.agent,
        title: session.title,
        status: session.status,
        resumeId: session.resumeId,
        workspace: session.workspace,
        archived: session.archived,
        createdAt: 0,
        updatedAt: 0
      },
      snippet: '',
      matchedIn: 'title' as const
    }))
  )
    .map((hit) => ({
      hit,
      session: sessions.find((session) => session.id === hit.session.id)
    }))
    .filter(({ hit, session }) => !(session ?? hit.session).archived)

  const startRename = (sessionId: string, title: string) => {
    cancelRename.current = false
    setEditingId(sessionId)
    setDraft(title)
  }

  const commitRename = (sessionId: string) => {
    if (cancelRename.current) {
      cancelRename.current = false
      setEditingId(null)
      return
    }
    renameAgentSession(sessionId, draft)
    setEditingId(null)
  }

  const claudeSessions = sortPinnedFirst(
    visibleSessions.filter((session) => session.agent === 'claude')
  )
  const codexSessions = sortPinnedFirst(
    visibleSessions.filter((session) => session.agent === 'codex')
  )

  const claudeAnim = useListAnimate<HTMLDivElement>()
  const codexAnim = useListAnimate<HTMLDivElement>()
  const renderGroup = (
    agent: 'claude' | 'codex',
    list: typeof sessions,
    ref: Ref<HTMLDivElement>
  ) => (
    <div className="w1-agroup" ref={ref}>
      <div className="w1-ahead">
        <span className="w1-aglyph">
          {agent === 'claude' ? (
            <ClaudeGlyph width={11} height={11} />
          ) : (
            <CodexGlyph width={11} height={11} />
          )}
        </span>
        <span className="w1-aname">{agent === 'claude' ? 'Claude Code' : 'Codex'}</span>
        <span className="w1-acount">[{list.length}]</span>
        <button
          className="w1-plus w1-gadd"
          type="button"
          aria-label={`新建 ${agent === 'claude' ? 'Claude' : 'Codex'} 会话`}
          title={`新建 ${agent === 'claude' ? 'Claude' : 'Codex'} 会话`}
          onClick={() => createAgentSession(agent)}
        >
          <PlusIcon width={9} height={9} />
        </button>
      </div>
      {list.map((session) =>
        editingId === session.id ? (
          <div className="w1-sess editing" key={session.id}>
            <input
              className="w1-sessrename"
              value={draft}
              autoFocus
              maxLength={80}
              aria-label="会话标题"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => commitRename(session.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitRename(session.id)
                } else if (event.key === 'Escape') {
                  event.stopPropagation()
                  cancelRename.current = true
                  setEditingId(null)
                }
              }}
            />
            <span className="w1-sm">Enter 保存 · Esc 取消</span>
          </div>
        ) : (
          <div className={`w1-sessrow${session.pinned ? ' pinned' : ''}`} key={session.id}>
            <button
              type="button"
              className={[
                'w1-sess',
                session.status === 'run' ? 'run' : '',
                session.status === 'wait' ? 'wait' : '',
                session.id === activeSessionId ? 'on' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={session.id === activeSessionId ? 'true' : undefined}
              data-session-id={session.id}
              title="双击或按 F2 重命名"
              onClick={() => setActiveSession(session.id)}
              onDoubleClick={() => startRename(session.id, session.title)}
              onKeyDown={(event) => {
                if (event.key !== 'F2') return
                event.preventDefault()
                startRename(session.id, session.title)
              }}
            >
              {session.status === 'run' ? <BeamLayer /> : null}
              <span className="w1-st">{session.title}</span>
              <span className="w1-sm">
                {session.meta}
                {session.pinned ? <i className="w1-spinmark">置顶</i> : null}
              </span>
            </button>
            <button
              type="button"
              className="w1-sesspinicon"
              aria-label={`${session.pinned ? '取消置顶' : '置顶'} ${session.title}`}
              aria-pressed={Boolean(session.pinned)}
              title={session.pinned ? '取消置顶' : '置顶会话'}
              onClick={() => toggleAgentSessionPin(session.id)}
            >
              {session.pinned ? '★' : '☆'}
            </button>
            <button
              type="button"
              className="w1-sessrenameicon"
              aria-label={`重命名 ${session.title}`}
              title="重命名"
              onClick={() => startRename(session.id, session.title)}
            >
              ✎
            </button>
          </div>
        )
      )}
    </div>
  )

  return (
    <aside className="w1-rail" aria-label="会话列表">
      <div className="w1-rhead">
        <span className="w1-eyebrow">// 会话</span>
        <span className="w1-acount">{visibleSessions.length}</span>
      </div>

      <div className="w1-railsearch">
        <span className="w1-railsearchglyph" aria-hidden="true">
          ⌕
        </span>
        <input
          value={query}
          placeholder="搜索会话与消息"
          aria-label="搜索会话与消息"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            setQuery('')
          }}
        />
        {query ? (
          <button
            type="button"
            className="w1-railsearchclear"
            aria-label="清空会话搜索"
            onClick={() => setQuery('')}
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="w1-railscroll">
        {sessionsReady ? (
          trimmed ? (
            <div className="w1-srlist" role="group" aria-label="会话搜索结果">
              <div className="w1-rhead">
                <span className="w1-eyebrow">// 搜索{searching ? '…' : ''}</span>
                <span className="w1-acount">{searching ? '·' : results.length}</span>
              </div>
              {results.map(({ hit, session }) => {
                const item = session ?? hit.session
                const active = item.id === activeSessionId
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={['w1-sess', 'search', active ? 'on' : ''].filter(Boolean).join(' ')}
                    aria-current={active ? 'true' : undefined}
                    onClick={() =>
                      openAgentMessage(item.id, hit.matchedIn === 'message' ? hit.messageId : null)
                    }
                  >
                    <span className="w1-st">{highlight(item.title, trimmed)}</span>
                    <span className="w1-sm">
                      {hit.matchedIn === 'message' && hit.snippet
                        ? highlight(hit.snippet, trimmed)
                        : (session?.meta ?? '')}
                    </span>
                    {hit.matchedIn === 'message' ? <i className="w1-srhit">正文</i> : null}
                  </button>
                )
              })}
              {!searching && results.length === 0 ? (
                <p className="w1-srempty">没有匹配的会话与消息。</p>
              ) : null}
            </div>
          ) : (
            <>
              {visibleSessions.length === 0 && sessions.length > 0 ? (
                <p className="w1-srempty">所有会话已归档，可在舰队控制台恢复。</p>
              ) : null}
              {renderGroup('claude', claudeSessions, claudeAnim)}
              {renderGroup('codex', codexSessions, codexAnim)}
            </>
          )
        ) : (
          <StatePlaceholder kind="loading" rows={3} />
        )}
      </div>
    </aside>
  )
}
