import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import type {
  AppInfo,
  AuditLogDomain,
  AuditLogRecord,
  McpDomain,
  McpMode,
  McpPolicyRecord,
  ProviderProfileRecord
} from '../../../shared/ipc'
import { DURATION, EASE_OUT } from '../lib/motion'
import { skinLabel, themeLabel } from '../lib/theme'
import { useWorkstation } from '../store/useWorkstation'

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
  const providerApi = typeof window === 'undefined' ? undefined : window.ws?.provider
  const [profiles, setProfiles] = useState<ProviderProfileRecord[]>([])
  const [providerMode, setProviderMode] = useState<'inherit' | 'custom'>('inherit')
  const [providerName, setProviderName] = useState('')
  const [providerUrl, setProviderUrl] = useState('')
  const [providerModel, setProviderModel] = useState('')
  const [providerKey, setProviderKey] = useState('')
  const [providerBusy, setProviderBusy] = useState(false)
  const activeProfile = profiles.find((profile) => profile.active)
  const mcpApi = typeof window === 'undefined' ? undefined : window.ws?.mcp
  const auditApi = typeof window === 'undefined' ? undefined : window.ws?.audit
  const [policies, setPolicies] = useState<McpPolicyRecord[]>([])
  const [policyBusy, setPolicyBusy] = useState(false)
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
        const active = list.find((profile) => profile.active)
        if (active) {
          setProviderMode('custom')
          setProviderName(active.name)
          setProviderUrl(active.baseUrl)
          setProviderModel(active.model)
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

  const selectInheritedProvider = () => {
    setProviderMode('inherit')
    setProfiles((list) => list.map((profile) => ({ ...profile, active: false })))
    if (!providerApi) return
    setProviderBusy(true)
    void providerApi
      .setActive(null)
      .then(() => notify('已改为继承 Claude CLI 配置'))
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '切换失败'))
      .finally(() => setProviderBusy(false))
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
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {})
      })
      .then((saved) => {
        setProfiles((list) => [
          ...list
            .filter((profile) => profile.id !== saved.id)
            .map((profile) => ({
              ...profile,
              active: false
            })),
          saved
        ])
        setProviderMode('custom')
        setProviderKey('')
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
        className="w1-settings-sheet"
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
            <div className="w1-provseg" role="group" aria-label="Provider 模式">
              <button
                type="button"
                className={providerMode === 'inherit' ? 'on' : ''}
                aria-pressed={providerMode === 'inherit'}
                disabled={providerBusy}
                onClick={selectInheritedProvider}
              >
                继承 Claude CLI
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

            {providerMode === 'inherit' ? (
              <p className="w1-provnote">
                沿用 Claude CLI 自己的登录与 settings。只影响本应用启动的进程，不改 CC Switch。
              </p>
            ) : (
              <>
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
                      placeholder="deepseek-v4-flash"
                      aria-label="Provider 模型"
                      onChange={(event) => setProviderModel(event.target.value)}
                    />
                  </label>
                  <label className="w1-provfield wide">
                    <span>Base URL</span>
                    <input
                      value={providerUrl}
                      placeholder="http://127.0.0.1:23333"
                      aria-label="Provider Base URL"
                      onChange={(event) => setProviderUrl(event.target.value)}
                    />
                  </label>
                  <label className="w1-provfield wide">
                    <span>API Key</span>
                    <input
                      type="password"
                      value={providerKey}
                      autoComplete="off"
                      placeholder={activeProfile?.hasToken ? '已保存，留空则保留' : '粘贴 API Key'}
                      aria-label="Provider API Key"
                      onChange={(event) => setProviderKey(event.target.value)}
                    />
                  </label>
                </div>
                <div className="w1-provfoot">
                  <span className={`w1-provstatus${activeProfile ? ' on' : ''}`}>
                    {activeProfile
                      ? `${activeProfile.name} · 已加密保存`
                      : providerApi
                        ? '尚未保存'
                        : '仅在桌面应用可用'}
                  </span>
                  <button
                    className="w1-provsave"
                    type="button"
                    disabled={providerBusy || !providerApi}
                    onClick={saveProvider}
                  >
                    {providerBusy ? '保存中…' : '保存并启用'}
                  </button>
                </div>
                <p className="w1-provnote">
                  只影响本应用启动的 Claude 进程；API Key 用系统加密存在本机，永不回显。
                </p>
              </>
            )}
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

        <footer className="w1-scheadfoot">
          当前版本 v{info?.version ?? __APP_VERSION__} · 本地优先，不上传任何数据
        </footer>
      </m.div>
    </m.div>
  )
}
