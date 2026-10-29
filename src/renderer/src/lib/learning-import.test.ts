import { describe, expect, it } from 'vitest'
import type { LearningCsvRow } from '../../../shared/learning-csv'
import { planImport } from './learning-import'

function row(line: number, subject: string, title: string): LearningCsvRow {
  return { line, draft: { subject, title } }
}

describe('planImport', () => {
  it('按科目 + 正面跳过已有卡与文件内重复', () => {
    const plan = planImport(
      [
        row(2, '英语二', 'analyze'),
        row(3, '管综数学', '比例'),
        row(4, '管综数学', '比例'),
        row(5, '管综逻辑', '三段论')
      ],
      [{ subject: '英语二', title: 'analyze' }]
    )

    expect(plan.rows.map((entry) => entry.draft.title)).toEqual(['比例', '三段论'])
    expect(plan.duplicates).toBe(2)
  })

  it('空列表原样返回', () => {
    expect(planImport([], [])).toEqual({ rows: [], duplicates: 0 })
  })
})
