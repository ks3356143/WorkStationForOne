import { describe, expect, it } from 'vitest'
import { applyLink, linkTrigger } from './note-link-input'

describe('linkTrigger', () => {
  it('在未闭合的 [[ 后返回查询词', () => {
    const text = '先看 [[项目'
    expect(linkTrigger(text, text.length)).toEqual({ start: 3, query: '项目' })
  })

  it('空查询也算触发', () => {
    const text = '看 [['
    expect(linkTrigger(text, text.length)).toEqual({ start: 2, query: '' })
  })

  it('已闭合或光标在标记之前不触发', () => {
    const closed = '看 [[项目]]'
    expect(linkTrigger(closed, closed.length)).toBeNull()
    expect(linkTrigger(closed, 2)).toBeNull()
  })

  it('跨行的半截标记不触发', () => {
    const text = '[[第一行\n第二行'
    expect(linkTrigger(text, text.length)).toBeNull()
  })
})

describe('applyLink', () => {
  it('用笔记名替换半截标记并把光标放到末尾', () => {
    const text = '先看 [[项目'
    const trigger = linkTrigger(text, text.length)!
    expect(applyLink(text, trigger, text.length, '项目计划')).toEqual({
      text: '先看 [[项目计划]]',
      caret: '先看 [[项目计划]]'.length
    })
  })

  it('已有右括号时一并吞掉，避免重复闭合', () => {
    const text = '[[项目]] 后文'
    const trigger = { start: 0, query: '项目' }
    expect(applyLink(text, trigger, 4, '项目计划')).toEqual({
      text: '[[项目计划]] 后文',
      caret: '[[项目计划]]'.length
    })
  })

  it('保留标记前后的正文', () => {
    const text = '前 [[项 后'
    const result = applyLink(text, { start: 2, query: '项' }, 5, '项目')
    expect(result.text).toBe('前 [[项目]] 后')
  })
})
