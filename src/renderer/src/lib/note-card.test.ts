import { describe, expect, it } from 'vitest'
import { noteToCard } from './note-card'

describe('noteToCard', () => {
  it('按第一句拆成问答', () => {
    const card = noteToCard('工作台不是聊天窗口。它是把 agent 产出沉淀成记忆的地方。')
    expect(card?.title).toBe('工作台不是聊天窗口？')
    expect(card?.notes).toBe('工作台不是聊天窗口。它是把 agent 产出沉淀成记忆的地方。')
  })

  it('没有句号时退化成自述卡，正面截断到 40 字', () => {
    const card = noteToCard('这是一条没有任何标点的长笔记内容用来测试截断行为是否正常工作可以吗')
    expect(card?.title.length).toBeLessThanOrEqual(40)
    expect(card?.notes).toBe('这是一条没有任何标点的长笔记内容用来测试截断行为是否正常工作可以吗')
  })

  it('分隔符在末尾时没有可隐藏的答案', () => {
    const card = noteToCard('只有一句话。')
    expect(card?.title).toBe('只有一句话')
  })

  it('换行也算句子边界', () => {
    const card = noteToCard('第一行问题\n第二行是答案')
    expect(card?.title).toBe('第一行问题？')
  })

  it('空白输入返回 null', () => {
    expect(noteToCard('   ')).toBeNull()
    expect(noteToCard('')).toBeNull()
  })

  it('正面不会带上句末标点再叠问号', () => {
    const card = noteToCard('TCP 是面向连接的。UDP 不是。')
    expect(card?.title).toBe('TCP 是面向连接的？')
    expect(card?.title).not.toContain('。。')
  })
})
