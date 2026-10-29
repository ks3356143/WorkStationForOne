/**
 * MEM（工程管理硕士）初试内容：204 英语二 + 199 管理类综合能力。
 * 学习域默认科目只围绕这两门，起步卡覆盖管综三科；英语二沿用原有词汇种子。
 */
export const MEM_SUBJECTS = ['英语二', '管综数学', '管综逻辑', '管综写作'] as const

export type MemSubject = (typeof MEM_SUBJECTS)[number]

export interface MemStarter {
  id: string
  subject: MemSubject
  title: string
  source: string
  notes: string
  /** 首次启动时的到期偏移天数，0 表示今天。 */
  dayOffset: number
}

export const MEM_STARTERS: MemStarter[] = [
  {
    id: 'mem-math-ratio',
    subject: '管综数学',
    title: '若 a:b = 2:3，b:c = 4:5，则 a:c = ?',
    source: '199 管综 · 数学基础',
    notes: '8:15。把 b 统一成 12：a:b = 8:12，b:c = 12:15，所以 a:b:c = 8:12:15。',
    dayOffset: 0
  },
  {
    id: 'mem-math-work',
    subject: '管综数学',
    title: '甲单独 10 天完成，乙单独 15 天完成，合作几天完成？',
    source: '199 管综 · 数学基础',
    notes: '6 天。设工程量为 1，工效为 1/10 + 1/15 = 1/6，所以需要 6 天。',
    dayOffset: 0
  },
  {
    id: 'mem-math-permute',
    subject: '管综数学',
    title: '从 5 人中选 3 人排成一排，有多少种排法？',
    source: '199 管综 · 数学基础',
    notes: '60 种。A(5,3) = 5×4×3 = 60；如果只选不排，则是 C(5,3) = 10。',
    dayOffset: 1
  },
  {
    id: 'mem-logic-sufficient',
    subject: '管综逻辑',
    title: '「p 是 q 的充分条件」等价于什么？',
    source: '199 管综 · 逻辑推理',
    notes: 'q 是 p 的必要条件，即 p → q。注意充分与必要方向相反，别把箭头画反。',
    dayOffset: 1
  },
  {
    id: 'mem-logic-syllogism',
    subject: '管综逻辑',
    title: '所有 A 是 B，所有 B 是 C，能否推出所有 A 是 C？',
    source: '199 管综 · 逻辑推理',
    notes: '能，三段论 Barbara 式。前提都为全称肯定，结论也是全称肯定。',
    dayOffset: 2
  },
  {
    id: 'mem-logic-contradiction',
    subject: '管综逻辑',
    title: '「所有 S 都是 P」的矛盾命题是什么？',
    source: '199 管综 · 逻辑推理',
    notes: '有的 S 不是 P。注意「所有 S 都不是 P」与它是反对关系，不是矛盾关系。',
    dayOffset: 2
  },
  {
    id: 'mem-writing-analysis',
    subject: '管综写作',
    title: '论证有效性分析的主要任务是什么？',
    source: '199 管综 · 写作',
    notes:
      '找出论证中的逻辑漏洞并说明它如何削弱结论，不是复述或评价观点。常见漏洞：概念混淆、以偏概全、因果倒置、不当类比。',
    dayOffset: 3
  },
  {
    id: 'mem-writing-essay',
    subject: '管综写作',
    title: '论说文的本论常用哪两种结构？',
    source: '199 管综 · 写作',
    notes:
      '并列式（几个分论点并列展开）与递进式（是什么—为什么—怎么办）。开头引材料亮论点，结尾回扣主题。',
    dayOffset: 3
  }
]
