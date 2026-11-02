import type { AuditLog } from '../db/audit'

/**
 * 设置类审计的统一写法：域固定 system、动作固定 settings、来源固定 ui。
 * 能力中心与插件源都有逐字相同的闭包，收敛到这里避免两处漂移。
 */
export function recordSettings(
  audit: AuditLog | undefined,
  title: string,
  detail: string,
  targetId?: string
): void {
  audit?.record({
    at: Date.now(),
    domain: 'system',
    action: 'settings',
    ...(targetId ? { targetId } : {}),
    title,
    source: 'ui',
    detail
  })
}
