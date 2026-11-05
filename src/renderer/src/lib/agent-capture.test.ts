import { describe, expect, it } from 'vitest'
import {
  CAPTURE_NOTE_MAX,
  CAPTURE_TASK_NOTES_MAX,
  CAPTURE_TITLE_MAX,
  captureTitle,
  messageToNote,
  messageToTask
} from './agent-capture'

describe('captureTitle', () => {
  it('取首个非空行并去掉 Markdown 标记', () => {
    expect(captureTitle('\n## 标题\n正文')).toBe('标题')
    expect(captureTitle('**加粗** 与 [链接](https://example.com) 和 `代码`')).toBe(
      '加粗 与 链接 和 代码'
    )
    expect(captureTitle('- 列表项')).toBe('列表项')
    expect(captureTitle('> 引用内容')).toBe('引用内容')
  })

  it('空文本返回空串，超长标题截断', () => {
    expect(captureTitle('   \n\n')).toBe('')
    expect(captureTitle('字'.repeat(CAPTURE_TITLE_MAX + 10))).toHaveLength(CAPTURE_TITLE_MAX)
  })
})

describe('messageToNote / messageToTask', () => {
  it('笔记去掉首尾空白并保留正文', () => {
    expect(messageToNote('  第一行\n第二行  ')).toBe('第一行\n第二行')
  })

  it('超过笔记上限时截断并标注，长度不超限', () => {
    const note = messageToNote('字'.repeat(CAPTURE_NOTE_MAX + 50))
    expect(note.length).toBeLessThanOrEqual(CAPTURE_NOTE_MAX)
    expect(note).toContain('已截断')
  })

  it('任务标题取首行，备注保留全文并限制上限', () => {
    const draft = messageToTask('## 修复登录\n\n具体说明')
    expect(draft).toEqual({ title: '修复登录', notes: '## 修复登录\n\n具体说明' })
    const long = messageToTask(`标题\n${'字'.repeat(CAPTURE_TASK_NOTES_MAX + 20)}`)
    expect(long?.notes.length).toBeLessThanOrEqual(CAPTURE_TASK_NOTES_MAX)
    expect(long?.notes).toContain('已截断')
  })

  it('空回复不建任务', () => {
    expect(messageToTask('   \n')).toBeNull()
  })
})
