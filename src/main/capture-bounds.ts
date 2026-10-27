export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** 捕获窗出现在光标所在显示器的上半部分，水平居中；工作区过小时收缩不越界。 */
export function captureWindowBounds(workArea: Rect, size: Size): Rect {
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  const x = workArea.x + Math.max(0, Math.round((workArea.width - width) / 2))
  const preferred = Math.round(workArea.height * 0.18)
  const y = workArea.y + Math.max(0, Math.min(workArea.height - height, preferred))
  return { x, y, width, height }
}
