import { useEffect, useRef } from 'react'
import { m } from 'motion/react'
import { SHORTCUT_GROUPS } from '../lib/shortcuts'
import { DURATION, EASE_OUT } from '../lib/motion'

interface ShortcutSheetProps {
  onClose: () => void
}

export function ShortcutSheet({ onClose }: ShortcutSheetProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    root?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [])

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
        className="w1-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label="键盘快捷键"
        tabIndex={-1}
        initial={{ opacity: 0, transform: 'translateY(12px) scale(0.99)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)', transition: { duration: DURATION.fast } }}
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
            <em>//</em>键盘速查
          </b>
          <span className="w1-scheadkeys">
            <kbd>Esc</kbd> 关闭
          </span>
        </header>

        <div className="w1-sheetgrid">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="w1-sheetgroup" aria-label={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.items.map((item) => (
                  <div key={`${group.title}-${item.keys.join('+')}`} className="w1-sheetrow">
                    <dt>
                      {item.keys.map((key, index) => (
                        <span key={key} className="w1-sheetkeys">
                          {index > 0 ? (
                            <i aria-hidden="true">{item.combine === 'or' ? '/' : '+'}</i>
                          ) : null}
                          <kbd>{key}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{item.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <footer className="w1-scheadfoot">
          输入框内 <kbd>?</kbd> 是普通问号，不会打开本表
        </footer>
      </m.div>
    </m.div>
  )
}
