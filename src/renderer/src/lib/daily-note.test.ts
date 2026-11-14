import { describe, expect, it } from 'vitest'
import { dailyNoteTitle, findDailyNote, noteFirstLine } from './daily-note'

describe('dailyNoteTitle', () => {
  it('日期键 + 日记', () => {
    expect(dailyNoteTitle('2026-11-14')).toBe('2026-11-14 日记')
  })
})

describe('noteFirstLine', () => {
  it('取首行并去空白', () => {
    expect(noteFirstLine('  2026-11-14 日记\n\n正文')).toBe('2026-11-14 日记')
  })
  it('空文本返回空串', () => {
    expect(noteFirstLine('')).toBe('')
  })
})

describe('findDailyNote', () => {
  it('按首行精确匹配标题', () => {
    const notes = [
      { id: 'a', text: '别的笔记\n正文' },
      { id: 'b', text: '2026-11-14 日记\n今天' },
      { id: 'c', text: '2026-11-14 日记摘要\n不同' }
    ]
    expect(findDailyNote(notes, '2026-11-14 日记')?.id).toBe('b')
  })
  it('无匹配返回 undefined', () => {
    expect(findDailyNote([{ id: 'a', text: '别的' }], '2026-11-14 日记')).toBeUndefined()
  })
})
