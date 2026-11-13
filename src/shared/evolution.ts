// 专家自进化：从一次「成功且有工具步骤」的回合提炼可复用专家（persona 记录工具顺序与结论）。
// 评估门：助手正文为空或没有工具调用时不产出候选。

export interface EvolutionTurn {
  userText: string
  assistantText: string
  toolNames: string[]
}

export interface EvolutionCandidate {
  name: string
  description: string
  persona: string
}

export function buildExpertCandidate(turn: EvolutionTurn): EvolutionCandidate | null {
  const assistant = turn.assistantText.trim()
  const tools = Array.from(new Set(turn.toolNames.map((name) => name.trim()).filter(Boolean)))
  if (!assistant || tools.length === 0) return null
  const intent =
    turn.userText
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? '一次成功回合'
  const name = intent.slice(0, 40) || '自进化专家'
  const persona = [
    `你是从一次成功回合提炼的专家，任务是复现这类请求：${intent.slice(0, 200)}。`,
    `上次成功的工具顺序：${tools.slice(0, 12).join(' → ')}。`,
    '按同样思路先确认约束，再逐步执行；改动后验证，不确定时先只读调查并说明。',
    assistant.slice(0, 800)
  ].join('\n')
  return {
    name,
    description: `自进化：${intent.slice(0, 60)}`,
    persona
  }
}
