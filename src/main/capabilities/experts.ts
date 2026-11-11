import type {
  AgentExportResult,
  AgentKind,
  ExpertActivateResult,
  ExpertRecord,
  ExpertSaveInput
} from '../../shared/ipc'
import { BUILTIN_EXPERTS, resolveExpertTools } from '../../shared/experts'
import { parseExpertMarkdown, serializeExpertMarkdown } from '../../shared/expert-format'
import type { ExpertRepository } from '../db/experts'

export interface ExpertServiceDeps {
  repository: ExpertRepository
  /** 已信任且归属该 Agent 的外部 MCP id；未信任的不进入可激活集合 */
  trustedMcpIds: (agent: AgentKind) => string[]
  /** 该 Agent 已安装的技能插件 id */
  installedSkillIds: (agent: AgentKind) => string[]
  enableMcp: (id: string) => void
  enableSkill: (id: string, agent: AgentKind) => void
  setPreferred: (agent: AgentKind, key: string) => void
  /** 保存对话框 + 写文件由 IPC 层注入，服务层不碰 Electron */
  writeExport: (defaultName: string, content: string) => Promise<AgentExportResult>
}

/** 专家 = 人设 + 默认 skill/MCP 组合 + ★优先；内置不入库，列表时合并。 */
export class ExpertService {
  constructor(private readonly deps: ExpertServiceDeps) {}

  list(): ExpertRecord[] {
    const builtin = BUILTIN_EXPERTS.map((def) => ({ ...def, builtin: true }))
    return [...builtin, ...this.deps.repository.listExperts()]
  }

  find(id: string): ExpertRecord | undefined {
    const builtin = BUILTIN_EXPERTS.find((def) => def.id === id)
    if (builtin) return { ...builtin, builtin: true }
    return this.deps.repository.findExpert(id)
  }

  save(input: ExpertSaveInput): ExpertRecord {
    return this.deps.repository.saveExpert(input)
  }

  remove(id: string): boolean {
    return this.deps.repository.removeExpert(id)
  }

  /** 解析子代理 Markdown 落库；与内置 id 冲突时加后缀，自定义同 id 视为更新。 */
  importMarkdown(text: string): ExpertRecord {
    const parsed = parseExpertMarkdown(text)
    if (!parsed) throw new Error('不是有效的专家 Markdown（需 frontmatter 与正文人设）')
    let id = parsed.id
    if (BUILTIN_EXPERTS.some((def) => def.id === id)) {
      let n = 2
      while (BUILTIN_EXPERTS.some((def) => def.id === `${parsed.id}-${n}`)) n += 1
      id = `${parsed.id}-${n}`
    }
    return this.deps.repository.saveExpert({
      id,
      name: parsed.name,
      description: parsed.description,
      persona: parsed.persona,
      tools: parsed.tools
    })
  }

  async export(id: string): Promise<AgentExportResult> {
    const def = this.find(id)
    if (!def) throw new Error('专家不存在')
    return this.deps.writeExport(`${def.id}.md`, serializeExpertMarkdown(def))
  }

  /** 只启用已信任 MCP / 已装技能并设★；单条失败不阻断，汇总进 missing。 */
  activate(agent: AgentKind, id: string): ExpertActivateResult {
    const def = this.find(id)
    if (!def) throw new Error('专家不存在')
    const { apply, missing } = resolveExpertTools(
      def.tools,
      this.deps.trustedMcpIds(agent),
      this.deps.installedSkillIds(agent)
    )
    const applied: string[] = []
    for (const item of apply) {
      try {
        if (item.kind === 'mcp') this.deps.enableMcp(item.id)
        else this.deps.enableSkill(item.id, agent)
        this.deps.setPreferred(agent, item.key)
        applied.push(item.key)
      } catch {
        missing.push(item.key)
      }
    }
    return { applied, missing }
  }
}
