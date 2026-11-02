import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Codex 没有 `plugin enable` 子命令，启用状态只存在于私有 config.toml 的
 * `[plugins."name@market"] enabled`。这里只改目标行，其余表与注释原样保留。
 *
 * 写入前自己断言一次目标在应用私有 codex-home 内：这条是安全底线，
 * 不能依赖调用方记得先调 `assertPrivateCodexHome`。
 */
export function setCodexPluginEnabled(
  codexHome: string,
  pluginId: string,
  market: string,
  enabled: boolean,
  appDataDir: string
): void {
  assertPrivateCodexHome(codexHome, appDataDir)
  const file = configPathFor(codexHome)
  const selector = `${pluginId}@${market}`
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const next = rewritePluginEnabled(text, selector, enabled)
  writeFileSync(file, next, { encoding: 'utf8', mode: 0o600 })
}

/**
 * 在 TOML 文本里改单个 `[plugins."x@y"]` 表的 enabled。
 * 表不存在时追加；存在时只替换该表内的 enabled 行，其它内容逐字保留。
 */
export function rewritePluginEnabled(text: string, selector: string, enabled: boolean): string {
  const header = `[plugins.${JSON.stringify(selector)}]`
  const lines = text.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => line.trim() === header)
  const value = enabled ? 'true' : 'false'

  if (headerIndex === -1) {
    const prefix = text.endsWith('\n') || text === '' ? text : `${text}\n`
    const spacer = prefix === '' ? '' : '\n'
    return `${prefix}${spacer}${header}\nenabled = ${value}\n`
  }

  // 找到该表的结束位置：下一个以 [ 开头的行
  let endIndex = lines.length
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      endIndex = index
      break
    }
  }

  let replaced = false
  for (let index = headerIndex + 1; index < endIndex; index += 1) {
    if (/^\s*enabled\s*=/.test(lines[index])) {
      lines[index] = `enabled = ${value}`
      replaced = true
      break
    }
  }
  if (!replaced) lines.splice(headerIndex + 1, 0, `enabled = ${value}`)

  return lines.join('\n')
}

/** 读 config.toml 里某个插件的 enabled；缺表视为未安装。 */
export function readCodexPluginEnabled(
  text: string,
  selector: string
): { present: boolean; enabled: boolean } {
  const header = `[plugins.${JSON.stringify(selector)}]`
  const lines = text.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => line.trim() === header)
  if (headerIndex === -1) return { present: false, enabled: false }
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) break
    const match = /^\s*enabled\s*=\s*(true|false)/.exec(lines[index])
    if (match) return { present: true, enabled: match[1] === 'true' }
  }
  return { present: true, enabled: false }
}

/**
 * 改写前必须确认目标是应用私有 codex-home。
 * 用户自己的 ~/.codex/config.toml 永不写入——这是整个插件功能的安全底线。
 */
export function assertPrivateCodexHome(codexHome: string, appDataDir: string): void {
  const target = resolve(codexHome)
  const base = resolve(appDataDir)
  const rel = relative(base, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('拒绝写入应用私有目录之外的 Codex 配置')
  }
  if (!/[/\\]?codex-home$/.test(target)) {
    throw new Error('Codex 配置目录必须是应用私有的 codex-home')
  }
}

export function configPathFor(codexHome: string): string {
  return join(codexHome, 'config.toml')
}
