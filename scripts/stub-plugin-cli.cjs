#!/usr/bin/env node
/**
 * 冒烟用的 Claude 插件 CLI stub：模拟 marketplace / install / update / uninstall，
 * 只写 CLAUDE_CONFIG_DIR 下的应用私有目录，不访问网络、不碰真实 ~/.claude。
 */
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const args = process.argv.slice(2)
const configDir = process.env.CLAUDE_CONFIG_DIR || join(process.cwd(), '.stub-claude')
const installRoot = join(configDir, 'plugins', 'cache', 'wsfo-official', 'demo-skill')
const pluginId = 'demo-skill@wsfo-official'

const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)

function versionFile() {
  return join(installRoot, 'version.json')
}

function installedVersion() {
  try {
    return JSON.parse(readFileSync(versionFile(), 'utf8')).version
  } catch {
    return ''
  }
}

function install(version) {
  mkdirSync(join(installRoot, '.claude-plugin'), { recursive: true })
  mkdirSync(join(installRoot, 'skills', 'demo'), { recursive: true })
  writeFileSync(
    join(installRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'demo-skill', version, description: 'Demo skill for smoke' })
  )
  writeFileSync(
    join(installRoot, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: Demo skill for smoke\n---\nSay hello.\n'
  )
  writeFileSync(versionFile(), JSON.stringify({ version }))
}

function installedEntry() {
  const version = installedVersion()
  if (!version) return null
  return {
    id: pluginId,
    pluginId,
    name: 'demo-skill',
    description: 'Demo skill for smoke',
    version,
    scope: 'user',
    enabled: true,
    installPath: installRoot,
    installedAt: '2026-10-30T00:00:00.000Z',
    lastUpdated: '2026-10-30T00:00:00.000Z'
  }
}

const command = args[0] === 'plugin' ? args[1] : ''
const sub = args[2]

if (command === 'marketplace' && sub === 'list') {
  out([{ name: 'wsfo-official', source: 'directory', path: process.cwd() }])
} else if (command === 'marketplace' && sub === 'add') {
  out({ command: 'marketplace-add', outcome: 'ok', marketplace: 'wsfo-official' })
} else if (command === 'list' && args.includes('--available')) {
  out({
    installed: installedEntry() ? [installedEntry()] : [],
    available: [
      {
        pluginId,
        name: 'demo-skill',
        description: 'Demo skill for smoke',
        marketplaceName: 'wsfo-official',
        source: './demo-skill',
        installCount: 12800
      }
    ]
  })
} else if (command === 'list') {
  const entry = installedEntry()
  out(entry ? [entry] : [])
} else if (command === 'install') {
  install('1.0.0')
  out({ command: 'install', outcome: 'ok', plugin: pluginId, pluginId, scope: 'user' })
} else if (command === 'update') {
  install('1.1.0')
  out({ command: 'update', outcome: 'ok', plugin: pluginId, pluginId, version: '1.1.0' })
} else if (command === 'uninstall') {
  if (existsSync(installRoot)) rmSync(installRoot, { recursive: true, force: true })
  out({ command: 'uninstall', outcome: 'ok', plugin: pluginId, pluginId })
} else {
  process.stderr.write(`stub-plugin-cli: unsupported ${args.join(' ')}\n`)
  process.exit(2)
}
