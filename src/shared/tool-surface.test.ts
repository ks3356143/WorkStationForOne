import { describe, expect, it } from 'vitest'
import {
  CLAUDE_NATIVE_TOOLS,
  CODEX_NATIVE_TOOLS,
  buildToolPriorityPrompt,
  claudeDisabledTools,
  codexDeniedTools,
  codexFlags,
  toolSurfaceDenial
} from './tool-surface'

describe('CLI 原生工具目录', () => {
  it('Claude 原生组按组展开为 CLI 工具名', () => {
    const disabled = claudeDisabledTools(['web', 'shell'])
    expect(disabled).toEqual(
      expect.arrayContaining(['WebFetch', 'WebSearch', 'Bash', 'BashOutput', 'KillShell'])
    )
    expect(disabled).not.toContain('Read')
    expect(CLAUDE_NATIVE_TOOLS.some((tool) => tool.id === 'web')).toBe(true)
  })

  it('Codex 原生开关生成进程参数与应用层拒绝列表', () => {
    expect(codexFlags(['computer-use', 'browser-use', 'web'])).toEqual([
      'features.computer_use=false',
      'features.browser_use=false',
      'web_search="disabled"'
    ])
    expect(codexDeniedTools(['shell', 'file-write'])).toEqual(['Shell', 'Patch'])
    expect(CODEX_NATIVE_TOOLS.some((tool) => tool.id === 'shell')).toBe(true)
  })
})

describe('工具面拒绝文案', () => {
  it('命中关闭项时给出可读原因，不误伤数据桥工具', () => {
    expect(toolSurfaceDenial('WebSearch', ['WebFetch', 'WebSearch'])).toContain('WebSearch')
    expect(toolSurfaceDenial('Write', ['Bash'])).toBeNull()
    expect(toolSurfaceDenial('mcp__workstationforone__tasks_create', ['Bash'])).toBeNull()
    expect(toolSurfaceDenial('MCP · workstationforone/tasks_create', ['Bash'])).toBeNull()
    expect(toolSurfaceDenial('Bash', [])).toBeNull()
  })
})

describe('工具优先级提示', () => {
  const surface = {
    mcp: [
      { name: 'desktop', tools: ['computer', 'screenshot'], preferred: true },
      { name: 'memory', tools: ['search', 'create'] }
    ],
    skills: [{ name: 'pdf', preferred: true }, { name: 'weekly-review' }]
  }

  it('首选单独成组，并要求优先于 CLI 原生工具', () => {
    const text = buildToolPriorityPrompt('claude', surface)
    expect(text).toContain('首选：desktop（computer, screenshot）；技能 pdf')
    expect(text).toContain('其它已启用：memory（search, create）；技能 weekly-review')
    expect(text).toContain('CLI 原生工具')
    expect(text).toContain('WebFetch')
    expect(text.indexOf('首选：')).toBeLessThan(text.indexOf('其它已启用'))
    expect(text).toContain('写入')
  })

  it('多个技能合并成一段，不重复「技能」前缀', () => {
    const text = buildToolPriorityPrompt('claude', {
      mcp: [],
      skills: [
        { name: 'pdf', preferred: true },
        { name: 'weekly-review', preferred: true }
      ]
    })
    expect(text).toContain('首选：技能 pdf、weekly-review')
    expect(text).not.toContain('技能 pdf；技能')
  })

  it('没有首选时退回单级清单', () => {
    const text = buildToolPriorityPrompt('claude', {
      mcp: [{ name: 'memory', tools: ['search'] }],
      skills: [{ name: 'pdf' }]
    })
    expect(text).toContain('MCP：memory（search）')
    expect(text).toContain('技能：pdf')
    expect(text).not.toContain('首选：')
    expect(text).not.toContain('其它已启用')
  })

  it('首选项缺工具名时只写服务名，不出现空括号', () => {
    const text = buildToolPriorityPrompt('codex', {
      mcp: [{ name: 'desktop', tools: [], preferred: true }],
      skills: []
    })
    expect(text).toContain('首选：desktop')
    expect(text).not.toContain('desktop（）')
  })

  it('每个 Server 最多列 6 个工具名，避免长清单撑大提示词', () => {
    const tools = Array.from({ length: 70 }, (_, index) => `notion_${index}`)
    const text = buildToolPriorityPrompt('claude', {
      mcp: [{ name: 'Notion', tools, preferred: true }],
      skills: []
    })
    expect(text).toContain('notion_0')
    expect(text).toContain('notion_5')
    expect(text).not.toContain('notion_6')
    expect(text).toContain('等 70 个')
    // 提示词每轮都会随会话带上，长清单必须被截断
    expect(text.length).toBeLessThan(600)
  })

  it('工具数正好等于上限时不显示「等 N 个」', () => {
    const text = buildToolPriorityPrompt('claude', {
      mcp: [{ name: 'Memory', tools: ['a', 'b', 'c', 'd', 'e', 'f'] }],
      skills: []
    })
    expect(text).toContain('Memory（a, b, c, d, e, f）')
    expect(text).not.toContain('等')
  })

  it('名称里夹带 URL 或密钥时脱敏，不原样进提示词', () => {
    const text = buildToolPriorityPrompt('claude', {
      mcp: [
        { name: 'https://x.test/mcp?key=1', tools: ['safe_tool'], preferred: true },
        { name: 'Bearer sk-abcdefgh12345678', tools: [] }
      ],
      skills: [{ name: 'ctx7sk-abcdefgh1234' }]
    })
    expect(text).not.toContain('https://')
    expect(text).not.toContain('sk-abcdefgh')
    expect(text).not.toContain('ctx7sk-abcdefgh')
    expect(text).toContain('[已隐藏]')
    expect(text).toContain('safe_tool')
  })

  it('工具名里的密钥同样被抹掉', () => {
    const text = buildToolPriorityPrompt('codex', {
      mcp: [{ name: 'Memory', tools: ['sk-abcdefgh12345678', 'ok_tool'] }],
      skills: []
    })
    expect(text).not.toContain('sk-abcdefgh')
    expect(text).toContain('ok_tool')
  })

  it('空工具面不生成提示；不包含路径、命令或密钥', () => {
    expect(buildToolPriorityPrompt('claude', { mcp: [], skills: [] })).toBe('')
    const text = buildToolPriorityPrompt('codex', surface)
    expect(text).not.toContain('/')
    expect(text).not.toContain('Bearer')
    expect(text).not.toContain('sk-')
  })
})
