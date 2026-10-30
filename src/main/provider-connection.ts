import type { ProviderTarget, ProviderTestResult, ProviderWireApi } from '../shared/ipc'

const DEFAULT_TIMEOUT_MS = 12_000
const MAX_ERROR = 180

export interface ProviderConnectionInput {
  target: ProviderTarget
  wireApi: ProviderWireApi
  baseUrl: string
  model: string
  token: string
}

export interface ProviderConnectionOptions {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_ERROR ? `${flat.slice(0, MAX_ERROR - 1)}…` : flat
}

function errorDetail(text: string): string {
  try {
    const payload = asRecord(JSON.parse(text))
    const error = asRecord(payload?.error)
    const message = error?.message ?? payload?.message
    if (typeof message === 'string' && message.trim()) return clip(message)
  } catch {
    // fall through to text
  }
  return clip(text)
}

function statusLabel(status: number): string {
  if (status === 401 || status === 403) return '凭据被拒绝'
  if (status === 404) return '端点不存在'
  if (status === 429) return '请求受限'
  if (status >= 500) return '供应商服务异常'
  return '请求被拒绝'
}

function urlFor(target: ProviderTarget, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return target === 'codex' ? `${base}/responses` : `${base}/v1/messages`
}

function requestFor(input: ProviderConnectionInput): {
  url: string
  body: unknown
  headers: Record<string, string>
} {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.token}`,
    'Content-Type': 'application/json'
  }
  if (input.target === 'codex') {
    return {
      url: urlFor('codex', input.baseUrl),
      headers,
      body: {
        model: input.model,
        input: 'Reply with exactly OK. Do not use any tools.',
        max_output_tokens: 8,
        stream: false
      }
    }
  }
  headers['anthropic-version'] = '2023-06-01'
  return {
    url: urlFor('claude', input.baseUrl),
    headers,
    body: {
      model: input.model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with exactly OK. Do not use any tools.' }]
    }
  }
}

/**
 * 只做一次最小 HTTP 探测，验证 Base URL、模型与凭据；不启动 CLI，不执行工具。
 * 返回的 message 会进入渲染层，因此必须去掉 token。
 */
export async function testProviderConnection(
  input: ProviderConnectionInput,
  options: ProviderConnectionOptions = {}
): Promise<ProviderTestResult> {
  if (input.target === 'codex' && input.wireApi !== 'responses') {
    return { ok: false, latencyMs: 0, message: 'Codex 当前只支持 Responses 协议' }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  const { url, headers, body } = requestFor(input)
  const redact = (value: string) =>
    input.token ? value.split(input.token).join('[已隐藏]') : value

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await response.text()
    const latencyMs = Math.max(0, Date.now() - started)
    if (!response.ok) {
      const detail = redact(errorDetail(text))
      return {
        ok: false,
        status: response.status,
        latencyMs,
        message: `${statusLabel(response.status)}（${response.status}）${detail ? `：${detail}` : ''}`
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        message: '端点返回了非 JSON 响应，可能不是兼容接口'
      }
    }
    if (!asRecord(parsed)) {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        message: '端点返回了非 JSON 对象，可能不是兼容接口'
      }
    }
    return { ok: true, status: response.status, latencyMs, message: '连接正常' }
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - started)
    const name = asRecord(error)?.name
    if (controller.signal.aborted || name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, latencyMs, message: `连接超时（${Math.round(timeoutMs / 1000)} 秒）` }
    }
    const errorRecord = asRecord(error)
    const cause = asRecord(errorRecord?.cause)
    const code = asString(cause?.code) ?? asString(errorRecord?.code)
    if (code === 'ECONNREFUSED') {
      return { ok: false, latencyMs, message: '连接被拒绝，请检查 Base URL 与端口' }
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return { ok: false, latencyMs, message: '找不到主机，请检查 Base URL' }
    }
    if (
      code === 'CERT_HAS_EXPIRED' ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ) {
      return { ok: false, latencyMs, message: 'TLS 证书校验失败' }
    }
    if (code === 'ECONNRESET') {
      return { ok: false, latencyMs, message: '连接被重置，请稍后重试' }
    }
    const message = error instanceof Error ? error.message : String(error)
    const detail = message === 'fetch failed' ? asString(cause?.message) : message
    return {
      ok: false,
      latencyMs,
      message: `连接失败，请检查网络与 Base URL${detail ? `：${redact(clip(detail))}` : ''}`
    }
  } finally {
    clearTimeout(timer)
  }
}
