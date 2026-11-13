import { useEffect, useState } from 'react'
import type { AgentKind, EnvironmentCheckRecord, ToolSurfaceRecord } from '../../../../shared/ipc'
import { friendlyMessage } from '../../lib/errors'
import { envVersion } from '../../lib/capabilities'
import { MAX_TOOL_NOTE } from '../../../../shared/tool-surface'

interface NativeToolsTabProps {
  agent: AgentKind
  surface: ToolSurfaceRecord | null
  busy: string | null
  notify: (text: string) => void
  onAgent: (agent: AgentKind) => void
  onToggleNative: (id: string, enabled: boolean) => void
  /** 当前 Agent 的真实注入文本，只读预览 */
  promptPreview: string
}

const AGENT_LABELS: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }

/**
 * 内置工具页：CLI 本身的运行环境 + 原生工具开关 + 优先级注入预览。
 * 数据桥（任务 / 笔记 / 学习 / 习惯）在基础设置的「数据桥」分区，不在这里。
 */
export function NativeToolsTab({
  agent,
  surface,
  busy,
  notify,
  onAgent,
  onToggleNative,
  promptPreview
}: NativeToolsTabProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [environment, setEnvironment] = useState<EnvironmentCheckRecord[]>([])
  const [envBusy, setEnvBusy] = useState(false)

  useEffect(() => {
    if (!api) return
    let alive = true
    // 环境自检会 spawn 六次 --version，不能拖慢开关首屏
    void api
      .environment()
      .then((list) => {
        if (alive) setEnvironment(list)
      })
      .catch(() => {
        if (alive) setEnvironment([])
      })
    return () => {
      alive = false
    }
  }, [api])

  const loadEnvironment = (force: boolean) => {
    if (!api || envBusy) return
    setEnvBusy(true)
    void api
      .environment(force)
      .then(setEnvironment)
      .catch((reason: unknown) => notify(friendlyMessage(reason, '环境检查失败')))
      .finally(() => setEnvBusy(false))
  }

  const shellOff = surface?.native.some((item) => item.id === 'shell' && !item.enabled) === true

  return (
    <section className="w1-capsection" aria-label="内置工具">
      <div className="w1-caphead">
        <span className="w1-capkicker">// NATIVE TOOLS</span>
        <span className="w1-capnote">CLI 自带的编码工具；下一次会话生效</span>
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

      <div className="w1-capenv" role="group" aria-label="CLI 环境自检">
        <span className="w1-capenvlabel">// 环境</span>
        {environment.map((item) => (
          <span
            className={`w1-capenvitem${item.available ? '' : ' missing'}`}
            key={item.id}
            title={`${item.command}${item.path ? ` · ${item.path}` : ''}${
              item.version ? `\n${item.version}` : ''
            }`}
          >
            <b>{item.command}</b>
            {item.available ? envVersion(item.version, item.command) : '缺失'}
          </span>
        ))}
        <button
          type="button"
          className="w1-capmini"
          disabled={envBusy}
          onClick={() => loadEnvironment(true)}
        >
          {envBusy ? '检查中…' : '刷新'}
        </button>
      </div>

      {surface ? (
        <>
          <div className="w1-capdomain">
            <h4>
              CLI 原生工具
              <i className="w1-capsrc">本机 CLI</i>
            </h4>
            <div className="w1-caplist">
              {surface.native.map((tool) => (
                <div
                  className={`w1-caprow with-toggle${tool.enabled ? '' : ' off'}${tool.alwaysOn ? ' alwayson' : ''}`}
                  key={tool.id}
                >
                  <span className="w1-capglyph">CL</span>
                  <span className="w1-capcopy">
                    <b>{tool.name}</b>
                    <p>
                      {tool.description}
                      {!tool.enabled && tool.warning ? ` · ${tool.warning}` : ''}
                    </p>
                  </span>
                  {tool.alwaysOn ? (
                    <span
                      className="w1-capbadge alwayson"
                      title="CLI 未提供关闭参数，沙箱内自动执行"
                    >
                      常开
                    </span>
                  ) : (
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
                  )}
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
            <h4>注入到系统提示</h4>
            <p className="w1-capnote">
              下一次会话开始时追加给 {AGENT_LABELS[agent]} 的原文，只含名称与你写的用途说明；URL
              与密钥会自动脱敏，说明最多 {MAX_TOOL_NOTE} 字。在「MCP」与「技能」页标 ★
              的首选会单独成组，并要求能做同一件事时不改用上面的 CLI 原生工具。
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
            会话启动时只注入启用项，并把启用顺序写进系统提示；写入、命令与越权操作仍按审批规则与沙箱执行。★
            是软约束，要硬性拦住同类工具请关闭对应的原生组。
          </p>
        </>
      ) : (
        <p className="w1-capnote">正在读取内置工具…</p>
      )}
    </section>
  )
}
