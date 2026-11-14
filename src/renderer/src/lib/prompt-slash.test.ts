import { describe, expect, it } from 'vitest'
import { applyTemplate, filterTemplates, firstPlaceholder, matchSlash } from './prompt-slash'

const tpl = (id: string, name: string, body = '正文') => ({
  id,
  name,
  body,
  createdAt: 0,
  updatedAt: 0
})

describe('matchSlash', () => {
  it('行首 /查询 命中', () => {
    expect(matchSlash('/rev', 4)).toEqual({ start: 0, query: 'rev' })
  })
  it('空白后的 /查询 命中', () => {
    expect(matchSlash('foo /rev', 8)).toEqual({ start: 4, query: 'rev' })
  })
  it('空查询命中（刚输入 /）', () => {
    expect(matchSlash('/', 1)).toEqual({ start: 0, query: '' })
  })
  it('路径与 URL 中的 / 不命中', () => {
    expect(matchSlash('src/foo', 7)).toBeNull()
    expect(matchSlash('http://x', 8)).toBeNull()
  })
  it('查询含空格后不再命中', () => {
    expect(matchSlash('/rev now', 8)).toBeNull()
  })
})

describe('filterTemplates', () => {
  it('按名称不区分大小写过滤', () => {
    const list = [tpl('1', 'Review'), tpl('2', '总结'), tpl('3', 'review-fix')]
    expect(filterTemplates(list, 'rev').map((t) => t.id)).toEqual(['1', '3'])
  })
  it('空查询返回全部（限量）', () => {
    const list = [tpl('1', 'a'), tpl('2', 'b')]
    expect(filterTemplates(list, '').length).toBe(2)
    expect(filterTemplates(list, '', 1).length).toBe(1)
  })
})

describe('firstPlaceholder', () => {
  it('返回首个 {变量} 区间', () => {
    expect(firstPlaceholder('审查 {file} 并修复 {bug}')).toEqual({ start: 3, end: 9 })
  })
  it('无占位返回 null', () => {
    expect(firstPlaceholder('普通正文')).toBeNull()
  })
})

describe('applyTemplate', () => {
  it('用正文替换 /查询 并定位首个占位', () => {
    const r = applyTemplate('/rev', 0, 'rev', '审查 {file}')
    expect(r.value).toBe('审查 {file}')
    expect(r.placeholder).toEqual({ start: 3, end: 9 })
  })
  it('保留前缀文本', () => {
    const r = applyTemplate('请 /rev', 2, 'rev', '审查代码')
    expect(r.value).toBe('请 审查代码')
    expect(r.placeholder).toBeNull()
  })
})
