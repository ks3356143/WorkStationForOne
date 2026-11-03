import { useCallback, useEffect, useState } from 'react'
import type { BackupEntry, RestoreStateInfo } from '../../../../shared/ipc'

interface BackupRestoreProps {
  notify: (text: string) => void
  /** 立即备份后让列表重新读取 */
  refreshToken: number
  /** 恢复请求会新增一份安全快照，通知设置页刷新备份份数 */
  onChanged: () => void
}

function ipcMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : ''
  const stripped = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').trim()
  return stripped || fallback
}

function formatAt(at: number): string {
  if (!at) return '未知时间'
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function statusCopy(status: RestoreStateInfo): { kind: string; title: string; body: string } {
  if (status.status === 'pending') {
    return {
      kind: 'pending',
      title: '恢复已排好',
      body: `重启后会用 ${status.backup} 替换当前数据库；恢复前快照 ${status.safety || '—'}，失败会自动回滚。`
    }
  }
  if (status.status === 'applying') {
    return {
      kind: 'pending',
      title: '恢复正在进行',
      body: '如果启动被中断，下次启动会自动回滚到恢复前的数据库。'
    }
  }
  if (status.status === 'applied') {
    return {
      kind: 'ok',
      title: '已从备份恢复',
      body: `${status.backup} · ${formatAt(status.at)}${status.safety ? `；恢复前快照 ${status.safety}` : ''}`
    }
  }
  return {
    kind: 'failed',
    title: '恢复没有完成',
    body: `${status.error || '未知原因'}。当前数据库保持不变。`
  }
}

export function BackupRestore({ notify, refreshToken, onChanged }: BackupRestoreProps) {
  const [entries, setEntries] = useState<BackupEntry[]>([])
  const [status, setStatus] = useState<RestoreStateInfo | null>(null)
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listError, setListError] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [relaunching, setRelaunching] = useState(false)

  const load = useCallback(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.ws?.app
    if (!bridge?.listBackups || !bridge.restoreStatus) {
      setListState('error')
      setListError('没有连接到主进程，无法读取备份')
      return
    }
    setListState('loading')
    setListError('')
    void Promise.all([bridge.listBackups(), bridge.restoreStatus()])
      .then(([list, next]) => {
        setEntries(list.entries)
        setStatus(next)
        setListState('ready')
      })
      .catch((error: unknown) => {
        setListState('error')
        setListError(ipcMessage(error, '读取备份失败'))
      })
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken 是外部触发的重读信号
  useEffect(() => {
    load()
  }, [load, refreshToken])

  const doRestore = (entry: BackupEntry) => {
    const bridge = typeof window === 'undefined' ? undefined : window.ws?.app
    if (!bridge?.restoreBackup || busyName || relaunching) return
    setBusyName(entry.name)
    setActionError('')
    void bridge
      .restoreBackup(entry.name)
      .then((result) => {
        setConfirming(null)
        setStatus({
          status: 'pending',
          backup: result.backup,
          at: Date.now(),
          error: '',
          safety: result.safety
        })
        notify('已安排恢复，重启应用后生效')
        onChanged()
        load()
        return bridge.restoreStatus().then(setStatus)
      })
      .catch((error: unknown) => {
        setConfirming(null)
        setActionError(ipcMessage(error, '恢复失败'))
        notify(ipcMessage(error, '恢复失败'))
      })
      .finally(() => setBusyName(null))
  }

  const relaunch = () => {
    const bridge = typeof window === 'undefined' ? undefined : window.ws?.app
    if (!bridge?.relaunch || relaunching) return
    setRelaunching(true)
    void bridge.relaunch().catch((error: unknown) => {
      setRelaunching(false)
      setActionError(ipcMessage(error, '重启失败'))
    })
  }

  const pending = status?.status === 'pending' || status?.status === 'applying'
  const copy = status && status.status !== 'none' ? statusCopy(status) : null

  return (
    <div className="w1-backups" role="group" aria-label="备份与恢复">
      <div className="w1-backuphead">
        <span className="w1-eyebrow">// 快照</span>
        <span className="w1-backupcount">
          {listState === 'ready'
            ? `${entries.length} 份`
            : listState === 'loading'
              ? '读取中…'
              : '—'}
        </span>
        <button
          type="button"
          className="w1-backuprefresh"
          disabled={listState === 'loading'}
          onClick={load}
        >
          刷新
        </button>
      </div>

      {copy ? (
        <div
          className={`w1-backupstate ${copy.kind}`}
          role={copy.kind === 'failed' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span className="w1-backupstatedot" />
          <span className="w1-backupstatecopy">
            <b>{copy.title}</b>
            <p>{copy.body}</p>
          </span>
          {pending ? (
            <button
              type="button"
              className="w1-backupbtn pri"
              disabled={relaunching}
              onClick={relaunch}
            >
              {relaunching ? '重启中…' : '立即重启'}
            </button>
          ) : null}
        </div>
      ) : null}

      {actionError ? (
        <div className="w1-backuperror" role="alert">
          <span>{actionError}</span>
          <button type="button" className="w1-backupbtn" onClick={() => setActionError('')}>
            知道了
          </button>
        </div>
      ) : null}

      {listState === 'loading' ? (
        <div className="w1-backupthings" role="status" aria-label="正在读取备份">
          <span className="w1-backupskel" />
          <span className="w1-backupskel" />
          <span className="w1-backupskel" />
        </div>
      ) : listState === 'error' ? (
        <div className="w1-backuperror" role="alert">
          <span>{listError}</span>
          <button type="button" className="w1-backupbtn" onClick={load}>
            重试
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p className="w1-backupempty">
          还没有备份。每天首次启动会自动生成一份，也可以点「立即备份」。
        </p>
      ) : (
        <div className="w1-backuplist">
          {entries.map((entry) => (
            <div className="w1-backuprow" key={entry.name}>
              <div className="w1-backupmain">
                <b>
                  {formatAt(entry.at)}
                  {entry.safety ? <i className="w1-backupbadge safety">恢复前快照</i> : null}
                </b>
                <span title={entry.name}>{entry.name}</span>
              </div>
              <span className="w1-backupmeta">{formatBytes(entry.bytes)}</span>
              {confirming === entry.name ? null : (
                <button
                  type="button"
                  className="w1-backupbtn"
                  disabled={busyName !== null || pending || relaunching}
                  onClick={() => {
                    setConfirming(entry.name)
                    setActionError('')
                  }}
                >
                  恢复
                </button>
              )}
              {confirming === entry.name ? (
                <div
                  className="w1-backupconfirm"
                  role="group"
                  aria-label={`确认恢复 ${entry.name}`}
                >
                  <span>
                    会用这份备份替换当前数据库。恢复前会先留快照，失败自动回滚，完成后需要重启。
                  </span>
                  <button
                    type="button"
                    className="w1-backupbtn danger"
                    disabled={busyName !== null}
                    onClick={() => doRestore(entry)}
                  >
                    {busyName === entry.name ? '校验中…' : '确认恢复'}
                  </button>
                  <button
                    type="button"
                    className="w1-backupbtn"
                    disabled={busyName !== null}
                    onClick={() => setConfirming(null)}
                  >
                    取消
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
