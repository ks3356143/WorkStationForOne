import { useEffect, useMemo, useRef, useState } from 'react'
import { m } from 'motion/react'
import type { AgentPresetRecord, AgentRunRecord, DiscoveredAgentSession } from '../../../shared/ipc'
import { AGENT_META, workspaceName } from '../lib/agent'
import { summarizeFleet } from '../lib/fleet'
import { DURATION, EASE_OUT } from '../lib/motion'
import { formatCost, formatDuration, summarizeUsage, usageByDay } from '../lib/usage'
import { useWorkstation } from '../store/useWorkstation'
import type { AgentId, Session } from '../types'
import { ClaudeGlyph, CodexGlyph, PlusIcon } from './Glyphs'

interface FleetSheetProps {
  onClose: () => void
  notify: (text: string) => void
}

type FleetFilter = 'all' | 'run' | 'wait' | 'idle'

const FILTERS: { id: FleetFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'run', label: '运行中' },
  { id: 'wait', label: '待审批' },
  { id: 'idle', label: '空闲' }
]

const STATUS_LABEL = {
  run: '运行中',
  wait: '待审批',
  idle: '空闲'
} as const

const AGENT_GROUPS: { id: AgentId; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' }
]

const pad2 = (value: number) => String(value).padStart(2, '0')

