import { useEffect, useState, type CSSProperties } from 'react'
import type { AgentTeamNoteRecord, AgentTeamSummary } from '../../../../shared/ipc'
import { workspaceName } from '../../lib/agent'
import { useWorkstation } from '../../store/useWorkstation'
import { useListAnimate } from '../../lib/use-list-animate'
import { PanelLoadError } from '../PanelLoadError'

interface TeamsPanelProps {
  notify: (text: string) => void
  /** 打开某个团队会话后关闭舰队 */
  onOpened: () => void
}

const errText = (error: unknown): string => (error instanceof Error ? error.message : '操作失败')

export function TeamsPanel({ notify, onOpened }: TeamsPanelProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.agent
  const openAgentSession = useWorkstation((state) => state.openAgentSession)
  const addAgentSessions = useWorkstation((state) => state.addAgentSessions)
  const workspace = useWorkstation(
    (state) => state.sessions.find((session) => session.id === state.activeSessionId)?.workspace
  )
  const [teams, setTeams] = useState<AgentTeamSummary[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [notes, setNotes] = useState<AgentTeamNoteRecord[]>([])
  const [notesError, setNotesError] = useState<string | null>(null)
  const [notesSeq, setNotesSeq] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [workers, setWorkers] = useState('')

  const reload = (preferredId?: string) => {
    if (!api) return
    void api
      .listTeams()
      .then((list) => {
        setLoadError(null)
        setTeams(list)
        const wanted = preferredId ?? selectedId
        if (list.some((team) => team.teamId === wanted)) setSelectedId(wanted)
        else setSelectedId(list[0]?.teamId ?? '')
      })
      .catch((error: unknown) => {
        setTeams([])
        setLoadError(errText(error))
      })
  }
  useEffect(() => {
    if (!api) return
    let alive = true
    void api
      .listTeams()
      .then((list) => {
        if (!alive) return
        setLoadError(null)
        setTeams(list)
        setSelectedId((current) =>
          list.some((team) => team.teamId === current) ? current : (list[0]?.teamId ?? '')
        )
      })
      .catch((error: unknown) => {
        if (!alive) return
        setTeams([])
        setLoadError(errText(error))
      })
    return () => {
      alive = false
    }
  }, [api])

  // biome-ignore lint/correctness/useExhaustiveDependencies: notesSeq 是黑板「重试」触发器，effect 内不读取
  useEffect(() => {
    if (!api || !selectedId) {
      setNotes([])
      setNotesError(null)
      return
    }
    let alive = true
    setNotes([])
    setNotesError(null)
    void api
      .teamNotes(selectedId)
      .then((list) => {
        if (alive) setNotes(list)
      })
      .catch((error: unknown) => {
        if (alive) setNotesError(errText(error))
      })
    return () => {
      alive = false
    }
  }, [api, selectedId, notesSeq])

  const selected = teams.find((team) => team.teamId === selectedId)
  const leader = selected?.sessions[0]
  const teamListAnim = useListAnimate<HTMLDivElement>()
  const membersAnim = useListAnimate<HTMLDivElement>()
  const notesAnim = useListAnimate<HTMLDivElement>()

  const createTeam = () => {
    if (!api || busy) return
    if (!workspace) {
      notify('先给当前会话选择一个工作区')
      return
    }
    const titles = workers
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
    if (titles.length === 0) {
      notify('至少填一个 worker 标题')
      return
    }
    setBusy(true)
    void api
      .createTeam({
        name: name.trim() || '专家小队',
        workspace,
        workers: titles.map((title) => ({ title }))
      })
      .then((team) => {
        setCreateOpen(false)
        setName('')
        setWorkers('')
        // 新建的会话只在数据库里；补进 store 后 rail / 成员按钮才打得开。
        addAgentSessions(team.sessions)
        reload(team.teamId)
        notify(`已建团队：${team.name} · ${team.sessions.length} 个会话`)
      })
      .catch((error: unknown) => notify(errText(error)))
      .finally(() => setBusy(false))
  }

  const post = () => {
    if (!api || !selected || !leader || busy) return
    const body = text.trim()
    if (!body) return
    setBusy(true)
    void api
      .postTeamNote(selected.teamId, leader.id, 'user', body)
      .then(() => {
        setText('')
        return api.teamNotes(selected.teamId).then(setNotes)
      })
      .catch((error: unknown) => notify(errText(error)))
      .finally(() => setBusy(false))
  }

  const openSession = (sessionId: string) => {
    openAgentSession(sessionId)
    onOpened()
  }

  return (
    <div className="w1-teams">
      <div className="w1-fleetusagehead">
        <span>// TEAMS · 共享黑板 · 本机编排</span>
        <span>
          <button
            type="button"
            className={`w1-capmini${createOpen ? ' pri' : ''}`}
            onClick={() => setCreateOpen((open) => !open)}
          >
            新建团队
          </button>
          <button type="button" className="w1-capmini" onClick={() => reload()}>
            刷新
          </button>
        </span>
      </div>

      {createOpen ? (
        <div className="w1-teamform">
          <input
            value={name}
            placeholder="团队名（可选）"
            onChange={(event) => setName(event.target.value)}
          />
          <input
            value={workers}
            placeholder="worker 标题，用逗号分隔（如：前端,测试）"
            onChange={(event) => setWorkers(event.target.value)}
          />
          <button type="button" className="w1-capmini pri" disabled={busy} onClick={createTeam}>
            {busy ? '创建中…' : '创建'}
          </button>
          <small>
            工作区取当前会话：{workspace ? workspaceName(workspace) : '未选择'}
            ；不会自动发送初始回合。
          </small>
        </div>
      ) : null}

      <div className="w1-teamlist" ref={teamListAnim}>
        {loadError ? <PanelLoadError message={loadError} onRetry={() => reload()} /> : null}
        {teams.map((team, index) => (
          <button
            type="button"
            key={team.teamId}
            className={`w1-teamrow${team.teamId === selectedId ? ' on' : ''}`}
            style={{ '--i': index } as CSSProperties}
            onClick={() => setSelectedId(team.teamId)}
          >
            <b>{team.name}</b>
            <span>{team.sessions.length} 会话</span>
            <small>{workspaceName(team.sessions[0]?.workspace)}</small>
          </button>
        ))}
        {!loadError && teams.length === 0 ? (
          <p className="w1-fleetnone">还没有团队，点「新建团队」创建负责人 + worker。</p>
        ) : null}
      </div>

      {selected ? (
        <div className="w1-teamboard" role="group" aria-label="团队黑板">
          <div className="w1-fleetusagehead">
            <span>// 成员</span>
            <span>{selected.sessions.length} 个会话</span>
          </div>
          <div className="w1-teammembers" ref={membersAnim}>
            {selected.sessions.map((session, index) => (
              <button
                type="button"
                key={session.id}
                className="w1-teammember"
                style={{ '--i': index } as CSSProperties}
                onClick={() => openSession(session.id)}
              >
                <b>{session.title}</b>
                <small>{index === 0 ? '负责人' : 'worker'}</small>
              </button>
            ))}
          </div>
          <div className="w1-fleetusagehead">
            <span>// 黑板</span>
            <span>{notes.length} 条</span>
          </div>
          <div className="w1-teamnotes" ref={notesAnim}>
            {notesError ? (
              <PanelLoadError message={notesError} onRetry={() => setNotesSeq((seq) => seq + 1)} />
            ) : null}
            {notes.map((note, index) => (
              <div className="w1-teamnote" key={note.id} style={{ '--i': index } as CSSProperties}>
                <span className={`w1-teamrole ${note.role}`}>{note.role}</span>
                <p>{note.text}</p>
              </div>
            ))}
            {!notesError && notes.length === 0 ? (
              <p className="w1-fleetnone">黑板还是空的。</p>
            ) : null}
          </div>
          <div className="w1-teampost">
            <input
              value={text}
              placeholder="写一条黑板消息…"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') post()
              }}
            />
            <button
              type="button"
              className="w1-capmini pri"
              disabled={busy || !text.trim()}
              onClick={post}
            >
              发送
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
