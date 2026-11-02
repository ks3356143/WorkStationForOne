/**
 * 把底层报错翻译成「发生了什么 + 怎么办」。
 * 原则：不甩原始堆栈给用户，也不说「发生了错误」这种没有信息量的话。
 */
export type ErrorKind =
  | 'auth'
  | 'network'
  | 'timeout'
  | 'permission'
  | 'not-found'
  | 'disk'
  | 'cli-missing'
  | 'rate-limit'
  | 'unknown'

export interface FriendlyError {
  kind: ErrorKind
  /** 一句话说清发生了什么 */
  title: string
  /** 用户能做什么；没有建议时为空 */
  hint: string
  /** 原始信息，收进「详情」里，默认收起 */
  detail: string
}

interface Rule {
  kind: ErrorKind
  test: RegExp
  title: string
  hint: string
}

/** 顺序有意义：先匹配更具体的。 */
const RULES: Rule[] = [
  {
    kind: 'auth',
    test: /not logged in|authentication_failed|unauthorized|401|invalid api key|auth.*(fail|expire)|未登录|凭据被拒绝/i,
    title: '还没登录或凭据已失效',
    hint: '在终端运行一次 claude login（或 codex login），登录后重新发送即可。'
  },
  {
    kind: 'cli-missing',
    test: /未找到\s*(Claude|Codex)?\s*CLI|ENOENT|not recognized as an internal|找不到.*命令/i,
    title: '没有找到命令行工具',
    hint: '确认 claude / codex 已安装并能在终端直接运行，然后回到设置页的环境自检复查。'
  },
  {
    kind: 'permission',
    test: /EPERM|EACCES|permission denied|权限不足|拒绝访问/i,
    title: '没有写入权限',
    hint: '换一个可写的存储位置，或检查该目录是否被其他程序占用。'
  },
  {
    kind: 'disk',
    test: /ENOSPC|no space|空间不足|磁盘已满/i,
    title: '磁盘空间不足',
    hint: '清理目标磁盘后重试；存储位置可以在设置里换到空间更大的盘。'
  },
  {
    kind: 'timeout',
    test: /timeout|timed out|超时/i,
    title: '等待超时',
    hint: '网络慢或服务无响应。稍等片刻再试；如果反复超时，检查代理或换一个网络。'
  },
  {
    kind: 'rate-limit',
    test: /429|rate limit|too many requests|请求受限/i,
    title: '请求太频繁，被暂时限流',
    hint: '等一两分钟再试；不要在短时间内重复发送同一条消息。'
  },
  {
    kind: 'network',
    test: /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|fetch failed|getaddrinfo|无法连接/i,
    title: '连不上服务',
    hint: '检查网络或代理设置；离线时依赖联网的操作（市场、更新检查）会失败，其余功能不受影响。'
  },
  {
    kind: 'not-found',
    test: /404|not found|不存在|没有找到/i,
    title: '要找的东西不在了',
    hint: '可能已被移动或删除。刷新列表后再试。'
  }
]

/** 这些前缀是内部包装，展示前要剥掉，避免「无法加载X：无法加载Y：…」。 */
const WRAPPER =
  /^(无法|读取|加载|执行|保存|导入|导出|刷新|添加|移除|更新|连接|注册)[^：:]{0,24}[：:]\s*/

function stripWrappers(message: string): string {
  let text = message.trim()
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(WRAPPER, '')
    if (next === text) break
    text = next
  }
  return text
}

export function friendlyError(error: unknown, fallback = '操作没有完成'): FriendlyError {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const detail = raw.trim().slice(0, 600)
  const probe = stripWrappers(detail)

  for (const rule of RULES) {
    if (rule.test.test(detail) || rule.test.test(probe)) {
      return { kind: rule.kind, title: rule.title, hint: rule.hint, detail }
    }
  }
  return {
    kind: 'unknown',
    title: probe || fallback,
    hint: '如果反复出现，把下面的详情复制出来便于排查。',
    detail
  }
}

/** 单行版：适合提示条与卡片副标题。 */
export function friendlyMessage(error: unknown, fallback?: string): string {
  const friendly = friendlyError(error, fallback)
  return friendly.hint ? `${friendly.title}。${friendly.hint}` : friendly.title
}
