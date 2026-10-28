import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import type { AppInfo } from '../../../shared/ipc'
import { DURATION, EASE_OUT } from '../lib/motion'
import { skinLabel, themeLabel } from '../lib/theme'
import { useWorkstation } from '../store/useWorkstation'

interface SettingsSheetProps {
  onClose: () => void
  notify: (text: string) => void
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

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    root?.focus()
    void window.ws?.app
      ?.info()
      .then(setInfo)
      .catch(() => setInfo(null))
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [])

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
