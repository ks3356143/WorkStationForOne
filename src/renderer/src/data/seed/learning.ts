import { addDaysKey, dateKey } from '../../../../shared/date-key'
import type { LearningItem } from '../../types'

interface SeedCard {
  id: string
  subject: string
  title: string
  source: string
  notes: string
  dayOffset: number
}

const ENGLISH: SeedCard[] = [
  {
    id: 'en-analyze',
    subject: '英语二',
    title: 'analyze',
    source: '2019 阅读 Text 3',
    notes: 'v. 分析；剖析。analyze the data 分析数据。名词 analysis，形容词 analytical。',
    dayOffset: 0
  },
  {
    id: 'en-significant',
    subject: '英语二',
    title: 'significant',
    source: '2020 阅读 Text 1',
    notes:
      'adj. 显著的；重要的。a significant increase 明显增长。副词 significantly 常修饰比较级。',
    dayOffset: 0
  },
  {
    id: 'en-consequence',
    subject: '英语二',
    title: 'consequence',
    source: '2018 完形',
    notes: 'n. 后果；结果。as a consequence of 由于。形容词 consequent，副词 consequently 因此。',
    dayOffset: 0
  },
  {
    id: 'en-approach',
    subject: '英语二',
    title: 'approach',
    source: '2021 阅读 Text 2',
    notes: 'n. 方法；途径 v. 接近。an approach to doing sth 做某事的方法，to 是介词。',
    dayOffset: 1
  },
  {
    id: 'en-maintain',
    subject: '英语二',
    title: 'maintain',
    source: '2017 阅读 Text 4',
    notes: 'v. 维持；坚持认为。maintain that… 坚持主张。名词 maintenance 维护。',
    dayOffset: 2
  },
  {
    id: 'en-consume',
    subject: '英语二',
    title: 'consume',
    source: '2020 阅读 Text 3',
    notes: 'v. 消耗；消费。consume energy 消耗能量。名词 consumer 消费者、consumption 消费。',
    dayOffset: 3
  },
  {
    id: 'en-decline',
    subject: '英语二',
    title: 'decline',
    source: '2019 阅读 Text 1',
    notes: 'v./n. 下降；婉拒。decline an offer 谢绝邀约。反义 on the rise 上升。',
    dayOffset: 0
  },
  {
    id: 'en-evidence',
    subject: '英语二',
    title: 'evidence',
    source: '2018 阅读 Text 2',
    notes:
      'n. 证据（不可数）。evidence for/of sth，用 much/little 修饰而非 many。形容词 evident 明显的。',
    dayOffset: 4
  },
  {
    id: 'en-factor',
    subject: '英语二',
    title: 'factor',
    source: '2021 完形',
    notes: 'n. 因素。a key factor in… 关键因素。注意与 fact 区分，factor 强调成因。',
    dayOffset: 5
  },
  {
    id: 'en-indicate',
    subject: '英语二',
    title: 'indicate',
    source: '2022 阅读 Text 2',
    notes: 'v. 表明；指示。research indicates that… 研究表明。名词 indication 迹象。',
    dayOffset: 6
  },
  {
    id: 'en-involve',
    subject: '英语二',
    title: 'involve',
    source: '2017 完形',
    notes: 'v. 涉及；使参与。be involved in 参与。名词 involvement 卷入程度。',
    dayOffset: 7
  },
  {
    id: 'en-issue',
    subject: '英语二',
    title: 'issue',
    source: '2020 阅读 Text 4',
    notes:
      'n. 议题；（刊物）期号 v. 发布。the issue of climate 气候议题，issue a statement 发布声明。',
    dayOffset: 8
  },
  {
    id: 'en-occur',
    subject: '英语二',
    title: 'occur',
    source: '2019 阅读 Text 4',
    notes: 'v. 发生；想到。It occurs to sb that… 某人想到。名词 occurrence，双 r 双 c。',
    dayOffset: 9
  },
  {
    id: 'en-require',
    subject: '英语二',
    title: 'require',
    source: '2021 阅读 Text 1',
    notes: 'v. 需要；要求。require sb to do sth。名词 requirement 要求。',
    dayOffset: 10
  },
  {
    id: 'en-respond',
    subject: '英语二',
    title: 'respond',
    source: '2018 阅读 Text 3',
    notes: 'v. 回应；反应。respond to sth 对……作出反应。名词 response，形容词 responsive。',
    dayOffset: 11
  },
  {
    id: 'en-tend',
    subject: '英语二',
    title: 'tend',
    source: '2022 完形',
    notes: 'v. 倾向于；照料。tend to do sth 往往。名词 tendency 趋势。',
    dayOffset: 12
  }
]

