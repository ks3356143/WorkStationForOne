import type {
  AgentKind,
  BuiltinToolRecord,
  ExternalMcpServerRecord,
  SkillRecord,
  ToolSurfaceRecord
} from '../../../../shared/ipc'
import { MCP_DOMAIN_LABELS } from '../../lib/labels'

interface ToolsTabProps {
  agent: AgentKind
  surface: ToolSurfaceRecord | null
  mcp: ExternalMcpServerRecord[]
  skills: SkillRecord[]
  busy: string | null
  onAgent: (agent: AgentKind) => void
  onToggleNative: (id: string, enabled: boolean) => void
  onMove: (key: string, direction: 'up' | 'down') => void
  onToggleMcp: (server: ExternalMcpServerRecord, enable: boolean) => void
  onToggleSkill: (skill: SkillRecord, enable: boolean) => void
  onToggleBuiltin: (tool: BuiltinToolRecord) => void
  onPreferred: (key: string, preferred: boolean) => void
  /** 当前 Agent 的真实注入文本，只读预览 */
  promptPreview: string
  onOpenMcp: () => void
}

const AGENT_LABELS: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }

/**
 * 统一工具面：CLI 原生工具开关、按 Agent 归属的 MCP / 技能排序，以及数据桥工具。
 * 启停仍以各自的信任与启用状态为准，这里只补原生开关与展示顺序。
 */
