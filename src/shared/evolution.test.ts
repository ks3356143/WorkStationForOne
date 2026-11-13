import { describe, expect, it } from 'vitest'
import { parseExpertMarkdown } from './expert-format'
import { buildExpertCandidate } from './evolution'

const turn = {
  userText: '修一下登录页的样式，并跑验证',
  assistantText: '已修改登录页并跑通类型检查。',
  toolNames: ['Read', 'Edit', 'Bash', 'Bash']
}

describe('buildExpertCandidate', () => {
  it('从成功回合提炼名称、描述与人设', () => {
    const c = buildExpertCandidate(turn)
    expect(c).not.toBeNull()
    expect(c!.name).toContain('修一下登录页')
    expect(c!.persona).toContain('Read → Edit → Bash')
    expect(c!.persona).toContain('已修改登录页')
  })

  it('没有工具步骤或助手正文时返回 null（评估门）', () => {
    expect(buildExpertCandidate({ ...turn, toolNames: [] })).toBeNull()
    expect(buildExpertCandidate({ ...turn, assistantText: '   ' })).toBeNull()
  })

  it('人设可被专家格式接受（可导出/导入）', () => {
    const c = buildExpertCandidate(turn)!
    const parsed = parseExpertMarkdown(
      `---\nname: ${c.name}\ndescription: ${c.description}\n---\n${c.persona}\n`
    )
    expect(parsed?.persona).toContain('Read → Edit → Bash')
  })
})
