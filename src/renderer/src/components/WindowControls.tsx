import { useEffect, useState } from 'react'

const iconProps = {
  width: 12,
  height: 12,
  viewBox: '0 0 12 12',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.15,
  'aria-hidden': true
} as const

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.ws?.app
    if (!api) return
    let alive = true
    void api
      .windowState()
      .then((state) => {
        if (alive) setMaximized(state.maximized)
      })
      .catch(() => {
        // 窗口状态拿不到时按未最大化显示，不影响其它控制
      })
    const off = api.onWindowState((state) => setMaximized(state.maximized))
    return () => {
      alive = false
      off()
    }
  }, [])

  const api = typeof window === 'undefined' ? undefined : window.ws?.app

  return (
    <div className="w1-winctl" role="group" aria-label="窗口控制">
      <button
        type="button"
        className="w1-wcbtn"
        aria-label="最小化"
        title="最小化"
        onClick={() => void api?.windowMinimize()}
      >
        <svg {...iconProps}>
          <title>最小化</title>
          <path d="M3 6.5h6" />
        </svg>
      </button>
      <button
        type="button"
        className="w1-wcbtn"
        aria-label={maximized ? '还原窗口' : '最大化'}
        title={maximized ? '还原窗口' : '最大化'}
        onClick={() => void api?.windowToggleMaximize()}
      >
        {maximized ? (
          <svg {...iconProps}>
            <title>还原窗口</title>
            <path d="M4.4 3.3h4.3v4.3" />
            <rect x="3.2" y="4.4" width="4.4" height="4.4" />
          </svg>
        ) : (
          <svg {...iconProps}>
            <title>最大化</title>
            <rect x="3.2" y="3.2" width="5.6" height="5.6" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="w1-wcbtn close"
        aria-label="关闭"
        title="关闭"
        onClick={() => void api?.windowClose()}
      >
        <svg {...iconProps}>
          <title>关闭</title>
          <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
        </svg>
      </button>
    </div>
  )
}
