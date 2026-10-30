import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAgentCli, resolveCodexCli, resolveCommand, shimTarget } from './cli'

describe('Windows CLI shim', () => {
  it('展开 %dp0% 并返回引号里的可执行文件', () => {
    const dir = 'C:\\global'
    expect(
      shimTarget(
        '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*\r\n',
        dir
      )
    ).toBe('C:\\global\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe')
  })

  it('支持 %~dp0 写法与 node 脚本包装', () => {
    const dir = 'C:\\global'
    expect(shimTarget('"%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n', dir)).toBe(
      'C:\\global\\node_modules\\@openai\\codex\\bin\\codex.js'
    )
  })

  it('没有可识别目标时返回 null', () => {
    expect(shimTarget('@ECHO off\r\nREM 没有入口\r\n', 'C:\\global')).toBeNull()
  })
})

describe('解析本机 CLI', () => {
  it.skipIf(process.platform !== 'win32')('把 .cmd 包装解到原生 exe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-cli-'))
    writeFileSync(join(dir, 'tool.exe'), '')
    writeFileSync(join(dir, 'tool.cmd'), '@ECHO off\r\n"%dp0%\\tool.exe" %*\r\n')

    expect(resolveAgentCli({ WS_AGENT_CLI: join(dir, 'tool.cmd'), PATH: '' })).toMatchObject({
      bin: join(dir, 'tool.exe'),
      prefixArgs: [],
      viaNode: false
    })
  })

  it.skipIf(process.platform !== 'win32')('把 .cmd 包装解到 node 脚本', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-cli-'))
    const script = join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(script, '')
    writeFileSync(
      join(dir, 'codex.cmd'),
      '@ECHO off\r\n"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n'
    )

    expect(resolveCodexCli({ WS_CODEX_CLI: join(dir, 'codex.cmd'), PATH: '' })).toMatchObject({
      bin: process.execPath,
      prefixArgs: [script],
      viaNode: true
    })
  })

  it.skipIf(process.platform !== 'win32')('解析 npm 变量包装（npx.cmd）到 npx-cli.js', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-cli-'))
    const script = join(dir, 'node_modules', 'npm', 'bin', 'npx-cli.js')
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(script, '')
    writeFileSync(join(dir, 'node.exe'), '')
    writeFileSync(
      join(dir, 'npx.cmd'),
      [
        '@ECHO OFF',
        'SET "NODE_EXE=%~dp0\\node.exe"',
        'SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"',
        '"%NODE_EXE%" "%NPX_CLI_JS%" %*'
      ].join('\r\n')
    )

    expect(resolveCommand('npx', { PATH: dir })).toMatchObject({
      bin: process.execPath,
      prefixArgs: [script],
      viaNode: true
    })
  })

  it('解析失败时返回 null，交给调用方明确报错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-cli-'))
    writeFileSync(join(dir, 'broken.cmd'), '@ECHO off\r\nREM 指向不存在的文件\r\n')

    expect(resolveAgentCli({ WS_AGENT_CLI: join(dir, 'broken.cmd'), PATH: '' })).toBeNull()
  })
})
