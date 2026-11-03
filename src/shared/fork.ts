export interface ForkSourceRef {
  agent: string
  resumeId?: string
}

export interface ForkMessageRef {
  id: string
  role: string
}

/**
 * Claude 的 --fork-session 只能从 CLI 会话末尾复制，所以只有「最新一条助手回复」
 * 能真分叉；更早的消息只能复制应用内对话，不能承诺模型上下文也回到那一刻。
 */
export function canForkWithCli(
  source: ForkSourceRef,
  messages: readonly ForkMessageRef[],
  messageId: string
): boolean {
  if (source.agent !== 'claude' || !source.resumeId) return false
  const last = messages.at(-1)
  return Boolean(last && last.id === messageId && last.role === 'assistant')
}
