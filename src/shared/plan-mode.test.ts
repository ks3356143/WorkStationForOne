import { describe, expect, it } from 'vitest'
import { planModeDenial, planModePrompt } from './plan-mode'

describe('Plan 模式规则', () => {
  it('识别写入工具与桥写入工具，放行只读工具', () => {
    expect(planModeDenial('claude', 'Write')).toContain('计划模式')
    expect(planModeDenial('claude', 'Bash')).toContain('计划模式')
    expect(planModeDenial('claude', 'mcp__workstationforone__tasks_create')).toContain('计划模式')
    expect(planModeDenial('codex', 'MCP · workstationforone/notes_create')).toContain('计划模式')
    expect(planModeDenial('codex', 'Shell')).toBeNull()
    expect(planModeDenial('codex', 'Patch')).toContain('计划模式')
    expect(planModeDenial('claude', 'Read')).toBeNull()
    expect(planModeDenial('claude', 'mcp__workstationforone__tasks_list')).toBeNull()
    expect(planModeDenial('codex', 'MCP · workstationforone/today_overview')).toBeNull()
  })

  it('提示词明确只读规划，不改文件', () => {
    const prompt = planModePrompt('看看入口')
    expect(prompt).toContain('计划模式')
    expect(prompt).toContain('不要修改文件')
    expect(prompt.endsWith('看看入口')).toBe(true)
  })
})
