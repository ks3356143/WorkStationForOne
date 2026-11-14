import { useState } from 'react'
import type {
  ExpertRecord,
  ExpertSaveInput,
  ExternalMcpServerRecord,
  SkillRecord
} from '../../../../shared/ipc'

export interface ExpertFormProps {
  initial?: ExpertRecord
  mcp: ExternalMcpServerRecord[]
  skills: SkillRecord[]
  busy: boolean
  onCancel: () => void
  onSave: (input: ExpertSaveInput) => void
}

export function ExpertForm({ initial, mcp, skills, busy, onCancel, onSave }: ExpertFormProps) {
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
