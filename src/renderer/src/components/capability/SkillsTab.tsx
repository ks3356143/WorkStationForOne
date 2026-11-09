import { Fragment, useState } from 'react'
import type {
  AgentKind,
  SkillInspection,
  SkillRecord,
  ToolSurfaceRecord
} from '../../../../shared/ipc'
import { friendlyMessage } from '../../lib/errors'
import { BeamLayer } from '../effects/BeamLayer'
import { ToolNoteInput } from './ToolNoteInput'

interface SkillsTabProps {
  agent: AgentKind
  skills: SkillRecord[]
  surface: ToolSurfaceRecord | null
  busy: string | null
  notify: (text: string) => void
  onAgent: (agent: AgentKind) => void
  onToggle: (skill: SkillRecord, enable: boolean, trust: boolean) => void
  onPreferred: (key: string, preferred: boolean) => void
  onNote: (key: string, note: string) => void
  onMove: (key: string, direction: 'up' | 'down') => void
}

const AGENT_LABELS: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }
const COMPONENT_LABELS: Record<string, string> = {
  skills: '技能',
  commands: '命令',
  agents: '子代理',
  hooks: 'hooks',
  mcp: 'MCP'
}

/**
 * 技能页：按 Agent 管理插件的启用 / 信任与首选优先级。
 * 启用开关只有这一个入口；插件页只管安装更新卸载。
 */
