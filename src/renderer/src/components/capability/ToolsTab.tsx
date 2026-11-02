import { Fragment } from 'react'
import type { BuiltinToolRecord, ExternalMcpServerRecord } from '../../../../shared/ipc'
import { mcpStatus, mcpTarget } from '../../lib/capabilities'
import { MCP_DOMAIN_LABELS } from '../../lib/labels'

/** CLI 自带工具：应用无法关闭，只能经审批卡与审批规则约束。 */
const NATIVE_TOOLS = [
  { name: 'Read / Grep / Glob / LS', description: '读取工作区文件', kind: '只读' },
  { name: 'Write / Edit / NotebookEdit', description: '修改工作区文件', kind: '写入' },
  { name: 'Bash / Shell', description: '执行命令', kind: '敏感' },
  { name: 'WebFetch / WebSearch', description: '访问外部网络', kind: '敏感' }
] as const

interface ToolsTabProps {
  tools: BuiltinToolRecord[]
  mcp: ExternalMcpServerRecord[]
  builtinBusy: string | null
  onToggle: (tool: BuiltinToolRecord) => void
}

/** 「内置工具」总览：本地数据工具按域分组，外挂 MCP 与 CLI 原生工具只读列出。 */
export function ToolsTab({ tools, mcp, builtinBusy, onToggle }: ToolsTabProps) {
  const enabled = tools.filter((tool) => tool.enabled).length
  const domains = Object.keys(MCP_DOMAIN_LABELS) as (keyof typeof MCP_DOMAIN_LABELS)[]

  return (
    <section className="w1-capsection" aria-label="工具总览">
      <div className="w1-caphead">
        <span className="w1-capkicker">// TOOL OVERVIEW</span>
        <span className="w1-capnote">
          内置 {enabled}/{tools.length} 启用
        </span>
      </div>
      {domains.map((domain) => {
        const list = tools.filter((tool) => tool.domain === domain)
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
                    disabled={builtinBusy === tool.name}
                    aria-pressed={tool.enabled}
                    aria-label={`${tool.name} ${tool.enabled ? '已启用，点击关闭' : '已关闭，点击启用'}`}
                    onClick={() => onToggle(tool)}
                  >
                    {builtinBusy === tool.name ? '…' : tool.enabled ? '已启用' : '已关闭'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <div className="w1-capdomain">
        <h4>外部 MCP</h4>
        <div className="w1-caplist">
          {mcp.length === 0 ? (
            <p className="w1-capnote">还没有外部 Server，在「外部 MCP」里添加。</p>
          ) : (
            mcp.map((server) => (
              <div className="w1-caprow static" key={server.id}>
                <span className="w1-capglyph">MC</span>
                <span className="w1-capcopy">
                  <b>
                    {server.name}
                    <i className="w1-capver">{server.transport}</i>
                  </b>
                  <p>{mcpTarget(server) || server.description}</p>
                </span>
                <span className="w1-capbadge">{mcpStatus(server)}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="w1-capdomain">
        <h4>CLI 原生工具</h4>
        <div className="w1-caplist">
          {NATIVE_TOOLS.map((tool) => (
            <Fragment key={tool.name}>
              <div className="w1-caprow static">
                <span className="w1-capglyph">CL</span>
                <span className="w1-capcopy">
                  <b>{tool.name}</b>
                  <p>{tool.description}</p>
                </span>
                <span className="w1-capbadge">{tool.kind}</span>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
      <p className="w1-capnote">
        内置工具关闭后桥不再列出也不执行它；写入工具仍受「MCP 域权限」拦截。CLI 原生工具由 Claude /
        Codex 自己提供，不能在这里关闭，只能经审批卡与审批规则约束。
      </p>
    </section>
  )
}
