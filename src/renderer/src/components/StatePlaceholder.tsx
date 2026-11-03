interface StatePlaceholderProps {
  /** loading 显示骨架条，empty 显示 ∅ 占位与操作建议 */
  kind: 'loading' | 'empty'
  title?: string
  hint?: string
  /** 演示用：占位条数量，默认 3 */
  rows?: number
}

/**
 * 列表在「首次读库未完成」时的占位。
 * 直接渲染空数组会让「还没有任务」闪一下再跳成真实内容，
 * 这里给出与真实行同高的骨架，避免布局跳动。
 */
export function StatePlaceholder({ kind, title, hint, rows = 3 }: StatePlaceholderProps) {
  if (kind === 'empty') {
    return (
      <div className="w1-todoempty" role="status">
        <b>{title ?? '这里还是空的。'}</b>
        {hint ? <span>{hint}</span> : null}
      </div>
    )
  }

  return (
    <div className="w1-statepane" role="status" aria-live="polite" aria-label="载入中">
      <span className="w1-statepanehead">// LOADING</span>
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 骨架条是定长静态占位，没有更稳定的键
        <span className="w1-stateline" key={index} style={{ width: `${88 - index * 12}%` }} />
      ))}
    </div>
  )
}
