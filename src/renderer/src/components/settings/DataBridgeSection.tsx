import { useEffect, useState } from 'react'
import type { BuiltinToolRecord, McpDomain, McpMode, McpPolicyRecord } from '../../../../shared/ipc'
import { MCP_DOMAIN_LABELS, MCP_MODE_LABELS } from '../../lib/labels'

interface DataBridgeSectionProps {
  notify: (text: string) => void
  /** 域权限切换会写审计；成功后刷新设置页的活动记录 */
  onAuditRefresh: () => void
}

/**
 * 数据桥：应用自己的任务 / 笔记 / 学习 / 习惯工具与四域权限。
 * 与能力中心解耦——能力中心只管 Claude Code / Codex 的编码能力。
 */
export function DataBridgeSection({ notify, onAuditRefresh }: DataBridgeSectionProps) {
  const mcpApi = typeof window === 'undefined' ? undefined : window.ws?.mcp
  const capApi = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [policies, setPolicies] = useState<McpPolicyRecord[]>([])
  const [policyBusy, setPolicyBusy] = useState(false)
  const [tools, setTools] = useState<BuiltinToolRecord[]>([])
  const [toolBusy, setToolBusy] = useState<string | null>(null)

  useEffect(() => {
    void mcpApi
      ?.policy()
      .then(setPolicies)
      .catch(() => setPolicies([]))
    void capApi
      ?.builtinTools()
      .then(setTools)
      .catch(() => setTools([]))
  }, [mcpApi, capApi])

  const changePolicy = (domain: McpDomain, mode: McpMode) => {
    if (!mcpApi || policyBusy) return
    const current = policies.find((policy) => policy.domain === domain)
    if (current?.mode === mode) return
    setPolicyBusy(true)
    void mcpApi
      .setPolicy(domain, mode)
      .then(() => {
        setPolicies((list) =>
          list.map((policy) => (policy.domain === domain ? { ...policy, mode } : policy))
        )
        notify(`MCP ${MCP_DOMAIN_LABELS[domain]}权限：${MCP_MODE_LABELS[mode]}`)
        onAuditRefresh()
      })
      .catch((error: unknown) =>
        notify(error instanceof Error ? `权限保存失败：${error.message}` : '权限保存失败')
      )
      .finally(() => setPolicyBusy(false))
  }

  const toggleTool = (tool: BuiltinToolRecord) => {
    if (!capApi?.setBuiltinTool || toolBusy) return
    setToolBusy(tool.name)
    void capApi
      .setBuiltinTool(tool.name, !tool.enabled)
      .then(setTools)
      .catch((error: unknown) =>
        notify(error instanceof Error ? `工具开关失败：${error.message}` : '工具开关失败')
      )
      .finally(() => setToolBusy(null))
  }

  const domains = Object.keys(MCP_DOMAIN_LABELS) as (keyof typeof MCP_DOMAIN_LABELS)[]
  const enabledCount = tools.filter((tool) => tool.enabled).length

  return (
    <section className="w1-setgroup" aria-label="数据桥">
      <h3>数据桥</h3>
      <p className="w1-provnote">
        Agent 读写本应用任务 / 笔记 / 学习 / 习惯的内置 MCP
        工具。只读域拒绝写入；询问模式每次弹审批卡；可写域直接允许并写审计。
      </p>
      {policies.length === 0 ? (
        <p className="w1-provnote">仅在桌面应用可用。</p>
      ) : (
        policies.map((policy) => (
          <div className="w1-setrow" key={policy.domain}>
            <span>{MCP_DOMAIN_LABELS[policy.domain]}</span>
            <div
              className="w1-modepair"
              role="group"
              aria-label={`${MCP_DOMAIN_LABELS[policy.domain]} MCP 权限`}
            >
              {(['read', 'ask', 'write'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`w1-setbtn${policy.mode === mode ? ' on' : ''}`}
                  aria-pressed={policy.mode === mode}
                  disabled={policyBusy}
                  onClick={() => changePolicy(policy.domain, mode)}
                >
                  {MCP_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      {tools.length > 0 ? (
        <div className="w1-capdomain w1-databridge">
          <h4>
            内置数据工具
            <i className="w1-capver">
              {enabledCount}/{tools.length}
            </i>
          </h4>
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
                        disabled={toolBusy === tool.name}
                        aria-pressed={tool.enabled}
                        aria-label={`${tool.name} ${tool.enabled ? '已启用，点击关闭' : '已关闭，点击启用'}`}
                        onClick={() => toggleTool(tool)}
                      >
                        {toolBusy === tool.name ? '…' : tool.enabled ? '已启用' : '已关闭'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          <p className="w1-capnote">关闭后桥不再列出也不执行它；下一次会话生效。</p>
        </div>
      ) : null}
    </section>
  )
}
