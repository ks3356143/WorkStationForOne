import { describe, expect, it } from 'vitest'
import { parseLearningCsv, serializeLearningCsv } from './learning-csv'
import type { LearningItemRecord } from './ipc'

const header = '科目,正面,背面,来源,类型,挖空原文'

function item(overrides: Partial<LearningItemRecord> = {}): LearningItemRecord {
  return {
    id: 'l1',
    subject: '管综逻辑',
    title: '充分条件',
    source: '199 逻辑',
    notes: 'p→q',
    repetitions: 0,
    intervalDays: 0,
    ease: 2.5,
    nextReviewOn: '2026-10-29',
    active: true,
    ...overrides
  }
}

describe('parseLearningCsv', () => {
  it('解析基础卡片并去掉 BOM', () => {
    const result = parseLearningCsv(`\uFEFF${header}\r\n英语二,analyze,分析,,基础,\r\n`)
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      line: 2,
      draft: { subject: '英语二', title: 'analyze', notes: '分析' }
    })
  })

  it('支持引号、逗号、换行与转义引号', () => {
    const text = `${header}\n管综写作,"标题, 带逗号","第一行\n第二行",来源,"基础",""`
    const result = parseLearningCsv(text)
    expect(result.errors).toEqual([])
    expect(result.rows[0].draft).toMatchObject({
      title: '标题, 带逗号',
      notes: '第一行\n第二行'
    })
  })

  it('挖空卡从原文推导正面并忽略正面列', () => {
    const text = `${header}\n管综逻辑,随便写,提示,来源,挖空,{{c1::所有}} S 都是 P`
    const result = parseLearningCsv(text)
    expect(result.errors).toEqual([])
    expect(result.rows[0].draft).toMatchObject({
      subject: '管综逻辑',
      title: '[1] S 都是 P',
      kind: 'cloze',
      clozeSource: '{{c1::所有}} S 都是 P'
    })
  })

  it('缺少必填列、空行与非法类型会报错或跳过', () => {
    expect(parseLearningCsv('科目,背面\n英语二,分析').errors[0].message).toContain('正面')
    expect(parseLearningCsv(`${header}\n,,,,,`).rows).toEqual([])

    const result = parseLearningCsv(`${header}\n英语二,a,b,,奇怪,`)
    expect(result.rows).toEqual([])
    expect(result.errors[0]).toMatchObject({ line: 2 })
  })

  it('缺科目、缺正面与超长字段都拦截', () => {
    const run = (row: string) => parseLearningCsv(`${header}\n${row}`)
    expect(run(',title,b,,基础,').errors[0].message).toContain('科目')
    expect(run('英语二,,b,,基础,').errors[0].message).toContain('正面')
    expect(run(`英语二,${'x'.repeat(201)},b,,基础,`).errors[0].message).toContain('过长')
    expect(run(`英语二,t,${'x'.repeat(2001)},,基础,`).errors[0].message).toContain('过长')
  })

  it('挖空原文非法时给出错误行', () => {
    const result = parseLearningCsv(`${header}\n管综逻辑,,,来源,挖空,没有标记`)
    expect(result.rows).toEqual([])
    expect(result.errors[0].message).toContain('挖空')
  })
})

describe('serializeLearningCsv', () => {
  it('导出带 BOM 与表头，并按需加引号', () => {
    const text = serializeLearningCsv([
      item({ notes: '含,逗号与"引号"\n换行' }),
      item({ id: 'l2', title: '普通', notes: '', source: '' })
    ])
    expect(text.startsWith('\uFEFF科目,正面,背面,来源,类型,挖空原文\r\n')).toBe(true)
    expect(text).toContain('"含,逗号与""引号""\n换行"')
    expect(text).toContain('基础')
  })

  it('挖空卡导出原文与类型，导入后可还原', () => {
    const cloze = item({
      title: '[1] 是面向连接的',
      kind: 'cloze',
      clozeSource: '{{c1::TCP}} 是面向连接的',
      notes: ''
    })
    const text = serializeLearningCsv([cloze])
    expect(text).toContain('挖空')
    const parsed = parseLearningCsv(text)
    expect(parsed.rows[0].draft).toMatchObject({
      title: '[1] 是面向连接的',
      kind: 'cloze',
      clozeSource: '{{c1::TCP}} 是面向连接的'
    })
  })
})
