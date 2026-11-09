import type { AgentKind } from './ipc/agent'

export interface NativeToolGroup {
  id: string
  name: string
  description: string
  /** Claude 侧对应的 CLI 工具名；Codex 用于应用层拒绝 */
  tools: string[]
  /** 关闭后的影响提示 */
  warning?: string
  /** CLI 未提供关闭手段（沙箱内自动执行）：只展示，不给开关 */
  alwaysOn?: boolean
}

export const CLAUDE_NATIVE_TOOLS: NativeToolGroup[] = [
  {
    id: 'file-read',
    name: '读取文件',
    description: 'Read / Grep / Glob / LS / LSP / NotebookRead',
    tools: ['Read', 'Grep', 'Glob', 'LS', 'LSP', 'NotebookRead']
  },
  {
    id: 'file-write',
    name: '修改文件',
    description: 'Write / Edit / MultiEdit / NotebookEdit',
    tools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
  },
  {
    id: 'shell',
    name: '执行命令',
    description: 'Bash / BashOutput / KillShell',
    tools: ['Bash', 'BashOutput', 'KillShell'],
    warning: '关闭后 Claude 无法执行命令、测试或构建。'
  },
  {
    id: 'web',
    name: '访问网络',
    description: 'WebFetch / WebSearch',
    tools: ['WebFetch', 'WebSearch'],
    warning: '关闭后模型无法联网抓取或搜索。'
  },
  {
    id: 'task',
    name: '子任务',
    description: 'Task / TaskStop / AgentOutputTool',
    tools: ['Task', 'TaskStop', 'AgentOutputTool']
  },
  {
    id: 'todo',
    name: '待办清单',
    description: 'TodoWrite / TaskCreate / TaskGet / TaskUpdate / TaskList',
    tools: ['TodoWrite', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList']
  },
  {
    id: 'question',
    name: '交互问答',
    description: 'AskUserQuestion',
    tools: ['AskUserQuestion'],
    warning: '关闭后模型不再弹出交互问题卡。'
  },
  {
    id: 'skill',
    name: '技能加载',
    description: 'Skill',
    tools: ['Skill'],
    warning: '关闭后模型不能调用已安装的技能。'
  },
  {
    id: 'tool-search',
    name: '工具检索',
    description: 'ToolSearch · CLI 内部选择器',
    tools: ['ToolSearch'],
    alwaysOn: true
  },
  {
    id: 'plan',
    name: '计划模式',
    description: 'EnterPlanMode / ExitPlanMode',
    tools: ['EnterPlanMode', 'ExitPlanMode'],
    warning: '关闭后模型不能自行进入计划模式；会话级计划开关不受影响。'
  }
]

export const CODEX_NATIVE_TOOLS: NativeToolGroup[] = [
  {
    id: 'shell',
    name: '执行命令',
    description: 'Shell',
    tools: ['Shell'],
    warning: '关闭后 Codex 无法执行命令；仍可对话与读取文件。'
  },
  { id: 'file-write', name: '修改文件', description: 'Patch / fileChange', tools: ['Patch'] },
  {
    id: 'file-read',
    name: '读取文件',
    description: 'read_file · 沙箱内自动执行，CLI 未提供关闭参数',
    tools: [],
    alwaysOn: true
  },
  {
    id: 'web',
    name: '网络搜索',
    description: 'Codex web_search',
    tools: [],
    warning: '关闭后 Codex 无法联网搜索。'
  },
  {
    id: 'computer-use',
    name: 'Computer Use',
    description: 'Codex 桌面操作',
    tools: ['ComputerUse'],
    warning: '关闭后 Codex 不能操作桌面应用。'
  },
  {
    id: 'browser-use',
    name: 'Browser Use',
    description: 'Codex 浏览器操作',
    tools: ['BrowserUse'],
    warning: '关闭后 Codex 不能操作浏览器。'
  },
  {
    id: 'plan',
    name: '计划更新',
    description: 'update_plan · CLI 未提供关闭参数',
    tools: [],
    alwaysOn: true
  },
  {
    id: 'image',
    name: '查看图片',
    description: 'view_image · CLI 未提供关闭参数',
    tools: [],
    alwaysOn: true
  }
]

export function nativeTools(agent: AgentKind): NativeToolGroup[] {
  return agent === 'claude' ? CLAUDE_NATIVE_TOOLS : CODEX_NATIVE_TOOLS
}

/** 关闭组 → Claude 的 --disallowedTools 展开。 */
export function claudeDisabledTools(disabledIds: string[]): string[] {
  const disabled = new Set(disabledIds)
  return CLAUDE_NATIVE_TOOLS.filter((group) => disabled.has(group.id)).flatMap(
    (group) => group.tools
  )
}

/** 关闭组 → Codex 进程 -c 参数。 */
export function codexFlags(disabledIds: string[]): string[] {
  const disabled = new Set(disabledIds)
  const flags: string[] = []
  if (disabled.has('computer-use')) flags.push('features.computer_use=false')
  if (disabled.has('browser-use')) flags.push('features.browser_use=false')
  if (disabled.has('web')) flags.push('web_search="disabled"')
  return flags
}

/** 关闭组 → Codex 应用层拒绝的工具名（审批 / 自动放行前）。 */
export function codexDeniedTools(disabledIds: string[]): string[] {
  const disabled = new Set(disabledIds)
  const denied: string[] = []
  if (disabled.has('shell')) denied.push('Shell')
  if (disabled.has('file-write')) denied.push('Patch')
  return denied
}

/**
 * 工具面拒绝文案。只比较 CLI 原生工具名：`mcp__*` 与 Codex 的 `MCP · ` 前缀
 * 都是外部 / 数据桥工具，开关只作用于原生工具，不能顺手把它们一起拒掉。
 */
export function toolSurfaceDenial(toolName: string, disabledTools: string[]): string | null {
  if (disabledTools.length === 0) return null
  if (toolName.startsWith('mcp__') || toolName.startsWith('MCP · ')) return null
  const disabled = disabledTools.some((tool) => tool === toolName || toolName.endsWith(`__${tool}`))
  return disabled
    ? `「${toolName}」已在能力中心停用。请在设置 → 能力中心 → 工具里重新启用后再试。`
    : null
}

export interface ToolSurfacePromptInput {
  mcp: Array<{ name: string; tools: string[]; preferred?: boolean; note?: string }>
  skills: Array<{ name: string; preferred?: boolean; note?: string }>
}

/** 每个 Server 最多列几个工具名；Notion 这类 70 工具的 Server 不能整串塞进提示词。 */
export const MAX_PROMPT_TOOLS_PER_SERVER = 6

/** 使用场景说明只进入首选分组；每轮提示词都会带上，必须短。 */
export const MAX_TOOL_NOTE = 80

/**
 * 名称是用户输入，可能被贴进 URL 或密钥。提示词是它唯一的出口，
 * 这里兜一层脱敏，保证「只写名称、不含 URL / 密钥」这条承诺成立。
 */
function sanitizeLabel(value: string): string {
  return value
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[已隐藏]')
    .replace(/\b(?:ctx7sk|sk)-[A-Za-z0-9_-]{8,}/g, '[已隐藏]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [已隐藏]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/** 用途说明是用户自己写的，可能误贴 URL / Key；与名称走同一套脱敏。 */
export function cleanToolNote(value: string): string {
  return value
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[已隐藏]')
    .replace(/\b(?:ctx7sk|sk)-[A-Za-z0-9_-]{8,}/g, '[已隐藏]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [已隐藏]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TOOL_NOTE)
}

function describeMcp(server: { name: string; tools: string[] }): string {
  const name = sanitizeLabel(server.name)
  const tools = server.tools.filter(Boolean).map(sanitizeLabel).filter(Boolean)
  if (tools.length === 0) return name
  const shown = tools.slice(0, MAX_PROMPT_TOOLS_PER_SERVER)
  const rest = tools.length - shown.length
  return `${name}（${shown.join(', ')}${rest > 0 ? ` 等 ${tools.length} 个` : ''}）`
}

/** MCP 逐个列工具；技能合并成一段，避免「技能 a；技能 b」这种啰嗦写法。 */
function describeGroups(
  mcp: Array<{ name: string; tools: string[] }>,
  skills: Array<{ name: string }>
): string {
  const parts = mcp.map(describeMcp)
  const names = skills.map((skill) => sanitizeLabel(skill.name)).filter(Boolean)
  if (names.length > 0) parts.push(`技能 ${names.join('、')}`)
  return parts.join('；')
}

function withNote(base: string, note?: string): string {
  const cleaned = cleanToolNote(note ?? '')
  return cleaned ? `${base} · 用途：${cleaned}` : base
}

/**
 * 首选组逐项附上用途说明。技能只有在带说明时才拆开写，
 * 否则保持原来的「技能 a、b」合并格式，避免无谓变长。
 */
function describePreferred(
  mcp: Array<{ name: string; tools: string[]; note?: string }>,
  skills: Array<{ name: string; note?: string }>
): string {
  const parts = mcp.map((server) => withNote(describeMcp(server), server.note))
  const noted = skills.filter((skill) => cleanToolNote(skill.note ?? ''))
  if (noted.length === 0) {
    const names = skills.map((skill) => sanitizeLabel(skill.name)).filter(Boolean)
    if (names.length > 0) parts.push(`技能 ${names.join('、')}`)
    return parts.join('；')
  }
  for (const skill of skills) {
    const name = sanitizeLabel(skill.name)
    if (name) parts.push(withNote(`技能 ${name}`, skill.note))
  }
  return parts.join('；')
}

/**
 * 工具优先级只声明名称与工具名。不要拼路径、命令、URL 或密钥。
 * 标了首选的项单独成组，并要求优先于 CLI 原生工具；没有首选时退回单级清单。
 */
export function buildToolPriorityPrompt(
  _agent: AgentKind,
  surface: ToolSurfacePromptInput
): string {
  const mcp = surface.mcp.filter((server) => server.name.trim())
  const skills = surface.skills.filter((skill) => skill.name.trim())
  if (mcp.length === 0 && skills.length === 0) return ''

  const topMcp = mcp.filter((server) => server.preferred)
  const topSkills = skills.filter((skill) => skill.preferred)
  const restMcp = mcp.filter((server) => !server.preferred)
  const restSkills = skills.filter((skill) => !skill.preferred)
  const hasPreferred = topMcp.length > 0 || topSkills.length > 0

  const lines = ['[工具优先级]']
  if (hasPreferred) {
    lines.push(
      '凡是能由下列首选工具完成的工作，先调用它们，不要改用 CLI 原生工具（如 Read、WebFetch、WebSearch、ComputerUse、BrowserUse、Shell 等）去完成同一件事；原生工具只用于首选工具做不到的部分。'
    )
    lines.push(`首选：${describePreferred(topMcp, topSkills)}`)
    const others = describeGroups(restMcp, restSkills)
    if (others) lines.push(`其它已启用：${others}`)
  } else {
    lines.push(
      '用户已启用的 MCP 与技能优先：多个工具能做同一件事时，优先使用下面的实现，不要调用已停用的工具。'
    )
    if (mcp.length > 0) lines.push(`MCP：${mcp.map(describeMcp).join('；')}`)
    if (skills.length > 0) lines.push(`技能：${skills.map((skill) => skill.name).join('；')}`)
  }
  lines.push(
    '可以直接调用这些工具与技能，不需要用户逐次点名；写入、命令与越权操作仍按审批规则执行。'
  )
  return lines.join('\n')
}