export function SkillsTab({
  agent,
  skills,
  surface,
  busy,
  notify,
  onAgent,
  onToggle,
  onPreferred,
  onNote,
  onMove
}: SkillsTabProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [confirmKey, setConfirmKey] = useState('')
  const [detailId, setDetailId] = useState('')
  const [inspection, setInspection] = useState<SkillInspection | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  const toggle = (record: SkillRecord | undefined, id: string, enable: boolean) => {
    if (!record) return
    const risky =
      enable && record.agent === 'claude' && (record.hasHooks || record.hasMcp) && !record.trusted
    if (risky && confirmKey !== `trust:${id}`) {
      setConfirmKey(`trust:${id}`)
      notify(`再次点击确认信任 ${record.name} 的 hooks / MCP 组件`)
      return
    }
    setConfirmKey('')
    onToggle(record, enable, risky)
  }

  const toggleDetail = (record: SkillRecord) => {
    if (!api || detailBusy) return
    if (detailId === record.id) {
      setDetailId('')
      setInspection(null)
      return
    }
    setDetailId(record.id)
    setInspection(null)
    setDetailBusy(true)
    void api.skills
      .inspect(record.id)
      .then(setInspection)
      .catch((reason: unknown) => {
        setDetailId('')
        notify(friendlyMessage(reason, '读取技能文件失败'))
      })
      .finally(() => setDetailBusy(false))
  }

  const openFolder = (record: SkillRecord) => {
    if (!api) return
    void api.skills
      .openFolder(record.id)
      .catch((reason: unknown) => notify(friendlyMessage(reason, '打开目录失败')))
  }

  const items = surface?.skills ?? []

  return (
    <section className="w1-capsection" aria-label="技能">
      <div className="w1-caphead">
        <span className="w1-capkicker">// SKILLS</span>
        <span className="w1-capnote">
          插件里的技能 / 命令 / 子代理按 Agent 加载；★ 首选优先于 CLI 原生工具
        </span>
        <div className="w1-capactions">
          <div className="w1-capseg" role="group" aria-label="切换 Agent">
            {(['claude', 'codex'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={agent === value ? 'on' : ''}
                aria-pressed={agent === value}
                onClick={() => onAgent(value)}
              >
                {AGENT_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!surface ? (
        <p className="w1-capnote">正在读取技能…</p>
      ) : items.length === 0 ? (
        <div className="w1-capemptycard">
          <b>{AGENT_LABELS[agent]} 还没有应用私有技能。</b>
          <p>在「插件」页从市场安装或本地导入后，来这里启用并设 ★ 首选。</p>
        </div>
      ) : (
        <div className="w1-caplist">
          {items.map((item, index) => {
            const record = skills.find((entry) => `skill:${entry.id}` === item.id)
            const id = item.id.slice('skill:'.length)
            const isClaude = record?.agent !== 'codex'
            return (
              <Fragment key={item.id}>
                <div className={`w1-caprow with-toggle${item.enabled ? '' : ' off'}`}>
                  {item.preferred ? <BeamLayer /> : null}
                  <span className="w1-capglyph">SK</span>
                  <span className="w1-capcopy">
                    <b>
                      {item.name}
                      {item.preferred ? <i className="w1-capprefer">首选</i> : null}
                      {record?.version ? <i className="w1-capver">{record.version}</i> : null}
                    </b>
                    <p>
                      {record?.description || (item.enabled ? '已启用' : '未启用或未信任')}
                      {record && record.components.length > 0
                        ? ` · ${record.components.map((c) => COMPONENT_LABELS[c] ?? c).join(' / ')}`
                        : ''}
                    </p>
                    {record && (record.hasHooks || record.hasMcp) ? (
                      <span className="w1-captags">
                        <i className="warn">含执行组件 · 需信任</i>
                      </span>
                    ) : null}
                  </span>
                  <span className="w1-capactions">
                    <button
                      type="button"
                      className={`w1-capprefbtn${item.preferred ? ' on' : ''}${item.enabled ? '' : ' muted'}`}
                      disabled={busy === `prefer:${item.id}`}
                      aria-disabled={!item.enabled}
                      aria-pressed={item.preferred}
                      aria-label={`${item.name} ${item.preferred ? '取消首选' : '设为首选'}`}
                      title={
                        item.enabled
                          ? '首选：能做同一件事时先调用它，不改用 CLI 原生工具'
                          : '先启用并信任这个技能才能设为首选'
                      }
                      onClick={() => onPreferred(item.id, !item.preferred)}
                    >
                      {item.preferred ? '★' : '☆'}
                    </button>
                    <button
                      type="button"
                      className="w1-capmini"
                      disabled={index === 0 || busy === `move:${item.id}`}
                      aria-label={`${item.name} 上移`}
                      title={
                        index > 0 && item.preferred !== items[index - 1]?.preferred
                          ? '首选分组固定置顶；先取消 ★ 再和其它项换位'
                          : undefined
                      }
                      onClick={() => onMove(item.id, 'up')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="w1-capmini"
                      disabled={index === items.length - 1 || busy === `move:${item.id}`}
                      aria-label={`${item.name} 下移`}
                      title={
                        index < items.length - 1 && item.preferred !== items[index + 1]?.preferred
                          ? '首选分组固定置顶；先取消 ★ 再和其它项换位'
                          : undefined
                      }
                      onClick={() => onMove(item.id, 'down')}
                    >
                      ↓
                    </button>
                    {isClaude && record ? (
                      <button
                        type="button"
                        className="w1-capmini"
                        disabled={detailBusy}
                        onClick={() => toggleDetail(record)}
                      >
                        {detailId === record.id ? '收起' : '详情'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`w1-setbtn${item.enabled ? ' on' : ''}`}
                      disabled={!record || busy === `skill:${id}`}
                      onClick={() => toggle(record, id, !item.enabled)}
                    >
                      {item.enabled
                        ? '已启用'
                        : confirmKey === `trust:${id}`
                          ? '确认信任并启用'
                          : '启用'}
                    </button>
                  </span>
                  {item.preferred && item.enabled ? (
                    <ToolNoteInput
                      value={item.note}
                      disabled={busy === `note:${item.id}`}
                      onSave={(note) => onNote(item.id, note)}
                    />
                  ) : null}
                </div>
                {isClaude && record && detailId === record.id ? (
                  <div className="w1-captoolpanel w1-skilldetail">
                    <div className="w1-captoolh">
                      <span>源文件</span>
                      <button
                        type="button"
                        className="w1-capmini"
                        onClick={() => openFolder(record)}
                      >
                        打开目录
                      </button>
                    </div>
                    {detailBusy ? (
                      <p className="w1-capnote">正在读取插件目录…</p>
                    ) : inspection ? (
                      <>
                        <div className="w1-skillfiles">
                          {inspection.files.slice(0, 40).map((file) => (
                            <span key={file}>{file}</span>
                          ))}
                          {inspection.files.length > 40 ? (
                            <span>+{inspection.files.length - 40} 个文件</span>
                          ) : null}
                        </div>
                        {inspection.docs.length === 0 ? (
                          <p className="w1-capnote">
                            没有 SKILL.md；这个插件可能只包含 commands / agents。
                          </p>
                        ) : (
                          inspection.docs.map((doc) => (
                            <div className="w1-skilldoc" key={doc.path}>
                              <b>{doc.path}</b>
                              <pre>{doc.content}</pre>
                            </div>
                          ))
                        )}
                      </>
                    ) : (
                      <p className="w1-capnote">没有可读取的文件。</p>
                    )}
                  </div>
                ) : null}
              </Fragment>
            )
          })}
        </div>
      )}
      <p className="w1-capnote">
        启用与信任只在这里操作；Codex 插件启用时会同步 skill 副本到应用私有 codex-home。★
        是软约束，要硬性拦住同类工具请到「内置工具」页关闭对应的原生组。
      </p>
    </section>
  )
}
