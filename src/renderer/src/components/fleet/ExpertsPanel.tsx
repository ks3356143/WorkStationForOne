import { useEffect, useState, type CSSProperties } from 'react'
import type {
  AgentKind,
  ExpertRecord,
  ExpertSaveInput,
  ExternalMcpServerRecord,
  SkillRecord
} from '../../../../shared/ipc'
import { useWorkstation } from '../../store/useWorkstation'
import { useListAnimate } from '../../lib/use-list-animate'
import { ClaudeGlyph, CodexGlyph } from '../Glyphs'
import { PanelLoadError } from '../PanelLoadError'
import { ExpertForm } from './ExpertForm'
import { ExpertMarketView } from './ExpertMarketView'
import { useExpertMarket } from './useExpertMarket'

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

export function ExpertsPanel({ notify, onLaunched }: ExpertsPanelProps) {
  const createAgentSession = useWorkstation((state) => state.createAgentSession)
  const api = typeof window === 'undefined' ? undefined : window.ws?.experts
  const capApi = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [experts, setExperts] = useState<ExpertRecord[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<null | { id?: string }>(null)
  const [mcp, setMcp] = useState<ExternalMcpServerRecord[]>([])
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [armDelete, setArmDelete] = useState<string | null>(null)
  const [marketOpen, setMarketOpen] = useState(false)

  const reload = () => {
    if (!api) return
    void api
      .list()
      .then((list) => {
        setExperts(list)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        setExperts([])
        setLoadError(errText(error))
      })
  }
  useEffect(reload, [api])

  const market = useExpertMarket(api, notify, reload)

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

  const toggleMarket = () => {
    if (marketOpen) {
      setMarketOpen(false)
      return
    }
    setMarketOpen(true)
    market.reloadMarket()
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

  const editing = form?.id ? experts?.find((item) => item.id === form.id) : undefined
  const listAnim = useListAnimate<HTMLDivElement>()

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

      <div className="w1-explist" ref={listAnim}>
        {loadError ? <PanelLoadError message={loadError} onRetry={reload} /> : null}
        {(experts ?? []).map((expert, index) => (
          <div
            className="w1-exprow"
            key={expert.id}
            data-expert-id={expert.id}
            style={{ '--i': index } as CSSProperties}
          >
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
        {experts && experts.length === 0 && !loadError ? (
          <p className="w1-fleetnone">还没有专家，点「新建专家」或从市场导入。</p>
        ) : null}
      </div>

      {marketOpen ? <ExpertMarketView market={market} /> : null}
    </div>
  )
}