export function ToolsTab({
  agent,
  surface,
  mcp,
  skills,
  busy,
  onAgent,
  onToggleNative,
  onMove,
  onToggleMcp,
  onToggleSkill,
  onToggleBuiltin,
  onPreferred,
  promptPreview,
  onOpenMcp
}: ToolsTabProps) {
  const agentMcp = mcp.filter((server) => server.targets === 'both' || server.targets === agent)
  const agentSkills = skills.filter((skill) => skill.agent === agent)
  const enabledMcp = surface?.mcp.filter((item) => item.enabled).length ?? 0
  const enabledSkills = surface?.skills.filter((item) => item.enabled).length ?? 0
  const enabledBuiltin = surface?.builtin.filter((tool) => tool.enabled).length ?? 0
  const domains = Object.keys(MCP_DOMAIN_LABELS) as (keyof typeof MCP_DOMAIN_LABELS)[]
  const shellOff = surface?.native.some((item) => item.id === 'shell' && !item.enabled) === true

  return (
    <section className="w1-capsection" aria-label="工具面">
      <div className="w1-caphead">
        <span className="w1-capkicker">// TOOL SURFACE</span>
        <span className="w1-capnote">原生工具、MCP 与技能统一管理；下一次会话生效</span>
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

      {surface ? (
        <>
          <div className="w1-capdomain">
            <h4>CLI 原生工具</h4>
            <div className="w1-caplist">
              {surface.native.map((tool) => (
                <div className={`w1-caprow with-toggle${tool.enabled ? '' : ' off'}`} key={tool.id}>
                  <span className="w1-capglyph">CL</span>
                  <span className="w1-capcopy">
                    <b>{tool.name}</b>
                    <p>
                      {tool.description}
                      {!tool.enabled && tool.warning ? ` · ${tool.warning}` : ''}
                    </p>
                  </span>
                  <button
                    type="button"
                    className={`w1-setbtn${tool.enabled ? ' on' : ''}`}
                    disabled={busy === `native:${tool.id}`}
                    aria-pressed={tool.enabled}
                    aria-label={`${tool.name} ${tool.enabled ? '已启用，点击关闭' : '已关闭，点击启用'}`}
                    onClick={() => onToggleNative(tool.id, !tool.enabled)}
                  >
                    {busy === `native:${tool.id}` ? '…' : tool.enabled ? '已启用' : '已关闭'}
                  </button>
                </div>
              ))}
            </div>
            {shellOff ? (
              <p className="w1-capnote warn">
                「执行命令」已关闭：{AGENT_LABELS[agent]} 仍可对话与读取文件，但不能运行命令。
              </p>
            ) : null}
          </div>

          <div className="w1-capdomain">
            <div className="w1-caphead">
              <h4>
                MCP 服务
                <i className="w1-capver">
                  {enabledMcp}/{surface.mcp.length}
                </i>
              </h4>
              <div className="w1-capactions">
                <button type="button" className="w1-capmini" onClick={onOpenMcp}>
                  管理 Server
                </button>
              </div>
            </div>
            <div className="w1-caplist">
              {surface.mcp.length === 0 ? (
                <p className="w1-capnote">
                  这个 Agent 还没有外部 Server；在「MCP 服务」里添加并信任后才会列出。
                </p>
              ) : (
                surface.mcp.map((item, index) => {
                  const server = agentMcp.find((entry) => `mcp:${entry.id}` === item.id)
                  return (
                    <div
                      className={`w1-caprow with-toggle${item.enabled ? '' : ' off'}`}
                      key={item.id}
                    >
                      <span className="w1-capglyph">MC</span>
                      <span className="w1-capcopy">
                        <b>
                          {item.name}
                          {item.preferred ? <i className="w1-capprefer">首选</i> : null}
                        </b>
                        <p>
                          {item.enabled
                            ? `${item.tools.length} 个工具${
                                item.tools.length > 0
                                  ? `：${item.tools.slice(0, 4).join(', ')}`
                                  : ''
                              }`
                            : '未启用或未信任 · 不会进入会话'}
                        </p>
                      </span>
                      <span className="w1-capactions">
                        <button
                          type="button"
                          className={`w1-capprefbtn${item.preferred ? ' on' : ''}`}
                          disabled={!item.enabled || busy === `prefer:${item.id}`}
                          aria-pressed={item.preferred}
                          aria-label={`${item.name} ${item.preferred ? '取消首选' : '设为首选'}`}
                          title={
                            item.enabled
                              ? '首选：能做同一件事时先调用它，不改用 CLI 原生工具'
                              : '先启用并信任这个 Server 才能设为首选'
                          }
                          onClick={() => onPreferred(item.id, !item.preferred)}
                        >
                          {item.preferred ? '★' : '☆'}
                        </button>
                        <button
                          type="button"
                          className="w1-capmini"
                          disabled={
                            index === 0 ||
                            busy === `move:${item.id}` ||
                            item.preferred !== surface.mcp[index - 1]?.preferred
                          }
                          aria-label={`${item.name} 上移`}
                          onClick={() => onMove(item.id, 'up')}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="w1-capmini"
                          disabled={
                            index === surface.mcp.length - 1 ||
                            busy === `move:${item.id}` ||
                            item.preferred !== surface.mcp[index + 1]?.preferred
                          }
                          aria-label={`${item.name} 下移`}
                          onClick={() => onMove(item.id, 'down')}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={`w1-setbtn${item.enabled ? ' on' : ''}`}
                          disabled={!server || busy === `mcp:${server.id}`}
                          onClick={() => server && onToggleMcp(server, !server.enabled)}
                        >
                          {item.enabled ? '已启用' : '启用'}
                        </button>
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="w1-capdomain">
            <h4>
              技能
              <i className="w1-capver">
                {enabledSkills}/{surface.skills.length}
              </i>
            </h4>
            <div className="w1-caplist">
              {surface.skills.length === 0 ? (
                <p className="w1-capnote">
                  这个 Agent 还没有应用私有技能；在「技能 / 插件」里安装后会出现在这里。
                </p>
              ) : (
                surface.skills.map((item, index) => {
                  const skill = agentSkills.find((entry) => `skill:${entry.id}` === item.id)
                  return (
                    <div
                      className={`w1-caprow with-toggle${item.enabled ? '' : ' off'}`}
                      key={item.id}
                    >
                      <span className="w1-capglyph">SK</span>
                      <span className="w1-capcopy">
                        <b>
                          {item.name}
                          {item.preferred ? <i className="w1-capprefer">首选</i> : null}
                        </b>
                        <p>{item.enabled ? '已启用' : '未启用或未信任'}</p>
                      </span>
                      <span className="w1-capactions">
                        <button
                          type="button"
                          className={`w1-capprefbtn${item.preferred ? ' on' : ''}`}
                          disabled={!item.enabled || busy === `prefer:${item.id}`}
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
                          disabled={
                            index === 0 ||
                            busy === `move:${item.id}` ||
                            item.preferred !== surface.skills[index - 1]?.preferred
                          }
                          aria-label={`${item.name} 上移`}
                          onClick={() => onMove(item.id, 'up')}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="w1-capmini"
                          disabled={
                            index === surface.skills.length - 1 ||
                            busy === `move:${item.id}` ||
                            item.preferred !== surface.skills[index + 1]?.preferred
                          }
                          aria-label={`${item.name} 下移`}
                          onClick={() => onMove(item.id, 'down')}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={`w1-setbtn${item.enabled ? ' on' : ''}`}
                          disabled={!skill || busy === `skill:${skill.id}`}
                          onClick={() => skill && onToggleSkill(skill, !skill.enabled)}
                        >
                          {item.enabled ? '已启用' : '启用'}
                        </button>
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="w1-capdomain">
            <h4>
              数据桥工具
              <i className="w1-capver">
                {enabledBuiltin}/{surface.builtin.length}
              </i>
            </h4>
            <p className="w1-capnote">
              应用内置的任务 / 笔记 / 学习 / 习惯工具，不是 CLI 原生工具。
            </p>
            {domains.map((domain) => {
              const list = surface.builtin.filter((tool) => tool.domain === domain)
              if (list.length === 0) return null
              return (
                <div className="w1-capdomain" key={domain}>
                  <h4>{MCP_DOMAIN_LABELS[domain]}</h4>
                  <div className="w1-caplist">
                    {list.map((tool) => (
                      <div
                        className={`w1-caprow static builtin with-toggle${tool.enabled ? '' : ' off'}`}
                        key={tool.name}
                      >
                        <span className={`w1-capglyph${tool.write ? ' write' : ''}`}>
                          {tool.write ? 'W' : 'R'}
                        </span>
                        <span className="w1-capcopy">
                          <b>{tool.name}</b>
                          <p>{tool.description}</p>
                        </span>
                        <span className={`w1-capbadge${tool.write ? ' write' : ''}`}>
                          {tool.write ? '写入' : '只读'}
                        </span>
                        <button
                          type="button"
                          className={`w1-setbtn${tool.enabled ? ' on' : ''}`}
                          disabled={busy === `builtin:${tool.name}`}
                          aria-pressed={tool.enabled}
                          aria-label={`${tool.name} ${tool.enabled ? '已启用，点击关闭' : '已关闭，点击启用'}`}
                          onClick={() => onToggleBuiltin(tool)}
                        >
                          {busy === `builtin:${tool.name}`
                            ? '…'
                            : tool.enabled
                              ? '已启用'
                              : '已关闭'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="w1-capdomain">
            <h4>注入到系统提示</h4>
            <p className="w1-capnote">
              下一次会话开始时追加给 {AGENT_LABELS[agent]} 的原文，只含名称，不含路径、命令、URL
              或密钥。标 ★ 的首选会单独成组，并要求能做同一件事时不改用 CLI 原生工具。
            </p>
            {promptPreview ? (
              <pre className="w1-capprompt">{promptPreview}</pre>
            ) : (
              <p className="w1-capnote">
                当前没有启用的 MCP 或技能，不会追加提示；启用后会在这里看到原文。
              </p>
            )}
          </div>

          <p className="w1-capnote">
            会话启动时只注入启用项，并把启用顺序写进系统提示；写入、命令与越权操作仍按审批规则、MCP
            域权限与沙箱执行。数据桥工具关闭后桥不再列出也不执行它。★
            是软约束，要硬性拦住同类工具请同时关闭对应的原生组。
          </p>
        </>
      ) : (
        <p className="w1-capnote">正在读取工具面…</p>
      )}
    </section>
  )
}
