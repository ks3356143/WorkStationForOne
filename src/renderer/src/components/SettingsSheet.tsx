import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import type {
  AppInfo,
  ApprovalRuleRecord,
  AuditLogDomain,
  AuditLogRecord,
  McpDomain,
  McpMode,
  McpPolicyRecord,
  ProviderProfileRecord,
  ProviderTarget,
  ProviderWireApi
} from '../../../shared/ipc'
import { DURATION, EASE_OUT } from '../lib/motion'
import { skinLabel, themeLabel } from '../lib/theme'
import { useWorkstation } from '../store/useWorkstation'
import { CapabilityPanel } from './capability/CapabilityPanel'
import { ClaudeGlyph, CodexGlyph } from './Glyphs'

interface SettingsSheetProps {
  onClose: () => void
  notify: (text: string) => void
}

const MCP_DOMAIN_LABELS: Record<McpDomain, string> = {
  task: '任务',
  habit: '习惯',
  learning: '学习',
  note: '笔记'
}

const MCP_MODE_LABELS: Record<McpMode, string> = {
  read: '只读',
  ask: '询问',
  write: '可写'
}

const AUDIT_DOMAIN_LABELS: Record<AuditLogDomain, string> = {
  task: '任务',
  note: '笔记',
  learning: '学习',
  habit: '习惯',
  mcp: 'MCP',
  system: '设置'
}

const AUDIT_FILTERS: { value: AuditLogDomain | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'task', label: '任务' },
  { value: 'note', label: '笔记' },
  { value: 'learning', label: '学习' },
  { value: 'habit', label: '习惯' },
  { value: 'mcp', label: 'MCP' },
  { value: 'system', label: '设置' }
]

