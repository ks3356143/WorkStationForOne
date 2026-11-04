/** 长会话默认只挂最近 60 条，顶部滚到附近再加载上一批。 */
export const INITIAL_THREAD_WINDOW = 60
export const THREAD_WINDOW_STEP = 60

export function threadWindowStart(total: number, visible: number): number {
  return Math.max(0, total - Math.max(0, visible))
}

/** 跳转到历史上某条消息时，窗口至少要扩到包含它（留 8 条上下文）。 */
export function threadWindowForMessage(total: number, visible: number, index: number): number {
  if (index < 0) return visible
  if (index >= threadWindowStart(total, visible)) return visible
  return Math.min(total, Math.max(visible, total - index + 8))
}
