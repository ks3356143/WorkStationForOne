import type { AgentKind, ProviderProfileRecord } from '../../../shared/ipc'

/** 当前目标激活的 Provider 标签；没有激活配置时返回 undefined（继承 CLI）。 */
export function activeProviderLabel(
  profiles: ProviderProfileRecord[],
  target: AgentKind
): string | undefined {
  const active = profiles.find((profile) => profile.active && profile.target === target)
  if (!active) return undefined
  return `${active.name} · ${active.model}`
}
