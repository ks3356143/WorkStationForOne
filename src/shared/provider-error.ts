import type { AgentKind } from './ipc/agent'

export type ProviderErrorKind =
  | 'auth'
  | 'model'
  | 'context'
  | 'quota'
  | 'rate-limit'
  | 'overload'
  | 'protocol'
  | 'vision'
  | 'content'
  | 'request'

export interface ProviderErrorCopy {
  kind: ProviderErrorKind
  title: string
  hint: string
}

function protocolHint(target?: AgentKind): string {
  if (target === 'codex') {
    return 'Codex 只支持 OpenAI Responses 兼容地址（例如 https://api.deepseek.com）；不要填 Anthropic 的 /anthropic 地址。'
  }
  if (target === 'claude') {
    return 'Claude 使用 Anthropic 兼容地址（通常以 /anthropic 或 /v1 结尾）；不要填 OpenAI Responses 地址。'
  }
  return '检查 Base URL 与协议：Claude 用 Anthropic 兼容地址，Codex 用 OpenAI Responses 地址。'
}

const RULES: Array<{
  kind: ProviderErrorKind
  test: RegExp
  title: string
  hint: string | ((target?: AgentKind) => string)
}> = [
  {
    kind: 'protocol',
    test: /(?:unexpected status )?404[\s\S]{0,160}(?:\/responses|\/v1\/messages|\/messages)|(?:\/responses|\/v1\/messages)[\s\S]{0,120}404|(?:responses|messages)[^\n]{0,40}not found/i,
    title: '接口地址或协议不匹配',
    hint: protocolHint
  },
  {
    kind: 'auth',
    test: /not logged in|authentication[_ ]?(failed|fails|failure)|unauthorized|invalid (api )?(key|token)|auth[^\n]{0,20}(fail|expire)|(^|\D)(401|403)(\D|$)|凭据(被拒|失效)|未登录/i,
    title: 'Provider 凭据被拒绝',
    hint: '检查设置 → Agent Provider 里的 API Key、Base URL 与模型；如果继承 CLI，运行 claude login / codex login 后再试。'
  },
  {
    kind: 'quota',
    test: /insufficient[ _]?(quota|balance|funds)|quota[^\n]{0,20}(exceed|exhaust)|billing|payment required|(^|\D)402(\D|$)|余额不足|额度(不足|用尽)|欠费/i,
    title: '账户额度不足',
    hint: '检查 Provider 账户余额或配额，充值或更换 Key 后重试。'
  },
  {
    kind: 'model',
    test: /(model|模型)[^\n]{0,40}(not found|not exist|does not exist|unsupported|invalid|不存在|不可用|不支持)|unknown model|model_not_found|no such model/i,
    title: '模型不可用',
    hint: '检查 Provider 的模型名（注意大小写），或在设置里重新「拉取模型」后选择。'
  },
  {
    kind: 'context',
    test: /(maximum|max)[^\n]{0,30}(context|tokens?)|context[^\n]{0,30}(length|window)|too many tokens|token[^\n]{0,20}(exceed|limit)|上下文[^\n]{0,10}(超|长)|token[^\n]{0,10}超/i,
    title: '对话超出模型上下文',
    hint: '新开一个会话，或减少 @ 附件 / 图片后重试。'
  },
  {
    kind: 'vision',
    test: /(image|vision|多模态)[^\n]{0,40}(not supported|unsupported|not allowed|不支持|不允许)|不支持[^\n]{0,10}(图片|视觉)/i,
    title: '当前模型不支持图片',
    hint: '移除图片，或换一个支持视觉的模型。'
  },
  {
    kind: 'content',
    test: /content[._ -]?filter|moderation|safety|content policy|敏感|安全策略|被拦截/i,
    title: '内容被供应商拦截',
    hint: '调整措辞或移除相关附件后重试。'
  },
  {
    kind: 'overload',
    test: /overloaded|service unavailable|temporarily unavailable|(^|\D)503(\D|$)|繁忙|过载|服务不可用/i,
    title: '供应商服务暂时不可用',
    hint: '稍等片刻再重试；持续出现时检查供应商状态。'
  },
  {
    kind: 'rate-limit',
    test: /(^|\D)429(\D|$)|rate limit|too many requests|请求受限|限流/i,
    title: '请求太频繁',
    hint: '等一两分钟再试，不要连续重发。'
  }
]

/** 供应商 / 模型返回的错误文案；未命中返回 null，交给通用错误处理。 */
export function classifyProviderError(
  message: string,
  target?: AgentKind
): ProviderErrorCopy | null {
  const text = message.trim()
  if (!text) return null
  for (const rule of RULES) {
    if (!rule.test.test(text)) continue
    const hint = typeof rule.hint === 'string' ? rule.hint : rule.hint(target)
    return { kind: rule.kind, title: rule.title, hint }
  }
  return null
}

/** 只有状态码、没有正文时的兜底分类。 */
export function classifyProviderStatus(
  status: number,
  target?: AgentKind
): ProviderErrorCopy | null {
  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      title: 'Provider 凭据被拒绝',
      hint: '检查设置 → Agent Provider 里的 API Key、Base URL 与模型；如果继承 CLI，运行 claude login / codex login 后再试。'
    }
  }
  if (status === 402) {
    return {
      kind: 'quota',
      title: '账户额度不足',
      hint: '检查 Provider 账户余额或配额，充值或更换 Key 后重试。'
    }
  }
  if (status === 404) {
    return { kind: 'protocol', title: '接口地址或协议不匹配', hint: protocolHint(target) }
  }
  if (status === 429) {
    return { kind: 'rate-limit', title: '请求太频繁', hint: '等一两分钟再试，不要连续重发。' }
  }
  if (status === 400) {
    return {
      kind: 'request',
      title: '请求被供应商拒绝',
      hint: '检查模型名、请求参数与协议是否匹配；详情见下。'
    }
  }
  if (status === 503) {
    return {
      kind: 'overload',
      title: '供应商服务暂时不可用',
      hint: '稍等片刻再重试；持续出现时检查供应商状态。'
    }
  }
  if (status >= 500) {
    return {
      kind: 'overload',
      title: '供应商服务异常',
      hint: '这是供应商侧的问题，稍后重试；持续出现时检查服务状态。'
    }
  }
  return null
}
