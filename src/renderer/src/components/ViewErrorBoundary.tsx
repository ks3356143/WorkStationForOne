import { Component, type ErrorInfo, type ReactNode } from 'react'
import { friendlyError } from '../lib/errors'

interface Props {
  children: ReactNode
  /** 视图名，用于文案「任务视图出了点问题」 */
  scope: string
  /** 切换视图等操作后重置边界 */
  resetKey?: string
  notify?: (text: string) => void
}

interface State {
  error: Error | null
}

/**
 * 视图级错误边界：单个视图崩溃时只坏这一块，
 * 左侧导航、状态栏与其它视图仍可用。
 */
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[view:${this.props.scope}] 渲染失败`, error, info.componentStack)
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  private retry = () => {
    this.setState({ error: null })
  }

  private copyDetail = () => {
    const detail = this.state.error?.stack ?? this.state.error?.message ?? ''
    void navigator.clipboard?.writeText(detail).then(
      () => this.props.notify?.('错误详情已复制'),
      () => this.props.notify?.('复制失败，请手动选中文本')
    )
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const friendly = friendlyError(error, `${this.props.scope}视图出了点问题`)
    return (
      <div className="w1-viewerror" role="alert">
        <span className="w1-viewerroricon" aria-hidden="true">
          !
        </span>
        <b>{friendly.title}</b>
        {friendly.hint ? <p>{friendly.hint}</p> : null}
        <p className="w1-viewerrorscope">{this.props.scope}视图暂时无法显示，其它视图不受影响。</p>
        <div className="w1-viewerroracts">
          <button type="button" className="w1-pb pri" onClick={this.retry}>
            再试一次
          </button>
          <button type="button" className="w1-pb" onClick={this.copyDetail}>
            复制详情
          </button>
        </div>
        {friendly.detail ? (
          <details className="w1-viewerrordetail">
            <summary>技术细节</summary>
            <pre>{friendly.detail}</pre>
          </details>
        ) : null}
      </div>
    )
  }
}