const stamp = (ms: number) => {
  const date = new Date(ms)
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function FleetSheet({ onClose, notify }: FleetSheetProps) {
  const sessions = useWorkstation((state) => state.sessions)
  const activeSessionId = useWorkstation((state) => state.activeSessionId)
  const streams = useWorkstation((state) => state.streams)
  const pendingPrompts = useWorkstation((state) => state.pendingPrompts)
  const toolPermissions = useWorkstation((state) => state.toolPermissions)
  const mcpPermissions = useWorkstation((state) => state.mcpPermissions)
  const permission = useWorkstation((state) => state.permission)
  const openAgentSession = useWorkstation((state) => state.openAgentSession)
  const createAgentSession = useWorkstation((state) => state.createAgentSession)
  const setAgentWorkspace = useWorkstation((state) => state.setAgentWorkspace)
  const importAgentSession = useWorkstation((state) => state.importAgentSession)
  const boxRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [filter, setFilter] = useState<FleetFilter>('all')
  const [stopping, setStopping] = useState<string | null>(null)
  const [presets, setPresets] = useState<AgentPresetRecord[]>([])
  const [presetBusy, setPresetBusy] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [usage, setUsage] = useState<AgentRunRecord[] | null>(null)
  const [usageBusy, setUsageBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [discovered, setDiscovered] = useState<DiscoveredAgentSession[]>([])
  const [discoverBusy, setDiscoverBusy] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)
  const summary = useMemo(() => summarizeFleet(sessions), [sessions])
  const usageSummary = useMemo(() => summarizeUsage(usage ?? []), [usage])
  const usageDays = useMemo(() => usageByDay(usage ?? [], 7), [usage])
  const usageMax = Math.max(1, ...usageDays.map((day) => day.runs))
  const api = typeof window === 'undefined' ? undefined : window.ws?.agent

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    root?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    if (!api) return
    let alive = true
    void api
      .presets()
      .then((list) => {
        if (alive) setPresets(list)
      })
      .catch(() => {
        if (alive) setPresets([])
      })
    return () => {
      alive = false
    }
  }, [api])

  const pendingFor = (session: Session) =>
    (toolPermissions[session.id] ? 1 : 0) +
    (mcpPermissions[session.id] ? 1 : 0) +
    (permission?.sessionId === session.id ? 1 : 0)

  const filtered = sessions.filter((session) => filter === 'all' || session.status === filter)
  const counts: Record<FleetFilter, number> = {
    all: sessions.length,
    run: sessions.filter((session) => session.status === 'run').length,
    wait: sessions.filter((session) => session.status === 'wait').length,
    idle: sessions.filter((session) => session.status === 'idle').length
  }

  const open = (session: Session) => {
    openAgentSession(session.id)
    onClose()
  }

  const stop = (session: Session) => {
    const runId = streams[session.id]?.runId
    if (!runId) {
      notify('这一轮还没有启动，稍后再试')
      return
    }
    setStopping(session.id)
    void window.ws?.agent
      ?.cancel(runId)
      .then(() => notify(`已请求停止 ${session.title}`))
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '停止失败'))
      .finally(() => setStopping(null))
  }

  const launch = (agent: AgentId) => {
    createAgentSession(agent)
    onClose()
  }

  const savePreset = () => {
    if (!api || presetBusy) return
    const active = sessions.find((session) => session.id === activeSessionId)
    if (!active?.workspace) {
      notify('先给当前会话选择一个工作区')
      return
    }
    setPresetBusy(true)
    void api
      .savePreset({
        name: active.title,
        agent: active.agent,
        workspace: active.workspace
      })
      .then((saved) => {
        setPresets((list) => [saved, ...list])
        notify(`已保存预设：${saved.name}`)
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '保存预设失败'))
      .finally(() => setPresetBusy(false))
  }

  const startPreset = (preset: AgentPresetRecord) => {
    createAgentSession(preset.agent)
    const id = useWorkstation.getState().activeSessionId
    if (id) setAgentWorkspace(id, preset.workspace)
    onClose()
  }

  const removePreset = (preset: AgentPresetRecord) => {
    if (!api || presetBusy) return
    setPresetBusy(true)
    void api
      .removePreset(preset.id)
      .then(() => {
        setPresets((list) => list.filter((item) => item.id !== preset.id))
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '删除预设失败'))
      .finally(() => setPresetBusy(false))
  }

  const toggleUsage = () => {
    if (!api) return
    if (usageOpen) {
      setUsageOpen(false)
      return
    }
    setUsageOpen(true)
    setUsageBusy(true)
    void api
      .usage(7)
      .then(setUsage)
      .catch((error: unknown) => {
        setUsageOpen(false)
        notify(error instanceof Error ? error.message : '用量读取失败')
      })
      .finally(() => setUsageBusy(false))
  }

  const loadDiscovered = () => {
    if (!api || discoverBusy) return
    setDiscoverBusy(true)
    setDiscoverError(null)
    void api
      .discoverSessions()
      .then(setDiscovered)
      .catch((error: unknown) =>
        setDiscoverError(error instanceof Error ? error.message : '本机会话扫描失败')
      )
      .finally(() => setDiscoverBusy(false))
  }

  const toggleImport = () => {
    if (importOpen) {
      setImportOpen(false)
      return
    }
    setImportOpen(true)
    if (discovered.length === 0) loadDiscovered()
  }

  const importOne = (session: DiscoveredAgentSession) => {
    if (!api || importingId) return
    const backfill = session.imported
    setImportingId(`${session.agent}:${session.resumeId}`)
    void api
      .importSession({
        agent: session.agent,
        resumeId: session.resumeId,
        title: session.title,
        workspace: session.workspace
      })
      .then((result) => {
        importAgentSession(result)
        setDiscovered((list) =>
          list.map((item) =>
            item.agent === session.agent && item.resumeId === session.resumeId
              ? { ...item, imported: true }
              : item
          )
        )
        notify(`${backfill ? '已补历史' : '已导入'}：${result.session.title}`)
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '导入会话失败'))
      .finally(() => setImportingId(null))
  }

  return (
    <m.div
      className="w1-modalbackdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.modalBackdrop }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <m.div
        ref={boxRef}
        className="w1-fleetsheet"
        role="dialog"
        aria-modal="true"
        aria-label="舰队控制台"
        tabIndex={-1}
        initial={{ opacity: 0, transform: 'translateY(12px) scale(0.99)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
      >
        <header className="w1-fleethead">
          <div>
            <span className="w1-eyebrow">// FLEET CONSOLE</span>
            <b>舰队控制台</b>
          </div>
          <div className="w1-fleetheadmeta">
            <span>
              {summary.total} 会话 · {summary.running} 运行 · {summary.waiting} 待审批
            </span>
            <button
              type="button"
              className={`w1-capmini${importOpen ? ' pri' : ''}`}
              onClick={toggleImport}
            >
              导入本机
            </button>
            <button type="button" className="w1-capmini" disabled={presetBusy} onClick={savePreset}>
              存预设
            </button>
            <button
              type="button"
              className={`w1-capmini${usageOpen ? ' pri' : ''}`}
              onClick={toggleUsage}
            >
              {usageBusy ? '读取中…' : '用量'}
            </button>
            <button type="button" className="w1-fleetclose" onClick={onClose}>
              <kbd>Esc</kbd> 关闭
            </button>
          </div>
        </header>

        <div className="w1-fleetfilters" role="tablist" aria-label="会话筛选">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={filter === item.id ? 'on' : ''}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <b>{counts[item.id]}</b>
            </button>
          ))}
          <span className="w1-fleetspacer" />
          <button type="button" className="w1-fleetnew" onClick={() => launch('claude')}>
            <PlusIcon width={9} height={9} />
            Claude
          </button>
          <button type="button" className="w1-fleetnew" onClick={() => launch('codex')}>
            <PlusIcon width={9} height={9} />
            Codex
          </button>
        </div>

        {importOpen ? (
          <div className="w1-fleetimport">
            <div className="w1-fleetusagehead">
              <span>// 本机会话 · 只读扫描</span>
              <span>导入前关闭外部窗口 · 不复制历史，只续接 CLI 会话</span>
            </div>
            <div className="w1-fleetimportops">
              <span>
                {discoverBusy && discovered.length === 0
                  ? '扫描中…'
                  : `扫描到 ${discovered.length} 个`}
              </span>
              <button
                type="button"
                className="w1-capmini"
                disabled={discoverBusy}
                onClick={loadDiscovered}
              >
                {discoverBusy ? '扫描中…' : '重新扫描'}
              </button>
            </div>
            {discoverError ? <p className="w1-fleetimporterror">{discoverError}</p> : null}
            <div className="w1-fleetimportlist">
              {discovered.length === 0 ? (
                <p className="w1-fleetnone">
                  {discoverBusy ? '正在扫描 ~/.claude 与 ~/.codex…' : '没有找到可导入的会话。'}
                </p>
              ) : (
                AGENT_GROUPS.map((group) => {
                  const list = discovered.filter((session) => session.agent === group.id)
                  if (list.length === 0) return null
                  return (
                    <section
                      className="w1-fleetimportgroup"
                      key={group.id}
                      aria-label={`本机 ${group.label} 会话`}
                    >
                      <div className="w1-fleetgrouph">
                        <span className="w1-fleetglyph">
                          {group.id === 'claude' ? (
                            <ClaudeGlyph width={12} height={12} />
                          ) : (
                            <CodexGlyph width={12} height={12} />
                          )}
                        </span>
                        <b>{group.label}</b>
                        <span>{list.length}</span>
                      </div>
                      {list.map((session) => {
                        const key = `${session.agent}:${session.resumeId}`
                        const busy = importingId === key
                        return (
                          <div
                            className={`w1-fleetimportrow${session.imported ? ' on' : ''}`}
                            key={key}
                            data-discovered-id={key}
                          >
                            <div className="w1-fleetimportmain">
                              <b>{session.title}</b>
                              <span title={session.workspace}>{session.workspace}</span>
                              <small>
                                {session.workspaceExists ? '' : '工作区目录不存在 · '}
                                更新于 {stamp(session.updatedAt)}
                              </small>
                            </div>
                            <button
                              type="button"
                              className="w1-fleetimportbtn"
                              disabled={!session.workspaceExists || importingId !== null}
                              onClick={() => importOne(session)}
                            >
                              {busy
                                ? session.imported
                                  ? '补历史中…'
                                  : '导入中…'
                                : session.imported
                                  ? '补历史'
                                  : '导入'}
                            </button>
                          </div>
                        )
                      })}
                    </section>
                  )
                })
              )}
            </div>
          </div>
        ) : null}

        {usageOpen ? (
          <div className="w1-fleetusage">
            <div className="w1-fleetusagehead">
              <span>// 近 7 天用量</span>
              <span>只统计应用内运行</span>
            </div>
            {usageBusy && !usage ? (
              <p className="w1-capnote">正在读取用量…</p>
            ) : (
              <>
                <div className="w1-fleetusagesum">
                  <span>
                    <b>{usageSummary.runs}</b> 轮
                  </span>
                  <span>
                    <b>{usageSummary.completed}</b> 成功
                  </span>
                  <span>
                    <b>{usageSummary.failures}</b> 失败
                  </span>
                  <span>
                    <b>{formatCost(usageSummary.costUsd)}</b> 成本
                  </span>
                  <span>
                    <b>{formatDuration(usageSummary.durationMs)}</b> 时长
                  </span>
                  <span>
                    <b>{usageSummary.turns}</b> 轮次
                  </span>
                </div>
                <div className="w1-fleetbars" role="group" aria-label="近 7 天运行次数">
                  {usageDays.map((day) => (
                    <span className="w1-fleetbar" key={day.key}>
                      <i style={{ height: `${Math.max(3, (day.runs / usageMax) * 100)}%` }} />
                      <b>{day.runs}</b>
                      <small>{day.key.slice(5)}</small>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}

        <div className="w1-fleetbody">
          {sessions.length === 0 ? (
            <div className="w1-fleetempty">
              <b>还没有会话。</b>
              <p>新建 Claude 或 Codex 会话后，所有应用内会话都会出现在这里。</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="w1-fleetempty">
              <b>当前筛选没有会话。</b>
              <p>切回「全部」查看 {sessions.length} 个会话。</p>
            </div>
          ) : (
            AGENT_GROUPS.map((group) => {
              const list = filtered.filter((session) => session.agent === group.id)
              if (list.length === 0 && filter !== 'all') return null
              const glyph =
                group.id === 'claude' ? (
                  <ClaudeGlyph width={13} height={13} />
                ) : (
                  <CodexGlyph width={13} height={13} />
                )
              return (
                <section className="w1-fleetgroup" key={group.id} aria-label={group.label}>
                  <div className="w1-fleetgrouph">
                    <span className="w1-fleetglyph">{glyph}</span>
                    <b>{group.label}</b>
                    <span>{list.length}</span>
                  </div>
                  {list.length === 0 ? (
                    <p className="w1-fleetnone">暂无{group.label}会话</p>
                  ) : (
                    list.map((session) => {
                      const pending = pendingFor(session)
                      const runId = streams[session.id]?.runId
                      const queued = pendingPrompts.some(
                        (prompt) => prompt.sessionId === session.id
                      )
                      const active = session.id === activeSessionId
                      return (
                        <div
                          className={`w1-fleetrow${active ? ' on' : ''}`}
                          key={session.id}
                          data-session-id={session.id}
                        >
                          <span className={`w1-fleetstate ${session.status}`}>
                            <i aria-hidden="true" />
                            {STATUS_LABEL[session.status]}
                          </span>
                          <button
                            className="w1-fleetmain"
                            type="button"
                            onClick={() => open(session)}
                          >
                            <span className="w1-fleettitle">
                              {session.title}
                              {active ? <i className="w1-fleetactive">当前</i> : null}
                            </span>
                            <span className="w1-fleetmeta">
                              {workspaceName(session.workspace)} · {session.meta}
                              {queued ? ' · 排队中' : ''}
                            </span>
                          </button>
                          {pending > 0 ? (
                            <span className="w1-fleetpending">{pending} 项待审批</span>
                          ) : null}
                          <span className="w1-fleetactions">
                            <button
                              type="button"
                              className="w1-fleetopen"
                              onClick={() => open(session)}
                            >
                              打开
                            </button>
                            {runId || session.status === 'run' ? (
                              <button
                                type="button"
                                className="w1-fleetstop"
                                disabled={!runId || stopping === session.id}
                                onClick={() => stop(session)}
                              >
                                {stopping === session.id ? '停止中…' : '停止'}
                              </button>
                            ) : null}
                          </span>
                        </div>
                      )
                    })
                  )}
                </section>
              )
            })
          )}

          {presets.length > 0 ? (
            <section className="w1-fleetgroup w1-fleetpresets" aria-label="会话预设">
              <div className="w1-fleetgrouph">
                <span className="w1-fleetglyph">▸</span>
                <b>预设</b>
                <span>{presets.length}</span>
                <small>点击用相同工作区新建会话</small>
              </div>
              <div className="w1-fleetpresetgrid">
                {presets.map((preset) => (
                  <div className="w1-fleetpreset" key={preset.id}>
                    <button
                      type="button"
                      className="w1-fleetpresetmain"
                      onClick={() => startPreset(preset)}
                    >
                      <b>{preset.name}</b>
                      <span>
                        {preset.agent === 'claude' ? 'Claude' : 'Codex'} ·{' '}
                        {workspaceName(preset.workspace)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="w1-fleetpresetdel"
                      aria-label={`删除预设 ${preset.name}`}
                      disabled={presetBusy}
                      onClick={() => removePreset(preset)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="w1-fleetfoot">
          <span>所有会话共用同一套审批与工作区；后台会话不会抢焦点。</span>
          <span>
            {AGENT_META.claude.shortName} / {AGENT_META.codex.shortName} 双目标
          </span>
        </footer>
      </m.div>
    </m.div>
  )
}
