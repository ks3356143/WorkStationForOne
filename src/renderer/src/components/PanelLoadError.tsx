interface PanelLoadErrorProps {
  message: string
  onRetry: () => void
}

/** 面板首读失败的统一错误行：原因 + 重试，不再静默退回空态。 */
export function PanelLoadError({ message, onRetry }: PanelLoadErrorProps) {
  return (
    <div className="w1-loaderr" role="alert">
      <span>加载失败：{message}</span>
      <button type="button" className="w1-capmini" onClick={onRetry}>
        重试
      </button>
    </div>
  )
}
