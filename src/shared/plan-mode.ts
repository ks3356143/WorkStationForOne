import type { ApprovalAgent } from './approval-rules'

const BRIDGE_READ_TOOLS = new Set([
  'tasks_list',
  'notes_search',
  'learning_due',
  'habits_summary',
  'today_overview'
])
const CLAUDE_READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'AskUserQuestion'])
/** Codex 的只读调查靠 Shell；写入由 read-only 沙箱兜底。 */
const CODEX_READ_TOOLS = new Set(['Shell'])
const BRIDGE_PREFIX = 'workstationforone/'
const CLAUDE_MCP_PREFIX = 'mcp__'
const CODEX_MCP_PREFIX = 'MCP · '

/** 计划模式只放行已知只读工具；任何可能写入或联网的 MCP 调用都按拒绝处理。 */
export function planModeDenial(agent: ApprovalAgent, toolName: string): string | null {
  if (agent === 'claude') {
    if (CLAUDE_READ_TOOLS.has(toolName)) return null
    if (toolName.startsWith('mcp__workstationforone__')) {
      const tool = toolName.slice('mcp__workstationforone__'.length)
      return BRIDGE_READ_TOOLS.has(tool) ? null : PLANNING_DENIAL
    }
    if (toolName.startsWith(CLAUDE_MCP_PREFIX)) return PLANNING_DENIAL
    return PLANNING_DENIAL
  }
  if (CODEX_READ_TOOLS.has(toolName)) return null
  if (toolName.startsWith(CODEX_MCP_PREFIX)) {
    const name = toolName.slice(CODEX_MCP_PREFIX.length)
    if (name.startsWith(BRIDGE_PREFIX)) {
      const tool = name.slice(BRIDGE_PREFIX.length)
      return BRIDGE_READ_TOOLS.has(tool) ? null : PLANNING_DENIAL
    }
    return PLANNING_DENIAL
  }
  return PLANNING_DENIAL
}

const PLANNING_DENIAL =
  '计划模式只做只读分析：请先给出计划，等用户切到执行模式后再运行命令或修改文件。'

export const PLAN_MODE_PREFIX = [
  '[计划模式]',
  '只做只读调查并给出实施计划：可以读取文件、搜索和运行只读命令；不要修改文件、不要执行写入命令、不要调用写入工具。',
  '计划要列出会改哪些文件、步骤与风险；完成后停止，等用户切到执行模式再动手。',
  '',
  '用户请求：'
].join('\n')

export function planModePrompt(prompt: string): string {
  return `${PLAN_MODE_PREFIX}\n${prompt}`
}
