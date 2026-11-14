import { describe, expect, it } from 'vitest'
import { parseCsvRows } from './csv'

describe('parseCsvRows', () => {
  it('简单行列', () => {
    expect(parseCsvRows('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
  it('引号内逗号不拆分', () => {
    expect(parseCsvRows('a,"b,c"\n1,2')).toEqual([
      ['a', 'b,c'],
      ['1', '2']
    ])
  })
  it('双引号转义', () => {
    expect(parseCsvRows('"he said ""hi""",x')).toEqual([['he said "hi"', 'x']])
  })
  it('BOM 与 CRLF', () => {
    expect(parseCsvRows('\uFEFFa,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
  it('引号内换行保留', () => {
    expect(parseCsvRows('"a\nb",c')).toEqual([['a\nb', 'c']])
  })
  it('行数上限', () => {
    expect(parseCsvRows('1\n2\n3\n4', 2)).toEqual([['1'], ['2']])
  })
  it('空输入返回空', () => {
    expect(parseCsvRows('')).toEqual([])
  })
})
