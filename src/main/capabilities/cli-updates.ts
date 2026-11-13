import { compareVersion } from './plugins/adapters'
import type { UpdateCandidate } from './updates'

/** 本机 CLI 对应的 npm 包，用于查询最新版；更新命令只给用户复制，不代执行。 */
export const CLI_PACKAGES = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex'
} as const

export type CliAgent = keyof typeof CLI_PACKAGES

export interface CliUpdateInput {
  /** 当前已装版本；空串表示未安装或读不到 */
  versions: Partial<Record<CliAgent, string>>
  fetchLatest: (pkg: string) => Promise<string | null>
}

export async function checkCliUpdates(input: CliUpdateInput): Promise<UpdateCandidate[]> {
  const results: UpdateCandidate[] = []
  for (const agent of Object.keys(CLI_PACKAGES) as CliAgent[]) {
    const current = (input.versions[agent] ?? '').trim()
    if (!current) continue
    let latest: string | null = null
    try {
      latest = await input.fetchLatest(CLI_PACKAGES[agent])
    } catch {
      latest = null
    }
    if (!latest || compareVersion(latest, current) <= 0) continue
    results.push({
      kind: 'cli',
      id: `cli:${agent}`,
      name: agent === 'claude' ? 'Claude Code CLI' : 'Codex CLI',
      current,
      latest,
      source: 'cli',
      command: `npm install -g ${CLI_PACKAGES[agent]}`,
      note: '更新后 agent 能用到 CLI 的最新工具与参数'
    })
  }
  return results
}
