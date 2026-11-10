import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  fetchLatestVersion,
  installRuntime,
  readManaged,
  resolveManagedCli,
  uninstallRuntime,
  versionFromTag
} from './runtimes'
import { RECOMMENDED_CLI_TOOLS } from '../../shared/recommendations'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-runtimes-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 用本机 node.exe充当假二进制，--version 能真的打印版本，校验链路不被架空。 */
function fixtureZip(): string {
  const dir = tempDir()
  const payload = join(dir, 'payload')
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `New-Item -ItemType Directory -Path '${payload}' | Out-Null`
  ])
  copyFileSync(process.execPath, join(payload, 'uv.exe'))
  copyFileSync(process.execPath, join(payload, 'uvx.exe'))
  const zip = join(dir, 'fixture.zip')
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${payload}\\*' -DestinationPath '${zip}' -Force`
  ])
  return zip
}

function serveFile(file: string): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/zip')
      res.end(readFileSync(file))
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ url: `http://127.0.0.1:${port}/fixture.zip`, close: () => server.close() })
    })
  })
}

describe('托管运行时', () => {
  it('release tag 去前缀得到纯版本', () => {
    expect(versionFromTag('bun-v1.4.2', 'bun-v')).toBe('1.4.2')
    expect(versionFromTag('0.13.6', '')).toBe('0.13.6')
    expect(versionFromTag('v24.0.0', 'v')).toBe('24.0.0')
  })

  it('下载解压校验后记录版本，卸载清干净', async () => {
    const dataDir = tempDir()
    const zip = fixtureZip()
    const server = await serveFile(zip)
    try {
      const installed = await installRuntime(dataDir, 'uv', {
        version: '9.9.9',
        assetUrl: server.url
      })
      expect(installed.version).toBe('9.9.9')
      expect(existsSync(join(installed.binDir, 'uv.exe'))).toBe(true)
      expect(existsSync(join(installed.binDir, 'uvx.exe'))).toBe(true)
      expect(readManaged(dataDir, 'uv')?.version).toBe('9.9.9')
      const resolved = resolveManagedCli(dataDir, 'uvx', true)
      expect(resolved?.bin).toBe(join(installed.binDir, 'uvx.exe'))
      expect(resolveManagedCli(dataDir, 'uvx', false)).toBeNull()
      uninstallRuntime(dataDir, 'uv')
      expect(readManaged(dataDir, 'uv')).toBeNull()
    } finally {
      server.close()
    }
  }, 30000)

  it('最新版本查询失败时静默返回 null', async () => {
    const meta = RECOMMENDED_CLI_TOOLS.find((tool) => tool.id === 'uv')!.runtime!
    const latest = await fetchLatestVersion(meta, async () => {
      throw new Error('offline')
    })
    expect(latest).toBeNull()
  })

  it('GitHub 与 node index 两种响应都能解析', async () => {
    const bun = RECOMMENDED_CLI_TOOLS.find((tool) => tool.id === 'bun')!.runtime!
    const node = RECOMMENDED_CLI_TOOLS.find((tool) => tool.id === 'node')!.runtime!
    const gh = await fetchLatestVersion(
      bun,
      async () => new Response(JSON.stringify({ tag_name: 'bun-v1.4.2' }), { status: 200 })
    )
    expect(gh).toBe('1.4.2')
    const nj = await fetchLatestVersion(
      node,
      async () =>
        new Response(JSON.stringify([{ version: 'v24.9.0' }, { version: 'v24.8.0' }]), {
          status: 200
        })
    )
    expect(nj).toBe('24.9.0')
  })
})
