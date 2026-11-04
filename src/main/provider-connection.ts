import type {
  ProviderModelsResult,
  ProviderTarget,
  ProviderTestResult,
  ProviderWireApi
} from '../shared/ipc'
import {
  providerAuthScheme,
  providerEndpoint,
  type ProviderAuthScheme
} from '../shared/provider-profile'
import { classifyProviderError, classifyProviderStatus } from '../shared/provider-error'

const DEFAULT_TIMEOUT_MS = 12_000
const MAX_ERROR = 180

export interface ProviderConnectionInput {
  target: ProviderTarget
  wireApi: ProviderWireApi
  baseUrl: string
  model: string
  token: string
  /** 测试缝：省略时按 Base URL 推断 */
  authScheme?: ProviderAuthScheme
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

/** 设置页要同时显示原因和下一步，允许比详情更长。 */
function clipMessage(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > 360 ? `${flat.slice(0, 359)}…` : flat
}

function failureMessage(status: number, detail: string, target: ProviderTarget): string {
  const copy = classifyProviderError(detail, target) ?? classifyProviderStatus(status, target)
  const head = copy?.title ?? statusLabel(status)
  const base = `${head}（${status}）${detail ? `：${detail}` : ''}`
  return clipMessage(`${base}${copy?.hint ? `。${copy.hint}` : ''}`)
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

interface AuthInput {
  target: ProviderTarget
  baseUrl: string
  token: string
  authScheme?: ProviderAuthScheme
}

/** 首选鉴权头在前；401/403 时由调用方尝试另一种，兼容两类 Anthropic 端点。 */
function authHeaders(input: AuthInput): Array<Record<string, string>> {
  if (input.target === 'codex') return [{ Authorization: `Bearer ${input.token}` }]
  const scheme = input.authScheme ?? providerAuthScheme(input.target, input.baseUrl)
  const apiKey = { 'x-api-key': input.token, 'anthropic-version': '2023-06-01' }
  const bearer = {
    Authorization: `Bearer ${input.token}`,
    'anthropic-version': '2023-06-01'
  }
  return scheme === 'api-key' ? [apiKey, bearer] : [bearer, apiKey]
}

function requestFor(input: ProviderConnectionInput): {
  url: string
  body: unknown
  headersList: Array<Record<string, string>>
} {
  const headersList = authHeaders(input).map((headers) => ({
    'Content-Type': 'application/json',
    ...headers
  }))
  if (input.target === 'codex') {
    return {
      url: providerEndpoint('codex', input.baseUrl),
      headersList,
      body: {
        model: input.model,
        input: 'Reply with exactly OK. Do not use any tools.',
        max_output_tokens: 8,
        stream: false
      }
    }
  }
  return {
    url: providerEndpoint('claude', input.baseUrl),
    headersList,
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
export interface ProviderModelsConnectionInput {
  target: ProviderTarget
  wireApi: ProviderWireApi
  baseUrl: string
  token: string
  /** 测试缝：省略时按 Base URL 推断 */
  authScheme?: ProviderAuthScheme
}

function modelsUrls(target: ProviderTarget, baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, '')
  if (target === 'claude') {
    return [base.toLowerCase().endsWith('/v1') ? `${base}/models` : `${base}/v1/models`]
  }
  const urls = [`${base}/models`]
  if (!/\/v1$/i.test(base)) urls.push(`${base}/v1/models`)
  return urls
}

function parseModels(text: string): { models: string[]; message?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { models: [], message: '端点返回了非 JSON 响应，可能不是兼容接口' }
  }
  const record = asRecord(parsed)
  if (!record) return { models: [], message: '端点返回了非 JSON 对象，可能不是兼容接口' }
  const raw = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : []
  const models: string[] = []
  for (const item of raw) {
    const id = asString(asRecord(item)?.id) ?? asString(item)
    if (id && !models.includes(id)) models.push(id)
    if (models.length >= 200) break
  }
  if (models.length === 0)
    return {
      models: [],
      message:
        '端点没有返回模型列表。确认 Base URL 是否指向兼容接口；有些端点不支持 /models，可手动填写模型名。'
    }
  return { models }
}

/**
 * 拉取 OpenAI / Anthropic 兼容接口的模型列表。只在主进程发请求；
 * token 不进入返回值或错误信息。根路径先试 /models，404 再试 /v1/models。
 */
export async function listProviderModels(
  input: ProviderModelsConnectionInput,
  options: ProviderConnectionOptions = {}
): Promise<ProviderModelsResult> {
  if (input.target === 'codex' && input.wireApi !== 'responses') {
    return { ok: false, models: [], latencyMs: 0, message: 'Codex 当前只支持 Responses 协议' }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  const redact = (value: string) =>
    input.token ? value.split(input.token).join('[已隐藏]') : value
  let lastStatus: number | undefined
  let lastDetail = ''

  try {
    for (const url of modelsUrls(input.target, input.baseUrl)) {
      const headersList = authHeaders(input)
      for (let index = 0; index < headersList.length; index += 1) {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json', ...headersList[index] },
          signal: controller.signal
        })
        const text = await response.text()
        const latencyMs = Math.max(0, Date.now() - started)
        if (!response.ok) {
          lastStatus = response.status
          lastDetail = redact(errorDetail(text))
          if (response.status === 401 || response.status === 403) {
            if (index < headersList.length - 1) continue
            break
          }
          if (response.status === 404 || response.status === 405) break
          return {
            ok: false,
            models: [],
            status: response.status,
            latencyMs,
            message: failureMessage(response.status, lastDetail, input.target)
          }
        }
        const parsed = parseModels(text)
        if (parsed.message) {
          return {
            ok: false,
            models: [],
            status: response.status,
            latencyMs,
            message: parsed.message
          }
        }
        return {
          ok: true,
          models: parsed.models,
          status: response.status,
          latencyMs,
          message: `找到 ${parsed.models.length} 个模型`
        }
      }
    }
    return {
      ok: false,
      models: [],
      ...(lastStatus ? { status: lastStatus } : {}),
      latencyMs: Math.max(0, Date.now() - started),
      message: lastStatus
        ? failureMessage(lastStatus, lastDetail, input.target)
        : '没有可用的模型端点'
    }
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - started)
    const name = asRecord(error)?.name
    if (controller.signal.aborted || name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        models: [],
        latencyMs,
        message: `连接超时（${Math.round(timeoutMs / 1000)} 秒）`
      }
    }
    const errorRecord = asRecord(error)
    const cause = asRecord(errorRecord?.cause)
    const code = asString(cause?.code) ?? asString(errorRecord?.code)
    if (code === 'ECONNREFUSED') {
      return { ok: false, models: [], latencyMs, message: '连接被拒绝，请检查 Base URL 与端口' }
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return { ok: false, models: [], latencyMs, message: '找不到主机，请检查 Base URL' }
    }
    const message = error instanceof Error ? error.message : String(error)
    const detail = message === 'fetch failed' ? asString(cause?.message) : message
    return {
      ok: false,
      models: [],
      latencyMs,
      message: `连接失败，请检查网络与 Base URL${detail ? `：${redact(clip(detail))}` : ''}`
    }
  } finally {
    clearTimeout(timer)
  }
}

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
  const { url, headersList, body } = requestFor(input)
  const redact = (value: string) =>
    input.token ? value.split(input.token).join('[已隐藏]') : value
  let lastStatus: number | undefined
  let lastDetail = ''

  try {
    for (let index = 0; index < headersList.length; index += 1) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: headersList[index],
        body: JSON.stringify(body),
        signal: controller.signal
      })
      const text = await response.text()
      const latencyMs = Math.max(0, Date.now() - started)
      if (!response.ok) {
        lastStatus = response.status
        lastDetail = redact(errorDetail(text))
        // 鉴权方式可能猜错：只在凭据被拒时换另一种头重试
        if (
          (response.status === 401 || response.status === 403) &&
          index < headersList.length - 1
        ) {
          continue
        }
        return {
          ok: false,
          status: response.status,
          latencyMs,
          message: failureMessage(response.status, lastDetail, input.target)
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
    }
    return {
      ok: false,
      ...(lastStatus ? { status: lastStatus } : {}),
      latencyMs: Math.max(0, Date.now() - started),
      message: lastStatus ? failureMessage(lastStatus, lastDetail, input.target) : '没有可用的端点'
    }
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
