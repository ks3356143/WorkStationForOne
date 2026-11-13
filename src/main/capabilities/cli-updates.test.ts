import { describe, expect, it } from 'vitest'
import { checkCliUpdates, CLI_PACKAGES } from './cli-updates'

const latest = (version: string) => (async () => version) as (pkg: string) => Promise<string | null>

describe('checkCliUpdates', () => {
  it('有新版才产出候选，并带来源与复制命令', async () => {
    const [candidate] = await checkCliUpdates({
      versions: { claude: '2.1.318' },
      fetchLatest: latest('2.2.0')
    })
    expect(candidate.kind).toBe('cli')
    expect(candidate.source).toBe('cli')
    expect(candidate.name).toBe('Claude Code CLI')
    expect(candidate.command).toBe(`npm install -g ${CLI_PACKAGES.claude}`)
  })

  it('同版本或更旧不产出', async () => {
    expect(
      await checkCliUpdates({ versions: { claude: '2.1.318' }, fetchLatest: latest('2.1.318') })
    ).toEqual([])
    expect(
      await checkCliUpdates({ versions: { codex: '0.167.0' }, fetchLatest: latest('0.160.0') })
    ).toEqual([])
  })

  it('未安装 / 查询失败静默跳过', async () => {
    expect(await checkCliUpdates({ versions: {}, fetchLatest: latest('9.9.9') })).toEqual([])
    expect(
      await checkCliUpdates({
        versions: { codex: '0.167.0' },
        fetchLatest: async () => {
          throw new Error('offline')
        }
      })
    ).toEqual([])
  })
})
