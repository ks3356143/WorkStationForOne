import { useEffect, useState } from 'react'
import type {
  AgentKind,
  ExpertMarketEntry,
  ExpertRecord,
  ExpertSaveInput,
  ExpertSourceRecord,
  ExternalMcpServerRecord,
  SkillRecord
} from '../../../../shared/ipc'
import { useWorkstation } from '../../store/useWorkstation'
import { ClaudeGlyph, CodexGlyph } from '../Glyphs'

interface ExpertsPanelProps {
  notify: (text: string) => void
  onLaunched: () => void
}

const errText = (error: unknown): string => (error instanceof Error ? error.message : '操作失败')

const toolLabel = (key: string): string =>
  key.startsWith('mcp:')
    ? `MCP ${key.slice(4)}`
    : key.startsWith('skill:')
      ? `技能 ${key.slice(6)}`
      : key

interface ExpertFormProps {
  initial?: ExpertRecord
  mcp: ExternalMcpServerRecord[]
  skills: SkillRecord[]
  busy: boolean
  onCancel: () => void
  onSave: (input: ExpertSaveInput) => void
}

function ExpertForm({ initial, mcp, skills, busy, onCancel, onSave }: ExpertFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [persona, setPersona] = useState(initial?.persona ?? '')
  const [tools, setTools] = useState<string[]>(initial?.tools ?? [])
  const toggle = (key: string) =>
    setTools((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]))
  return (
    <form
      className="w1-expform"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({ ...(initial ? { id: initial.id } : {}), name, description, persona, tools })
      }}
    >
      <div className="w1-expformhead">
        <b>{initial ? `编辑专家 · ${initial.name}` : '新建专家'}</b>
        <button type="button" className="w1-capmini" onClick={onCancel}>
          取消
        </button>
      </div>
      <label className="w1-expfield">
        <span>名称</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="w1-expfield">
        <span>描述</span>
        <input
          value={description}
          maxLength={240}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="一句话说明擅长什么"
        />
      </label>
      <label className="w1-expfield">
        <span>人设（系统提示）</span>
        <textarea
          value={persona}
          rows={6}
          maxLength={20000}
          onChange={(e) => setPersona(e.target.value)}
          required
          placeholder="你是……专家，回答与改动遵循……"
        />
      </label>
      <div className="w1-expfield">
        <span>默认工具组合（激活时启用并设★）</span>
        <div className="w1-exptools">
          {mcp.map((server) => (
            <label key={`mcp:${server.id}`} className="w1-exptool">
              <input
                type="checkbox"
                checked={tools.includes(`mcp:${server.id}`)}
                onChange={() => toggle(`mcp:${server.id}`)}
              />
              <span>MCP {server.name}</span>
            </label>
          ))}
          {[...new Map(skills.map((skill) => [skill.id, skill])).values()].map((skill) => (
            <label key={`skill:${skill.id}`} className="w1-exptool">
              <input
                type="checkbox"
                checked={tools.includes(`skill:${skill.id}`)}
                onChange={() => toggle(`skill:${skill.id}`)}
              />
              <span>技能 {skill.name}</span>
            </label>
          ))}
          {mcp.length === 0 && skills.length === 0 ? (
            <p className="w1-capnote">还没有已安装的 MCP / 技能，可先在能力中心安装。</p>
          ) : null}
        </div>
      </div>
      <div className="w1-expformops">
        <button type="submit" className="w1-capmini pri" disabled={busy}>
          {busy ? '保存中…' : '保存专家'}
        </button>
      </div>
    </form>
  )
}

