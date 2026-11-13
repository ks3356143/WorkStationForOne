import { describe, expect, it } from 'vitest'
import { buildVerifyPrompt } from './verify-repair'

describe('buildVerifyPrompt', () => {
  it('包含改动文件、验证步骤与不提交约束', () => {
    const prompt = buildVerifyPrompt(['src/a.ts', 'src/b.ts'])
    expect(prompt).toContain('src/a.ts')
    expect(prompt).toContain('npm run typecheck')
    expect(prompt).toContain('不要提交')
  })

  it('去重并限制文件数', () => {
    const prompt = buildVerifyPrompt(['a', 'a', 'a'])
    expect(prompt.match(/- a/g)?.length).toBe(1)
    const many = buildVerifyPrompt(Array.from({ length: 40 }, (_, i) => `f${i}.ts`))
    expect(many).toContain('f19.ts')
    expect(many).not.toContain('f20.ts')
  })

  it('没有改动文件时也能给出通用验证指令', () => {
    const prompt = buildVerifyPrompt([])
    expect(prompt).toContain('验证')
    expect(prompt).not.toContain('本轮改动文件')
  })
})
