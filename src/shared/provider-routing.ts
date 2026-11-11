// Provider 路由：错误驱动降级时选备用配置。纯函数，主进程与单测共用。
// 降级只作为「用户显式换备用重试」的候选来源，不自动重试副作用回合。

export interface RoutingCandidate {
  id: string
  /** 越小越优先作为备用 */
  priority: number
  createdAt: number
}

export function selectFallback(
  candidates: RoutingCandidate[],
  activeId: string | null
): RoutingCandidate | null {
  const rest = candidates
    .filter((c) => c.id !== activeId)
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)
  return rest[0] ?? null
}
