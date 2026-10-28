import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { registerLearningHandlersIPC } = await import('./learning')

const valid = {
  id: 'l1',
  subject: '  英语二  ',
  title: '  analyze  ',
  source: '2021 阅读',
  notes: 'v. 分析',
  repetitions: 2,
  intervalDays: 6,
  ease: 2.5,
  nextReviewOn: '2026-10-27',
  active: true
}

describe('卡片草稿校验', () => {
  it('去掉科目与正面首尾空白', () => {
    expect(registerLearningHandlersIPC.assertLearningDraft(valid)).toEqual({
      subject: '英语二',
      title: 'analyze',
      source: '2021 阅读',
      notes: 'v. 分析',
      nextReviewOn: '2026-10-27'
    })
  })

  it('接受最小草稿', () => {
    expect(
      registerLearningHandlersIPC.assertLearningDraft({ subject: '互联网', title: 'DNS' })
    ).toEqual({ subject: '互联网', title: 'DNS' })
  })

  it('拒绝空科目、空正面与非字符串', () => {
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({ subject: '   ', title: 'x' })
    ).toThrow(TypeError)
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({ subject: 'x', title: '  ' })
    ).toThrow(TypeError)
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({ subject: 1, title: 'x' })
    ).toThrow(TypeError)
    expect(() => registerLearningHandlersIPC.assertLearningDraft(null)).toThrow(TypeError)
  })

  it('拒绝超长字段与非法日期', () => {
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({ subject: 'x'.repeat(41), title: 'a' })
    ).toThrow(TypeError)
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({ subject: 'x', title: 'a'.repeat(201) })
    ).toThrow(TypeError)
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({
        subject: 'x',
        title: 'a',
        notes: 'n'.repeat(2001)
      })
    ).toThrow(TypeError)
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({
        subject: 'x',
        title: 'a',
        nextReviewOn: '2026-02-30'
      })
    ).toThrow(TypeError)
  })
})

describe('卡片补丁校验', () => {
  it('只保留已知字段并去空白', () => {
    expect(
      registerLearningHandlersIPC.assertLearningPatch({
        subject: ' 英语一 ',
        title: ' analyse ',
        active: false,
        extra: 'ignored'
      })
    ).toEqual({ subject: '英语一', title: 'analyse', active: false })
  })

  it('拒绝空补丁、非法状态与非法日期', () => {
    expect(() => registerLearningHandlersIPC.assertLearningPatch({})).toThrow(TypeError)
    expect(() => registerLearningHandlersIPC.assertLearningPatch({ active: 'yes' })).toThrow(
      TypeError
    )
    expect(() =>
      registerLearningHandlersIPC.assertLearningPatch({ nextReviewOn: '2026-13-01' })
    ).toThrow(TypeError)
    expect(() => registerLearningHandlersIPC.assertLearningPatch({ title: '   ' })).toThrow(
      TypeError
    )
  })
})

describe('卡片记录与评分校验', () => {
  it('接受合法记录并补齐缺省文本', () => {
    expect(registerLearningHandlersIPC.assertLearningRecord(valid)).toMatchObject({
      id: 'l1',
      subject: '英语二',
      title: 'analyze',
      source: '2021 阅读',
      notes: 'v. 分析',
      repetitions: 2,
      intervalDays: 6,
      ease: 2.5,
      nextReviewOn: '2026-10-27',
      active: true
    })
    expect(
      registerLearningHandlersIPC.assertLearningRecord({
        ...valid,
        source: undefined,
        notes: undefined
      })
    ).toMatchObject({ source: '', notes: '' })
  })

  it('拒绝越界数值与缺失启用状态', () => {
    expect(() =>
      registerLearningHandlersIPC.assertLearningRecord({ ...valid, intervalDays: 365.5 })
    ).toThrow(TypeError)
    expect(() => registerLearningHandlersIPC.assertLearningRecord({ ...valid, ease: 3.2 })).toThrow(
      TypeError
    )
    expect(() =>
      registerLearningHandlersIPC.assertLearningRecord({ ...valid, repetitions: -1 })
    ).toThrow(TypeError)
    expect(() =>
      registerLearningHandlersIPC.assertLearningRecord({ ...valid, active: 'true' })
    ).toThrow(TypeError)
    expect(() => registerLearningHandlersIPC.assertLearningRecord('x')).toThrow(TypeError)
  })

  it('评分只接受 1–4 的整数', () => {
    for (const rating of [1, 2, 3, 4]) {
      expect(registerLearningHandlersIPC.assertRating(rating)).toBe(rating)
    }
    for (const rating of [0, 5, 2.5, '3', null]) {
      expect(() => registerLearningHandlersIPC.assertRating(rating)).toThrow(TypeError)
    }
  })

  it('拒绝空 id', () => {
    expect(() => registerLearningHandlersIPC.assertLearningId('')).toThrow(TypeError)
    expect(registerLearningHandlersIPC.assertLearningId('l1')).toBe('l1')
  })
})

describe('挖空卡草稿校验', () => {
  it('由原文推导正面', () => {
    expect(
      registerLearningHandlersIPC.assertLearningDraft({
        subject: '互联网',
        title: '随便写的正面会被覆盖',
        kind: 'cloze',
        clozeSource: '{{c1::TCP}} 是面向连接的'
      })
    ).toMatchObject({
      kind: 'cloze',
      title: '[1] 是面向连接的',
      clozeSource: '{{c1::TCP}} 是面向连接的'
    })
  })

  it('挖空卡缺少原文被拒', () => {
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({
        subject: '互联网',
        title: 'x',
        kind: 'cloze'
      })
    ).toThrow(TypeError)
  })

  it('没有挖空内容的原文被拒', () => {
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({
        subject: '互联网',
        title: 'x',
        kind: 'cloze',
        clozeSource: '纯文本没有挖空'
      })
    ).toThrow(TypeError)
  })

  it('未知卡型被拒', () => {
    expect(() =>
      registerLearningHandlersIPC.assertLearningDraft({
        subject: '互联网',
        title: 'x',
        kind: 'reverse'
      })
    ).toThrow(TypeError)
  })

  it('改挖空原文时正面同步重算', () => {
    expect(
      registerLearningHandlersIPC.assertLearningPatch({ clozeSource: '{{c1::UDP}} 不面向连接' })
    ).toEqual({ clozeSource: '{{c1::UDP}} 不面向连接', title: '[1] 不面向连接' })
  })
})