export function ExpertsPanel({ notify, onLaunched }: ExpertsPanelProps) {
  const createAgentSession = useWorkstation((state) => state.createAgentSession)
  const api = typeof window === 'undefined' ? undefined : window.ws?.experts
  const capApi = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [experts, setExperts] = useState<ExpertRecord[] | null>(null)
  const [form, setForm] = useState<null | { id?: string }>(null)
  const [mcp, setMcp] = useState<ExternalMcpServerRecord[]>([])
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [armDelete, setArmDelete] = useState<string | null>(null)
  const [marketOpen, setMarketOpen] = useState(false)
  const [sources, setSources] = useState<ExpertSourceRecord[]>([])
  const [entries, setEntries] = useState<ExpertMarketEntry[]>([])
  const [marketBusy, setMarketBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [srcForm, setSrcForm] = useState({ name: '', url: '', ref: '' })
  const [importingKey, setImportingKey] = useState<string | null>(null)

  const reload = () => {
    if (!api) return
    void api
      .list()
      .then(setExperts)
      .catch(() => setExperts([]))
  }
  useEffect(reload, [api])

  // 删除两段确认 4 秒后自动撤销，避免一次误触在很久之后生效。
  useEffect(() => {
    if (!armDelete) return
    const timer = window.setTimeout(() => setArmDelete(null), 4000)
    return () => window.clearTimeout(timer)
  }, [armDelete])

  useEffect(() => {
    if (!form || !capApi) return
    void capApi.mcp
      .list()
      .then(setMcp)
      .catch(() => setMcp([]))
    void capApi.skills
      .list()
      .then(setSkills)
      .catch(() => setSkills([]))
  }, [form, capApi])

  const reloadMarket = () => {
    if (!api) return
    setMarketBusy(true)
    void Promise.all([api.market.sources(), api.market.list()])
      .then(([nextSources, nextEntries]) => {
        setSources(nextSources)
        setEntries(nextEntries)
      })
      .catch(() => undefined)
      .finally(() => setMarketBusy(false))
  }

  const toggleMarket = () => {
    if (marketOpen) {
      setMarketOpen(false)
      return
    }
    setMarketOpen(true)
    reloadMarket()
  }

  const launch = (expert: ExpertRecord, agent: AgentKind) => {
    if (!api || busy) return
    setBusy(true)
    void api
      .activate(agent, expert.id)
      .then((result) => {
        createAgentSession(agent, expert.persona)
        const missing =
          result.missing.length > 0
            ? ` · 缺失/未信任 ${result.missing.length} 项（${result.missing.join('、')}）`
            : ''
        notify(`已启用 ${result.applied.length} 项${missing}`)
        onLaunched()
      })
      .catch((error: unknown) => notify(errText(error)))
      .finally(() => setBusy(false))
  }

  const save = (input: ExpertSaveInput) => {
    if (!api || busy) return
    setBusy(true)
    void api
      .save(input)
      .then((saved) => {
        setForm(null)
        reload()
        notify(`已保存专家：${saved.name}`)
      })
      .catch((error: unknown) => notify(errText(error)))
      .finally(() => setBusy(false))
  }

  const remove = (expert: ExpertRecord) => {
    if (!api) return
    if (armDelete !== expert.id) {
      setArmDelete(expert.id)
      return
    }
    setArmDelete(null)
    void api
      .remove(expert.id)
      .then((ok) => {
        reload()
        notify(ok ? `已删除专家：${expert.name}` : '内置专家不可删除')
      })
      .catch((error: unknown) => notify(errText(error)))
  }

  const exportOne = (expert: ExpertRecord) => {
    if (!api) return
    void api
      .export(expert.id)
      .then((result) => notify(result.canceled ? '已取消导出' : `已导出：${result.path}`))
      .catch((error: unknown) => notify(errText(error)))
  }

  const addSource = () => {
    if (!api || marketBusy) return
    setMarketBusy(true)
    void api.market
      .addSource({ name: srcForm.name, url: srcForm.url, ref: srcForm.ref || undefined })
      .then(() => {
        setSrcForm({ name: '', url: '', ref: '' })
        reloadMarket()
        notify('已添加专家源')
      })
      .catch((error: unknown) => notify(errText(error)))
      .finally(() => setMarketBusy(false))
  }

  const importEntry = (entry: ExpertMarketEntry) => {
    if (!api || importingKey) return
    const key = `${entry.sourceId}:${entry.relPath}`
    setImportingKey(key)
    void api.market
      .import(entry.sourceId, entry.relPath)
      .then((saved) => {
        reload()
        notify(`已导入专家：${saved.name}`)
      })
      .catch((error: unknown) => notify(errText(error)))
      .finally(() => setImportingKey(null))
  }

  const filteredEntries = entries.filter((entry) => {
    if (sourceFilter && entry.sourceId !== sourceFilter) return false
    if (!query.trim()) return true
    const needle = query.trim().toLowerCase()
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle) ||
      entry.id.toLowerCase().includes(needle)
    )
  })

  const editing = form?.id ? experts?.find((item) => item.id === form.id) : undefined

  return (
    <div className="w1-experts">
      <div className="w1-fleetusagehead">
        <span>// EXPERTS · 人设 + 工具组合 + ★优先</span>
        <span>
          <button type="button" className="w1-capmini" onClick={() => setForm({})}>
            新建专家
          </button>
          <button
            type="button"
            className={`w1-capmini${marketOpen ? ' pri' : ''}`}
            onClick={toggleMarket}
          >
            市场
          </button>
        </span>
      </div>

      {form ? (
        <ExpertForm
          key={form.id ?? 'new'}
          initial={editing}
          mcp={mcp}
          skills={skills}
          busy={busy}
          onCancel={() => setForm(null)}
          onSave={save}
        />
      ) : null}

      <div className="w1-explist">
        {(experts ?? []).map((expert) => (
          <div className="w1-exprow" key={expert.id} data-expert-id={expert.id}>
            <div className="w1-expmain">
              <b>
                {expert.name}
                {expert.builtin ? <i className="w1-expbuiltin">内置</i> : null}
              </b>
              <span>{expert.description}</span>
              <small>
                {expert.tools.length > 0 ? expert.tools.map(toolLabel).join(' · ') : '无默认工具'}
              </small>
            </div>
            <span className="w1-expops">
              <button
                type="button"
                className="w1-fleetopen"
                disabled={busy}
                onClick={() => launch(expert, 'claude')}
              >
                <ClaudeGlyph width={10} height={10} /> Claude
              </button>
              <button
                type="button"
                className="w1-fleetopen"
                disabled={busy}
                onClick={() => launch(expert, 'codex')}
              >
                <CodexGlyph width={10} height={10} /> Codex
              </button>
              {!expert.builtin ? (
                <>
                  <button
                    type="button"
                    className="w1-fleetopen"
                    onClick={() => setForm({ id: expert.id })}
                  >
                    编辑
                  </button>
                  <button type="button" className="w1-fleetopen" onClick={() => exportOne(expert)}>
                    导出
                  </button>
                  <button type="button" className="w1-fleetarchive" onClick={() => remove(expert)}>
                    {armDelete === expert.id ? '确认删除' : '删除'}
                  </button>
                </>
              ) : null}
            </span>
          </div>
        ))}
        {experts && experts.length === 0 ? (
          <p className="w1-fleetnone">还没有专家，点「新建专家」或从市场导入。</p>
        ) : null}
      </div>

      {marketOpen ? (
        <div className="w1-expmarket">
          <div className="w1-fleetusagehead">
            <span>// 专家市场 · Git 源里的子代理 Markdown</span>
            <span>{marketBusy ? '读取中…' : `${entries.length} 个条目`}</span>
          </div>
          <div className="w1-expsrcform">
            <input
              placeholder="源名称"
              value={srcForm.name}
              maxLength={60}
              onChange={(e) => setSrcForm((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              placeholder="owner/repo 或 HTTPS / 本地绝对路径"
              value={srcForm.url}
              onChange={(e) => setSrcForm((f) => ({ ...f, url: e.target.value }))}
            />
            <input
              placeholder="分支（可选）"
              value={srcForm.ref}
              onChange={(e) => setSrcForm((f) => ({ ...f, ref: e.target.value }))}
            />
            <button
              type="button"
              className="w1-capmini pri"
              disabled={marketBusy || !srcForm.name.trim() || !srcForm.url.trim()}
              onClick={addSource}
            >
              添加源
            </button>
          </div>
          <div className="w1-expsrclist">
            {sources.map((source) => (
              <div className="w1-expsrcrow" key={source.id}>
                <div className="w1-expmain">
                  <b>{source.name}</b>
                  <span title={source.url}>{source.url}</span>
                  {source.lastError ? (
                    <small className="w1-experr">{source.lastError}</small>
                  ) : null}
                </div>
                <span className="w1-expops">
                  <button
                    type="button"
                    className="w1-fleetopen"
                    disabled={marketBusy}
                    onClick={() => {
                      if (!api) return
                      setMarketBusy(true)
                      void api.market
                        .refresh(source.id)
                        .then(reloadMarket)
                        .catch((error: unknown) => notify(errText(error)))
                        .finally(() => setMarketBusy(false))
                    }}
                  >
                    刷新
                  </button>
                  <button
                    type="button"
                    className="w1-fleetarchive"
                    disabled={marketBusy}
                    onClick={() => {
                      if (!api) return
                      void api.market
                        .removeSource(source.id)
                        .then(reloadMarket)
                        .catch((error: unknown) => notify(errText(error)))
                    }}
                  >
                    移除
                  </button>
                </span>
              </div>
            ))}
            {sources.length === 0 ? (
              <p className="w1-fleetnone">还没有市场源，添加一个 Git 仓库或本地目录。</p>
            ) : null}
          </div>
          <div className="w1-expmarketfilters">
            <input
              placeholder="搜索专家…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="">全部源</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w1-expentrylist">
            {filteredEntries.map((entry) => {
              const key = `${entry.sourceId}:${entry.relPath}`
              return (
                <div className="w1-exprow" key={key}>
                  <div className="w1-expmain">
                    <b>{entry.name}</b>
                    <span>{entry.description}</span>
                    <small>
                      {entry.sourceName} · {entry.relPath}
                    </small>
                  </div>
                  <span className="w1-expops">
                    <button
                      type="button"
                      className="w1-fleetopen"
                      disabled={importingKey !== null}
                      onClick={() => importEntry(entry)}
                    >
                      {importingKey === key ? '导入中…' : '导入'}
                    </button>
                  </span>
                </div>
              )
            })}
            {filteredEntries.length === 0 ? (
              <p className="w1-fleetnone">没有匹配的专家条目。</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
