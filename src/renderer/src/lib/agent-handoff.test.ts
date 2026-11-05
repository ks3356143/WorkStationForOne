import { describe, expect, it } from 'vitest'
import { noteToAgentPrompt, taskToAgentPrompt } from './agent-handoff'

describe('taskToAgentPrompt', () => {
  it('包含完整字段并在末尾要求先给计划', () => {
    const prompt = taskToAgentPrompt({
      title: '重构 auth',
      notes: '记得补测试',
      dueDate: '2026-11-08',
      time: '15:00',
      priority: 1,
      list: '工作',
      estimateMinutes: 30
    })
    expect(prompt).toContain('标题：重构 auth')
    expect(prompt).toContain('清单：工作')
    expect(prompt).toContain('优先级：高')
    expect(prompt).toContain('截止：2026-11-08')
    expect(prompt).toContain('时间：15:00')
    expect(prompt).toContain('预计：30 分钟')
    expect(prompt).toContain('备注：记得补测试')
    expect(prompt).toContain('先说明你的处理计划')
    expect(prompt).not.toContain('\n')
    expect(taskToAgentPrompt({ title: '带句号', notes: '备注结尾。' })).toContain(
      '备注：备注结尾。先说明'
    )
  })

  it('省略缺省字段与占位时间', () => {
    const prompt = taskToAgentPrompt({ title: '只做标题', time: '—' })
    expect(prompt).toContain('标题：只做标题')
    expect(prompt).not.toContain('清单：')
    expect(prompt).not.toContain('优先级：')
    expect(prompt).not.toContain('时间：')
    expect(prompt).not.toContain('备注：')
  })

  it('空标题不生成提示词', () => {
    expect(taskToAgentPrompt({ title: '   ' })).toBe('')
  })
})

describe('noteToAgentPrompt', () => {
  it('总结与续写使用不同指令并保留正文（换行压成空格）', () => {
    const summarize = noteToAgentPrompt('第一行\n第二行', 'summarize')
    expect(summarize).toContain('总结下面这篇笔记')
    expect(summarize).toContain('第一行 第二行')
    expect(summarize).not.toContain('\n')
    const next = noteToAgentPrompt('第一行', 'continue')
    expect(next).toContain('继续写下去')
    expect(next).toContain('第一行')
  })

  it('空笔记不生成提示词', () => {
    expect(noteToAgentPrompt('  \n', 'summarize')).toBe('')
  })
})
