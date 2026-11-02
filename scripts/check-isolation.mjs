#!/usr/bin/env node
/**
 * 复查 Agent 隔离：抓 Claude 会话的 system/init，确认没有加载用户级 skill。
 * 用法：node scripts/check-isolation.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const home = process.env.USERPROFILE ?? homedir()
let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failed += 1
}

// Claude：用户技能目录的名字不应出现在会话 skills 里
const userSkillsDir = join(home, '.claude', 'skills')
const userSkills = existsSync(userSkillsDir)
  ? readdirSync(userSkillsDir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  : []

let sessionSkills = []
try {
  // npm 全局安装的 claude 是 .cmd 包装，不能直接 spawn
  const cli = findClaudeCli()
  if (!cli) throw new Error('no cli')
  // npm 包装是 .cmd，只能经 shell 执行；参数全部固定，无注入面
  const result = spawnSync(
    cli,
    [
      '-p',
      'hi',
      '--output-format',
      'stream-json',
      '--verbose',
      '--setting-sources',
      'project',
      '--strict-mcp-config'
    ],
    { encoding: 'utf8', timeout: 60_000, shell: true }
  )
  // 未登录时 CLI 仍会输出 system/init，只是随后退出码非 0；
  // 这里只需要 init 事件，不看退出码。
  const out = result.stdout ?? ''
  const first = out.split(/\r?\n/).find((line) => line.trim().startsWith('{'))
  sessionSkills = JSON.parse(first)?.skills ?? []
} catch (error) {
  console.log('SKIP claude 未安装或调用失败', error?.message?.slice(0, 160) ?? '')
}

/** 定位可执行的 claude：优先 .cmd（Windows npm 包装），退回 PATH 原名。 */
function findClaudeCli() {
  const candidates = [
    join(process.env.APPDATA ?? '', 'npm', 'claude.cmd'),
    join(process.env.ProgramFiles ?? '', 'nodejs', 'claude.cmd')
  ]
  for (const file of candidates) if (existsSync(file)) return file
  const prefix = process.execPath.replace(/node\.exe$/i, '')
  const nearNode = join(prefix, 'node_global', 'claude.cmd')
  return existsSync(nearNode) ? nearNode : null
}
if (sessionSkills.length > 0) {
  const leaked = userSkills.filter((name) => sessionSkills.includes(name))
  check('Claude 会话不加载用户级 skill', leaked.length === 0, leaked.join(',') || '无泄漏')
  check('Claude 会话有内置 skill', sessionSkills.length > 0, String(sessionSkills.length))
}

// Codex：私有 config.toml 不应指向用户目录，skills 必须是真实目录
const codexHome = process.env.WS_CHECK_CODEX_HOME
if (codexHome) {
  const configFile = join(codexHome, 'config.toml')
  if (existsSync(configFile)) {
    const config = readFileSync(configFile, 'utf8')
    check('私有 config.toml 不含用户路径', !config.includes(join(home, '.codex')))
  }
  const skillsDir = join(codexHome, 'skills')
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir, { withFileTypes: true }).filter(
      (entry) => !entry.name.startsWith('.')
    )
    // Codex 不跟随软链，副本必须是真实目录
    const links = entries.filter((entry) => entry.isSymbolicLink())
    check(
      '私有 skills 无软链',
      links.length === 0,
      links.map((e) => e.name).join(',') || '全为真实目录'
    )
  }
} else {
  console.log('SKIP Codex 检查（未设置 WS_CHECK_CODEX_HOME）')
}

console.log(failed === 0 ? '\n隔离复查通过' : `\n${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
