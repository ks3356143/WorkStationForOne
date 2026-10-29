import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { noteValidators } = await import('./notes')

describe('笔记补全参数', () => {
  it('去掉查询首尾空白并保留可选的排除 id', () => {
    expect(noteValidators.assertTitlesArgs('  项目  ', 8, 'n1')).toEqual({
      query: '项目',
      limit: 8,
      excludeId: 'n1'
    })
  })

  it('没有排除 id 时保持缺省', () => {
    expect(noteValidators.assertTitlesArgs('', 8, undefined)).toEqual({ query: '', limit: 8 })
  })

  it('拒绝非法数量与排除 id', () => {
    expect(() => noteValidators.assertTitlesArgs('a', Number.NaN, undefined)).toThrow(TypeError)
    expect(() => noteValidators.assertTitlesArgs('a', 8, 1)).toThrow(TypeError)
    expect(() => noteValidators.assertTitlesArgs(1, 8, undefined)).toThrow(TypeError)
  })
})
