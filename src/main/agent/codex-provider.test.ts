import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderRuntime } from '../providers'
import { writeCodexProviderConfig } from './codex'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const provider: ProviderRuntime = {
  baseUrl: 'https://api.example.test/v1',
  model: 'deepseek/deepseek-v4.1-flash',
  token: 'secret-token',
  target: 'codex',
  wireApi: 'responses'
}

describe('Codex Provider 隔离', () => {
  it('写工具自己的 CODEX_HOME 配置，token 只在环境变量里', () => {
    const home = mkdtempSync(join(tmpdir(), 'wsfo-codex-home-'))
    dirs.push(home)
    writeCodexProviderConfig(home, provider)
    const config = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(config).toContain('model_provider = "workstation"')
    expect(config).toContain('base_url = "https://api.example.test/v1"')
    expect(config).toContain('model = "deepseek/deepseek-v4.1-flash"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).toContain('env_key = "WS_CODEX_PROVIDER_TOKEN"')
    expect(config).not.toContain(provider.token)
  })
})