const INTERNET: SeedCard[] = [
  {
    id: 'net-http',
    subject: '互联网',
    title: 'HTTP',
    source: '网络基础',
    notes:
      '超文本传输协议，请求-响应模型。无状态，靠 Cookie/Token 维持会话。HTTP/2 多路复用，HTTP/3 走 QUIC。',
    dayOffset: 0
  },
  {
    id: 'net-dns',
    subject: '互联网',
    title: 'DNS',
    source: '网络基础',
    notes:
      '域名到 IP 的分布式解析系统。递归解析器逐级询问根 → 顶级域 → 权威服务器；结果按 TTL 缓存。',
    dayOffset: 1
  },
  {
    id: 'net-tls',
    subject: '互联网',
    title: 'TLS',
    source: '网络基础',
    notes:
      '为传输层加密。握手协商协议版本与密码套件，用非对称交换密钥，之后走对称加密；证书链验证身份。',
    dayOffset: 2
  },
  {
    id: 'net-cdn',
    subject: '互联网',
    title: 'CDN',
    source: '系统设计',
    notes:
      '内容分发网络，把静态资源缓存到离用户近的边缘节点。靠 DNS 调度或 Anycast 就近接入，回源拉取并预热。',
    dayOffset: 3
  },
  {
    id: 'net-cache',
    subject: '互联网',
    title: '缓存',
    source: '系统设计',
    notes:
      '常见策略 Cache-Aside：读时未命中回源并回填，写时更新库再删缓存。要防穿透（空值缓存/布隆过滤器）、击穿（互斥重建）与雪崩（过期时间加抖动）。',
    dayOffset: 4
  },
  {
    id: 'net-idempotent',
    subject: '互联网',
    title: '幂等',
    source: '系统设计',
    notes:
      '同一请求执行多次与执行一次结果相同。GET/PUT/DELETE 天然幂等，POST 不幂等；支付类接口用幂等键去重。',
    dayOffset: 5
  },
  {
    id: 'net-ratelimit',
    subject: '互联网',
    title: '限流',
    source: '系统设计',
    notes:
      '保护下游的常用算法：固定窗口、滑动窗口、漏桶（恒定速率）、令牌桶（允许突发）。分布式限流依赖 Redis + Lua 保证原子性。',
    dayOffset: 6
  },
  {
    id: 'net-cap',
    subject: '互联网',
    title: 'CAP',
    source: '系统设计',
    notes:
      '一致性、可用性、分区容错三者不可兼得。网络分区无法避免，实际是在 C 与 A 之间取舍：CP 如 ZooKeeper，AP 如 Cassandra。',
    dayOffset: 0
  }
]

export function createSeedLearning(): LearningItem[] {
  const today = dateKey()
  return [...ENGLISH, ...INTERNET].map((card) => ({
    id: card.id,
    subject: card.subject,
    title: card.title,
    source: card.source,
    notes: card.notes,
    repetitions: 0,
    intervalDays: 0,
    ease: 2.5,
    nextReviewOn: addDaysKey(today, card.dayOffset),
    active: true
  }))
}
