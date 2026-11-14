// 离线本地模型：只把会话内容发给回环地址上的 OpenAI 兼容端点做摘要。
// 抽样式摘要是同步兜底，这里失败一律返回 null，绝不阻塞或破坏回合。

import type { LocalModelConfig } from '../../shared/ipc'

export type { LocalModelConfig }

export interface LocalSummaryInput {
  baseUrl: string
  model: string
  turns: Array<{ role: 'user' | 'assistant'; text: string }>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** 只接受回环地址的 http(s) 端点；其它主机一律拒绝（离线语义）。 */
export function isLocalEndpoint(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
}

export function buildLocalSummaryPrompt(
  turns: Array<{ role: 'user' | 'assistant'; text: string }>,
  maxChars = 12_000
): string {
  const lines = turns.map((turn) => `${turn.role === 'user' ? '用户' : '助手'}：${turn.text}`)
  const joined = lines.join('\n')
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined
}

/** 成功返回摘要文本；未启用 / 非本机 / 请求失败 / 空结果都返回 null。 */
export async function summarizeTurnsWithLocal(input: LocalSummaryInput): Promise<string | null> {
  if (!input.model.trim() || !isLocalEndpoint(input.baseUrl)) return null
  const fetchImpl = input.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  if (!fetchImpl) return null
  const body = buildLocalSummaryPrompt(input.turns)
  if (!body.trim()) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 8000)
  try {
    const response = await fetchImpl(
      `${input.baseUrl.trim().replace(/\/+$/, '')}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        // 回环端点若 30x 跳转会把整段会话转发到远端，直接拒绝重定向。
        redirect: 'error',
        body: JSON.stringify({
          model: input.model,
          messages: [
            {
              role: 'system',
              content: '把下面的多轮会话压缩成中文要点，保留用户意图、已确认的结论与未完成事项。'
            },
            { role: 'user', content: body }
          ],
          max_tokens: 512,
          stream: false
        })
      }
    )
    if (!response.ok) return null
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') return null
    const trimmed = content.trim()
    return trimmed ? trimmed.slice(0, 8000) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
