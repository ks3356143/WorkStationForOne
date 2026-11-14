import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import type {
  AppInfo,
  ApprovalRuleRecord,
  AuditLogDomain,
  AuditLogRecord,
  StorageInfo
} from '../../../shared/ipc'
import { DURATION, EASE_OUT } from '../lib/motion'
import { skinLabel, themeLabel } from '../lib/theme'
import { AUDIT_DOMAIN_LABELS, AUDIT_FILTERS, auditTime } from '../lib/labels'
import { useWorkstation } from '../store/useWorkstation'
import { useListAnimate } from '../lib/use-list-animate'
import { CapabilityPanel } from './capability/CapabilityPanel'
import { BackupRestore } from './settings/BackupRestore'
import { DataBridgeSection } from './settings/DataBridgeSection'
import { PromptTemplatesSection } from './settings/PromptTemplatesSection'
import { ProviderCard } from './settings/ProviderCard'

interface SettingsSheetProps {
  onClose: () => void
  notify: (text: string) => void
}

export function SettingsSheet({ onClose, notify }: SettingsSheetProps) {
  const theme = useWorkstation((state) => state.theme)
  const skin = useWorkstation((state) => state.skin)
  const motionOn = useWorkstation((state) => state.motionOn)
  const rulesAnim = useListAnimate<HTMLDivElement>()
  const auditAnim = useListAnimate<HTMLDivElement>()
  const toggleTheme = useWorkstation((state) => state.toggleTheme)
  const toggleSkin = useWorkstation((state) => state.toggleSkin)
  const toggleMotion = useWorkstation((state) => state.toggleMotion)
  const boxRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [backupRevision, setBackupRevision] = useState(0)
  const [settingsTab, setSettingsTab] = useState<'basic' | 'capability'>('basic')
  const agentApi = typeof window === 'undefined' ? undefined : window.ws?.agent
  const auditApi = typeof window === 'undefined' ? undefined : window.ws?.audit
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
    void window.ws?.app
      ?.storage()
      .then(setStorage)
      .catch(() => setStorage(null))
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    void agentApi
      ?.approvalRules()
      .then(setApprovalRules)
      .catch(() => setApprovalRules([]))
  }, [agentApi])

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

  const refreshAudit = () => {
    void auditApi
      ?.recent(30, auditDomain === 'all' ? undefined : auditDomain)
      .then(setAuditRows)
      .catch(() => {})
  }

  const revokeRule = (id: string) => {
    if (!agentApi || ruleBusy) return
    setRuleBusy(true)
    void agentApi.removeApprovalRule(id).then(
      () => {
        notify('已撤销审批规则')
        // 撤销已经成功；刷新失败只影响列表显示，不能报成撤销失败
        return Promise.all([
          agentApi.approvalRules().then(setApprovalRules),
          auditApi
            ?.recent(30, auditDomain === 'all' ? undefined : auditDomain)
            .then(setAuditRows) ?? Promise.resolve()
        ])
          .catch(() => notify('规则已撤销，列表刷新失败'))
          .finally(() => setRuleBusy(false))
      },
      (error: unknown) => {
        notify(error instanceof Error ? `撤销失败：${error.message}` : '撤销失败')
        setRuleBusy(false)
      }
    )
  }

  const pickStorage = () => {
    const bridge = window.ws?.app
    if (!bridge?.pickStorage || storageBusy) return
    setStorageBusy(true)
    void bridge
      .pickStorage()
      .then((next) => {
        setStorage(next)
        if (next.pending) notify(`重启后迁移到 ${next.pending}`)
      })
      .catch((error: unknown) => {
        notify(error instanceof Error ? `无法更改存储位置：${error.message}` : '无法更改存储位置')
      })
      .finally(() => setStorageBusy(false))
  }

  const cancelStorage = () => {
    const bridge = window.ws?.app
    if (!bridge?.cancelStorage || storageBusy) return
    setStorageBusy(true)
    void bridge
      .cancelStorage()
      .then((next) => {
        setStorage(next)
        notify('已取消更换存储位置')
      })
      .catch((error: unknown) => {
        notify(error instanceof Error ? `取消失败：${error.message}` : '取消失败')
      })
      .finally(() => setStorageBusy(false))
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
        setBackupRevision((value) => value + 1)
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

        <div className="w1-setpane" key={settingsTab}>
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

              <ProviderCard notify={notify} />

              <DataBridgeSection notify={notify} onAuditRefresh={refreshAudit} />

              <PromptTemplatesSection notify={notify} />

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
                  <div className="w1-setrules" ref={rulesAnim}>
                    {approvalRules.map((rule) => (
                      <div className="w1-setrule" key={rule.id}>
                        <code className="w1-setruletool" title={rule.toolName}>
                          {rule.toolName}
                        </code>
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
                          aria-label={`撤销 ${rule.toolName} 的规则`}
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
                <div className="w1-auditlist" ref={auditAnim}>
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
                  <i className="w1-setbackupcount">{info ? `${info.backupCount} 份` : '读取中…'}</i>
                  <code className="w1-setpath" title={info?.backupDir}>
                    {info?.backupDir ?? '读取中…'}
                  </code>
                </div>
                <div className="w1-setrow">
                  <span>立即备份</span>
                  <button type="button" className="w1-setbtn" disabled={busy} onClick={backupNow}>
                    {busy ? '备份中…' : '执行'}
                  </button>
                </div>
                <BackupRestore
                  notify={notify}
                  refreshToken={backupRevision}
                  onChanged={() => {
                    void window.ws?.app
                      ?.info()
                      .then(setInfo)
                      .catch(() => {})
                  }}
                />
                <div className="w1-setrow w1-setstoragerow">
                  <span>存储位置</span>
                  <span className="w1-setstoragecopy">
                    <code className="w1-setpath" title={storage?.root ?? ''}>
                      {storage?.root ?? '读取中…'}
                    </code>
                    {storage && storage.source !== 'default' ? (
                      <i className="w1-setstoragesrc">
                        {storage.source === 'env' ? '由 WS_DATA_DIR 指定' : '已自定义'}
                      </i>
                    ) : null}
                  </span>
                  <span className="w1-setstorageacts">
                    <button
                      type="button"
                      className="w1-setbtn"
                      disabled={storageBusy || !storage || storage.locked}
                      onClick={pickStorage}
                    >
                      {storage?.pending ? '重新选择' : '更改'}
                    </button>
                    {storage?.pending ? (
                      <button
                        type="button"
                        className="w1-setbtn"
                        disabled={storageBusy}
                        onClick={cancelStorage}
                      >
                        取消更换
                      </button>
                    ) : null}
                  </span>
                </div>
                {storage?.pending ? (
                  <p className="w1-setstoragenote">
                    重启后迁移到 <code>{storage.pending}</code>
                    ：先复制并校验，成功后才切换并删除原目录。
                  </p>
                ) : (
                  <p className="w1-setstoragenote">
                    数据、插件、备份与 Codex 隔离配置都在这个根目录下；便携版默认在程序同级目录。
                  </p>
                )}
                {storage?.lastError ? (
                  <p className="w1-setstoragenote warn">{storage.lastError}</p>
                ) : null}
              </section>
            </>
          ) : (
            <CapabilityPanel notify={notify} />
          )}
        </div>

        <footer className="w1-scheadfoot">
          当前版本 v{info?.version ?? __APP_VERSION__} · 本地优先，不上传任何数据
        </footer>
      </m.div>
    </m.div>
  )
}
