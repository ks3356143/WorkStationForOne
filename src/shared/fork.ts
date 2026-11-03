export interface ForkSourceRef {
  agent: string
  resumeId?: string
}

export interface ForkMessageRef {
  id: string
  role: string
  /** Codex 回合 id；有它时可以从任意助手消息真分叉 */
  turnId?: string
}

/**
 * Claude 的 --fork-session 与 Codex 的 thread/fork 都从会话末尾复制，
 * 所以只有「最新一条助手回复」能真分叉；更早的消息只能复制应用内对话。
 */
export function canForkWithCli(
  source: ForkSourceRef,
  messages: readonly ForkMessageRef[],
  messageId: string
): boolean {
  if ((source.agent !== 'claude' && source.agent !== 'codex') || !source.resumeId) {
    return false
  }
  const selected = messages.find((message) => message.id === messageId)
  if (selected?.role !== 'assistant') return false
  if (messages.at(-1)?.id === messageId) return true
  return source.agent === 'codex' && Boolean(selected.turnId)
}