function auditTime(at: number): string {
  return new Date(at).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

type ProviderTestState =
  | { kind: 'testing'; message: string }
  | { kind: 'ok' | 'fail'; message: string; latencyMs?: number }
  | null

export function SettingsSheet({ onClose, notify }: SettingsSheetProps) {
  const theme = useWorkstation((state) => state.theme)
  const skin = useWorkstation((state) => state.skin)
  const motionOn = useWorkstation((state) => state.motionOn)
  const toggleTheme = useWorkstation((state) => state.toggleTheme)
  const toggleSkin = useWorkstation((state) => state.toggleSkin)
  const toggleMotion = useWorkstation((state) => state.toggleMotion)
  const boxRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'basic' | 'capability'>('basic')
  const providerApi = typeof window === 'undefined' ? undefined : window.ws?.provider
  const [profiles, setProfiles] = useState<ProviderProfileRecord[]>([])
  const [providerTarget, setProviderTarget] = useState<ProviderTarget>('claude')
  const [providerWireApi, setProviderWireApi] = useState<ProviderWireApi>('responses')
  const [providerMode, setProviderMode] = useState<'inherit' | 'custom'>('inherit')
  const [providerName, setProviderName] = useState('')
  const [providerUrl, setProviderUrl] = useState('')
  const [providerModel, setProviderModel] = useState('')
  const [providerKey, setProviderKey] = useState('')
  const [providerBusy, setProviderBusy] = useState(false)
  const [providerTest, setProviderTest] = useState<ProviderTestState>(null)
  const providerTestSeq = useRef(0)
  const activeProfile = profiles.find(
    (profile) => profile.target === providerTarget && profile.active
  )
  const providerLabel = providerTarget === 'claude' ? 'Claude Code' : 'Codex CLI'
  const providerState = providerBusy
    ? '同步中'
    : activeProfile
      ? '已启用'
      : providerMode === 'inherit'
        ? '继承中'
        : '待保存'
  const providerStateTone = providerBusy
    ? 'idle'
    : activeProfile
      ? 'on'
      : providerMode === 'inherit'
        ? 'inherit'
        : 'idle'
  const providerGlyph =
    providerTarget === 'claude' ? (
      <ClaudeGlyph width={15} height={15} />
    ) : (
      <CodexGlyph width={15} height={15} />
    )
  const providerTesting = providerTest?.kind === 'testing'
  const canTestProvider =
    Boolean(providerApi) &&
    !providerBusy &&
    !providerTesting &&
    Boolean(providerUrl.trim()) &&
    Boolean(providerModel.trim()) &&
    Boolean(providerKey.trim() || activeProfile?.hasToken)
  const mcpApi = typeof window === 'undefined' ? undefined : window.ws?.mcp
  const agentApi = typeof window === 'undefined' ? undefined : window.ws?.agent
  const auditApi = typeof window === 'undefined' ? undefined : window.ws?.audit
  const [policies, setPolicies] = useState<McpPolicyRecord[]>([])
  const [policyBusy, setPolicyBusy] = useState(false)
  const [approvalRules, setApprovalRules] = useState<ApprovalRuleRecord[]>([])
  const [ruleBusy, setRuleBusy] = useState(false)
  const [auditRows, setAuditRows] = useState<AuditLogRecord[]>([])
  const [auditDomain, setAuditDomain] = useState<AuditLogDomain | 'all'>('all')

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    root?.focus()
    void window.ws?.app
      ?.info()
      .then(setInfo)
      .catch(() => setInfo(null))
    void providerApi
      ?.list()
      .then((list) => {
        setProfiles(list)
        const active = list.find((profile) => profile.target === 'claude' && profile.active)
        if (active) {
          setProviderMode('custom')
          setProviderName(active.name)
          setProviderUrl(active.baseUrl)
          setProviderModel(active.model)
          setProviderWireApi(active.wireApi)
        }
      })
      .catch(() => setProfiles([]))
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [providerApi])

  useEffect(() => {
    void mcpApi
      ?.policy()
      .then(setPolicies)
      .catch(() => setPolicies([]))
  }, [mcpApi])

  useEffect(() => {
    void agentApi
      ?.approvalRules()
      .then(setApprovalRules)
      .catch(() => setApprovalRules([]))
  }, [agentApi])

  // biome-ignore lint/correctness/useExhaustiveDependencies: 目标/模式/表单变化时要清空上一次测试结果
  useEffect(() => {
    providerTestSeq.current += 1
    setProviderTest(null)
  }, [providerTarget, providerMode, providerUrl, providerModel, providerKey])

  useEffect(() => {
    if (!auditApi) return
    let alive = true
    void auditApi
      .recent(30, auditDomain === 'all' ? undefined : auditDomain)
      .then((rows) => {
        if (alive) setAuditRows(rows)
      })
      .catch(() => {
        if (alive) setAuditRows([])
      })
    return () => {
      alive = false
    }
  }, [auditApi, auditDomain])

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
        return auditApi
          ?.recent(30, auditDomain === 'all' ? undefined : auditDomain)
          .then(setAuditRows)
      })
      .catch((error: unknown) =>
        notify(error instanceof Error ? `权限保存失败：${error.message}` : '权限保存失败')
      )
      .finally(() => setPolicyBusy(false))
  }

  const revokeRule = (id: string) => {
    if (!agentApi || ruleBusy) return
    setRuleBusy(true)
    void agentApi
      .removeApprovalRule(id)
      .then(() => {
        notify('已撤销审批规则')
        return agentApi.approvalRules().then(setApprovalRules)
      })
      .then(() =>
        auditApi?.recent(30, auditDomain === 'all' ? undefined : auditDomain).then(setAuditRows)
      )
      .catch((error: unknown) =>
        notify(error instanceof Error ? `撤销失败：${error.message}` : '撤销失败')
      )
      .finally(() => setRuleBusy(false))
  }

  const applyProviderTarget = (target: ProviderTarget, list = profiles) => {
    const active = list.find((profile) => profile.target === target && profile.active)
    setProviderMode(active ? 'custom' : 'inherit')
    setProviderName(active?.name ?? '')
    setProviderUrl(active?.baseUrl ?? '')
    setProviderModel(active?.model ?? '')
    setProviderWireApi(target === 'codex' ? 'responses' : (active?.wireApi ?? 'responses'))
    setProviderKey('')
  }

  const switchProviderTarget = (target: ProviderTarget) => {
    setProviderTarget(target)
    applyProviderTarget(target)
  }

  const selectInheritedProvider = () => {
    setProviderMode('inherit')
    setProfiles((list) =>
      list.map((profile) =>
        profile.target === providerTarget ? { ...profile, active: false } : profile
      )
    )
    if (!providerApi) return
    setProviderBusy(true)
    void providerApi
      .setActive(providerTarget, null)
      .then(() => {
        window.dispatchEvent(new Event('ws:provider-changed'))
        notify(`已改为继承 ${providerTarget === 'claude' ? 'Claude Code' : 'Codex CLI'} 配置`)
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '切换失败'))
      .finally(() => setProviderBusy(false))
  }

  const runProviderTest = () => {
    if (!providerApi || providerTesting) return
    const baseUrl = providerUrl.trim()
    const model = providerModel.trim()
    const apiKey = providerKey.trim()
    if (!baseUrl || !model) {
      notify('先填 Base URL 与模型')
      return
    }
    if (!apiKey && !activeProfile?.hasToken) {
      notify('先填 API Key')
      return
    }
    setProviderTest({ kind: 'testing', message: '正在验证端点与凭据…' })
    const seq = ++providerTestSeq.current
    void providerApi
      .test({
        ...(activeProfile ? { id: activeProfile.id } : {}),
        target: providerTarget,
        wireApi: providerWireApi,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {})
      })
      .then((result) => {
        if (seq !== providerTestSeq.current) return
        setProviderTest({
          kind: result.ok ? 'ok' : 'fail',
          message: result.message,
          ...(result.ok ? { latencyMs: result.latencyMs } : {})
        })
      })
      .catch((error: unknown) => {
        if (seq !== providerTestSeq.current) return
        setProviderTest({
          kind: 'fail',
          message: error instanceof Error ? error.message : '测试失败'
        })
      })
  }

  const saveProvider = () => {
    if (!providerApi || providerBusy) return
    const name = providerName.trim()
    const baseUrl = providerUrl.trim()
    const model = providerModel.trim()
    const apiKey = providerKey.trim()
    if (!name || !baseUrl || !model) {
      notify('先填名称、Base URL 与模型')
      return
    }
    if (!activeProfile?.hasToken && !apiKey) {
      notify('还没有保存 API Key')
      return
    }
    setProviderBusy(true)
    void providerApi
      .save({
        ...(activeProfile ? { id: activeProfile.id } : {}),
        name,
        target: providerTarget,
        wireApi: providerWireApi,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {})
      })
      .then((saved) => {
        setProfiles((list) => [
          ...list
            .filter((profile) => profile.id !== saved.id)
            .map((profile) =>
              profile.target === saved.target ? { ...profile, active: false } : profile
            ),
          saved
        ])
        setProviderTarget(saved.target)
        setProviderWireApi(saved.wireApi)
        setProviderMode('custom')
        setProviderKey('')
        setProviderTest(null)
        window.dispatchEvent(new Event('ws:provider-changed'))
        notify('Provider 已保存并启用')
      })
      .catch((error: unknown) =>
        notify(error instanceof Error ? `保存失败：${error.message}` : '保存失败')
      )
      .finally(() => setProviderBusy(false))
  }

  const backupNow = () => {
    const bridge = window.ws?.app
    if (!bridge?.backupNow || busy) return
    setBusy(true)
    void bridge
      .backupNow()
      .then((result) => {
        notify(
          `已备份 ${(result.bytes / 1024).toFixed(0)} KB · ${result.file.split(/[\\/]/).pop() ?? ''}`
        )
        return bridge.info().then(setInfo)
      })
      .catch((error: unknown) => {
        notify(error instanceof Error ? `备份失败：${error.message}` : '备份失败')
      })
      .finally(() => setBusy(false))
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
        className={`w1-settings-sheet${settingsTab === 'capability' ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        tabIndex={-1}
        initial={{ opacity: 0, transform: 'translateY(12px) scale(0.99)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="w1-schead">
          <b>
            <em>//</em>设置
          </b>
          <span className="w1-scheadkeys">
            <kbd>Esc</kbd> 关闭
          </span>
        </header>

        <div className="w1-settabs" role="tablist" aria-label="设置分区">
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'basic'}
            className={settingsTab === 'basic' ? 'on' : ''}
            onClick={() => setSettingsTab('basic')}
          >
            基础
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'capability'}
            className={settingsTab === 'capability' ? 'on' : ''}
            onClick={() => setSettingsTab('capability')}
          >
            能力中心
          </button>
        </div>

        {settingsTab === 'basic' ? (
          <>
            <section className="w1-setgroup" aria-label="外观">
              <h3>外观</h3>
              <div className="w1-setrow">
                <span>主题</span>
                <button type="button" className="w1-setbtn" onClick={toggleTheme}>
                  {themeLabel(theme)}
                </button>
              </div>
              <div className="w1-setrow">
                <span>皮肤</span>
                <button type="button" className="w1-setbtn" onClick={toggleSkin}>
                  {skinLabel(skin)}
                </button>
              </div>
              <div className="w1-setrow">
                <span>动效</span>
                <button
                  type="button"
                  className={`w1-setbtn${motionOn ? ' on' : ''}`}
                  aria-pressed={motionOn}
                  onClick={toggleMotion}
                >
                  {motionOn ? '开启' : '关闭'}
                </button>
              </div>
            </section>

            <section className="w1-setgroup" aria-label="Agent Provider">
              <h3>Agent Provider</h3>
              <div className="w1-provcard">
                <div className="w1-provdeckhead">
                  <span className="w1-provkicker">// CONNECTION BUS</span>
                  <span className={`w1-provstate ${providerStateTone}`}>
                    <i aria-hidden="true" />
                    {providerState}
                  </span>
                </div>

                <div className="w1-provseg w1-provports" role="group" aria-label="Provider 目标">
                  <button
                    type="button"
                    data-target="claude"
                    className={`w1-provport${providerTarget === 'claude' ? ' on' : ''}`}
                    aria-pressed={providerTarget === 'claude'}
                    disabled={providerBusy}
                    onClick={() => switchProviderTarget('claude')}
                  >
                    <span className="w1-provportglyph">
                      <ClaudeGlyph width={15} height={15} />
                    </span>
                    <span className="w1-provportcopy">
                      <b>Claude Code</b>
                      <i>{providerTarget === 'claude' ? '当前目标' : '切换目标'}</i>
                    </span>
                    <span className="w1-provled" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    data-target="codex"
                    className={`w1-provport${providerTarget === 'codex' ? ' on' : ''}`}
                    aria-pressed={providerTarget === 'codex'}
                    disabled={providerBusy}
                    onClick={() => switchProviderTarget('codex')}
                  >
                    <span className="w1-provportglyph">
                      <CodexGlyph width={15} height={15} />
                    </span>
                    <span className="w1-provportcopy">
                      <b>Codex CLI</b>
                      <i>{providerTarget === 'codex' ? '当前目标' : '切换目标'}</i>
                    </span>
                    <span className="w1-provled" aria-hidden="true" />
                  </button>
                </div>

                <div className="w1-provbus" aria-hidden="true" />

                <div className="w1-provroute">
                  <span>路由</span>
                  <div className="w1-provseg" role="group" aria-label="Provider 模式">
                    <button
                      type="button"
                      className={providerMode === 'inherit' ? 'on' : ''}
                      aria-pressed={providerMode === 'inherit'}
                      disabled={providerBusy}
                      onClick={selectInheritedProvider}
                    >
                      继承 {providerLabel}
                    </button>
                    <button
                      type="button"
                      className={providerMode === 'custom' ? 'on' : ''}
                      aria-pressed={providerMode === 'custom'}
                      disabled={providerBusy}
                      onClick={() => setProviderMode('custom')}
                    >
                      自定义
                    </button>
                  </div>
                </div>

                <m.div
                  key={`${providerTarget}-${providerMode}`}
                  className="w1-provbody"
                  initial={{ opacity: 0, transform: 'translateY(4px)' }}
                  animate={{ opacity: 1, transform: 'translateY(0px)' }}
                  transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
                >
                  {providerMode === 'inherit' ? (
                    <div className="w1-provinherit">
                      <span className="w1-provinheritglyph">{providerGlyph}</span>
                      <span className="w1-provinheritcopy">
                        <b>沿用本机 {providerLabel}</b>
                        <p>
                          {providerTarget === 'claude'
                            ? '使用 Claude CLI 自己的登录与 settings；本应用不会改写 CC Switch 或桌面配置。'
                            : '使用 Codex CLI 自己的登录与配置；本应用不会改写 ~/.codex 或 CC Switch。'}
                        </p>
                      </span>
                      <span className="w1-provbadge">外部配置不变</span>
                    </div>
                  ) : (
                    <div className="w1-provconn">
                      {providerTarget === 'codex' ? (
                        <div className="w1-provprotocol">
                          <div className="w1-provseg" role="group" aria-label="Codex 协议">
                            <button type="button" className="on" aria-pressed="true" disabled>
                              Responses
                            </button>
                          </div>
                          <span className="w1-provnote">Codex 0.166 仅支持 Responses</span>
                        </div>
                      ) : null}
                      <div className="w1-provfields">
                        <label className="w1-provfield">
                          <span>名称</span>
                          <input
                            value={providerName}
                            placeholder="DeepSeek 代理"
                            aria-label="Provider 名称"
                            onChange={(event) => setProviderName(event.target.value)}
                          />
                        </label>
                        <label className="w1-provfield">
                          <span>模型</span>
                          <input
                            value={providerModel}
                            placeholder="deepseek-flash"
                            aria-label="Provider 模型"
                            onChange={(event) => setProviderModel(event.target.value)}
                          />
                        </label>
                        <label className="w1-provfield wide">
                          <span>Base URL</span>
                          <input
                            value={providerUrl}
                            placeholder="https://api.deepseek.com"
                            aria-label="Provider Base URL"
                            onChange={(event) => setProviderUrl(event.target.value)}
                          />
                        </label>
                        <label className="w1-provfield wide">
                          <span>API Key</span>
                          <div className="w1-provkey">
                            <input
                              type="password"
                              value={providerKey}
                              autoComplete="off"
                              placeholder={
                                activeProfile?.hasToken ? '已保存，留空则保留' : '粘贴 API Key'
                              }
                              aria-label="Provider API Key"
                              onChange={(event) => setProviderKey(event.target.value)}
                            />
                            <span
                              className={`w1-provkeytag${activeProfile?.hasToken ? ' on' : ''}`}
                            >
                              {activeProfile?.hasToken ? '已加密' : '待填写'}
                            </span>
                          </div>
                        </label>
                      </div>
                      <div className="w1-provfoot">
                        <span className="w1-provfootstate">
                          <span
                            className={`w1-provled${activeProfile ? ' on' : ''}`}
                            aria-hidden="true"
                          />
                          <span className={`w1-provstatus${activeProfile ? ' on' : ''}`}>
                            {activeProfile
                              ? `${activeProfile.name} · 已加密保存`
                              : providerApi
                                ? '填写后保存并启用'
                                : '仅在桌面应用可用'}
                          </span>
                        </span>
                        <button
                          className="w1-provtest"
                          type="button"
                          disabled={!canTestProvider}
                          onClick={runProviderTest}
                        >
                          {providerTesting ? '测试中…' : '测试连接'}
                        </button>
                        <button
                          className="w1-provsave"
                          type="button"
                          disabled={providerBusy || providerTesting || !providerApi}
                          onClick={saveProvider}
                        >
                          {providerBusy ? '保存中…' : '保存并启用'}
                        </button>
                      </div>
                      {providerTest ? (
                        <p
                          className={`w1-provtestresult ${providerTest.kind}`}
                          role="status"
                          aria-live="polite"
                        >
                          <span className="w1-provled" aria-hidden="true" />
                          <span>
                            {providerTest.kind === 'ok'
                              ? `${providerTest.message} · ${providerTest.latencyMs ?? 0} ms`
                              : providerTest.message}
                          </span>
                        </p>
                      ) : null}
                      <p className="w1-provnote">
                        API Key 用系统加密存本机，永不回显；只影响本应用启动的 {providerLabel}{' '}
                        进程。
                      </p>
                    </div>
                  )}
                </m.div>
              </div>
            </section>

            <section className="w1-setgroup" aria-label="MCP 数据权限">
              <h3>MCP 数据权限</h3>
              <p className="w1-provnote">
                只读域拒绝写入；询问模式每次弹审批卡；可写域直接允许并写审计。切换会写审计。
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
                      <button
                        type="button"
                        className={`w1-setbtn${policy.mode === 'read' ? ' on' : ''}`}
                        aria-pressed={policy.mode === 'read'}
                        disabled={policyBusy}
                        onClick={() => changePolicy(policy.domain, 'read')}
                      >
                        只读
                      </button>
                      <button
                        type="button"
                        className={`w1-setbtn${policy.mode === 'ask' ? ' on' : ''}`}
                        aria-pressed={policy.mode === 'ask'}
                        disabled={policyBusy}
                        onClick={() => changePolicy(policy.domain, 'ask')}
                      >
                        询问
                      </button>
                      <button
                        type="button"
                        className={`w1-setbtn${policy.mode === 'write' ? ' on' : ''}`}
                        aria-pressed={policy.mode === 'write'}
                        disabled={policyBusy}
                        onClick={() => changePolicy(policy.domain, 'write')}
                      >
                        可写
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="w1-setgroup" aria-label="审批规则">
              <h3>审批规则</h3>
              <p className="w1-provnote">
                只对 MCP 工具与本地只读工具生效；对该工作区里同 Agent
                的所有会话生效。Bash、写入类工具与「本会话允许」不落库，应用退出后失效。
              </p>
              {!agentApi ? (
                <p className="w1-provnote">仅在桌面应用可用。</p>
              ) : approvalRules.length === 0 ? (
                <p className="w1-provnote">还没有工作区审批规则。</p>
              ) : (
                <div className="w1-setrules">
                  {approvalRules.map((rule) => (
                    <div className="w1-setrule" key={rule.id}>
                      <code className="w1-setruletool">{rule.toolName}</code>
                      <span className="w1-setruleagent">
                        {rule.agent === 'claude' ? 'Claude' : 'Codex'}
                      </span>
                      <span className="w1-setrulepath" title={rule.workspace}>
                        {rule.workspace}
                      </span>
                      <time>{rule.lastUsedAt ? auditTime(rule.lastUsedAt) : '从未'}</time>
                      <button
                        type="button"
                        className="w1-setbtn"
                        disabled={ruleBusy}
                        onClick={() => revokeRule(rule.id)}
                      >
                        撤销
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="w1-setgroup" aria-label="活动记录">
              <h3>活动记录</h3>
              <div className="w1-auditfilter" role="group" aria-label="活动记录筛选">
                {AUDIT_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={`w1-auditfilterbtn${auditDomain === filter.value ? ' on' : ''}`}
                    aria-pressed={auditDomain === filter.value}
                    onClick={() => setAuditDomain(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <div className="w1-auditlist">
                {auditRows.length === 0 ? (
                  <p className="w1-provnote">还没有活动记录。</p>
                ) : (
                  auditRows.map((row) => (
                    <div
                      className="w1-auditrow"
                      key={row.id}
                      title={[row.title, row.detail, row.source].filter(Boolean).join(' · ')}
                    >
                      <time>{auditTime(row.at)}</time>
                      <b>{AUDIT_DOMAIN_LABELS[row.domain] ?? row.domain}</b>
                      <span>{row.title ?? row.targetId ?? '—'}</span>
                      <em>{row.action}</em>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="w1-setgroup" aria-label="数据">
              <h3>数据</h3>
              <div className="w1-setrow">
                <span>数据库</span>
                <code className="w1-setpath">{info?.dataDir ?? '读取中…'}</code>
              </div>
              <div className="w1-setrow">
                <span>备份</span>
                <code className="w1-setpath">
                  {info ? `${info.backupCount} 份 · ${info.backupDir}` : '读取中…'}
                </code>
              </div>
              <div className="w1-setrow">
                <span>立即备份</span>
                <button type="button" className="w1-setbtn" disabled={busy} onClick={backupNow}>
                  {busy ? '备份中…' : '执行'}
                </button>
              </div>
            </section>
          </>
        ) : (
          <CapabilityPanel notify={notify} />
        )}

        <footer className="w1-scheadfoot">
          当前版本 v{info?.version ?? __APP_VERSION__} · 本地优先，不上传任何数据
        </footer>
      </m.div>
    </m.div>
  )
}
