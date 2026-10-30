import type { AgentMessageRecord } from '../../../shared/ipc'
import type { ChatMessage, ToolCall } from '../types'

/** 主进程消息记录 → 聊天行；导入历史保留只读标记。 */
export function toChatMessage(record: AgentMessageRecord): ChatMessage {
  const tools: ToolCall[] | undefined = record.tools?.map((tool) => ({ ...tool }))
  return {
    id: record.id,
    role: record.role,
    text: record.text,
    time: record.timeLabel,
    ...(record.error ? { error: true } : {}),
    ...(record.origin === 'import' ? { imported: true } : {}),
    ...(tools ? { tools } : {})
  }
}
