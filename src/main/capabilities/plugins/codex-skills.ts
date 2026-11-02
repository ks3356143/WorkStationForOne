import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

/**
 * Codex 只扫描 `<CODEX_HOME>/skills/` 下的真实目录，不跟随插件缓存。
 * 实测：软链与目录联接都不会被识别，必须真实复制。
 * 目标始终是应用私有 codex-home，绝不碰用户的 ~/.codex。
 */
export interface SyncPluginSkillsInput {
  codexHome: string
  /** 插件安装目录，通常是 plugins/cache/<market>/<plugin>/<version> */
  pluginRoot: string
  /** 插件 id，形如 `name@market`，用于记录归属 */
  pluginId: string
}

export interface SyncResult {
  synced: string[]
  removed: string[]
  errors: string[]
}

/** 同步标记文件：记录某个 skill 目录由哪个插件同步而来。 */
const MARKER = '.wsfo-skill-source.json'

function skillsDir(codexHome: string): string {
  return join(codexHome, 'skills')
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function readMarker(dir: string): { pluginId: string } | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as Record<string, unknown>
    return typeof raw.pluginId === 'string' ? { pluginId: raw.pluginId } : null
  } catch {
    return null
  }
}

function writeMarker(dir: string, pluginId: string): void {
  writeFileSync(join(dir, MARKER), JSON.stringify({ pluginId }, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  })
}

/** 列出插件目录里的 skill 名。 */
export function pluginSkillNames(pluginRoot: string): string[] {
  const dir = join(pluginRoot, 'skills')
  if (!existsSync(dir)) return []
  return readdirSafe(dir)
}

/** 复制插件里的 skills 到 CODEX_HOME/skills，并写入来源标记。 */
export function syncPluginSkills(input: SyncPluginSkillsInput): SyncResult {
  const result: SyncResult = { synced: [], removed: [], errors: [] }
  const names = pluginSkillNames(input.pluginRoot)
  if (names.length === 0) return result

  const target = skillsDir(input.codexHome)
  mkdirSync(target, { recursive: true })

  for (const name of names) {
    const from = join(input.pluginRoot, 'skills', name)
    const to = join(target, name)
    try {
      // 同名但属于别的插件时先记一笔，避免两个插件互相覆盖却没痕迹
      const existing = readMarker(to)
      if (existing && existing.pluginId !== input.pluginId) result.removed.push(name)
      rmSync(to, { recursive: true, force: true })
      cpSync(from, to, { recursive: true, force: true })
      writeMarker(to, input.pluginId)
      result.synced.push(name)
    } catch (error) {
      result.errors.push(`${name}: ${error instanceof Error ? error.message : '复制失败'}`)
    }
  }
  return result
}

/** 该插件在 CODEX_HOME/skills 下同步过的 skill 名。 */
export function syncedSkillsOf(codexHome: string, pluginId: string): string[] {
  const target = skillsDir(codexHome)
  if (!existsSync(target)) return []
  return readdirSafe(target).filter((name) => readMarker(join(target, name))?.pluginId === pluginId)
}

/** 停用或卸载插件时，删掉它同步过来的 skill 副本。 */
export function removeSyncedSkills(codexHome: string, pluginId: string): string[] {
  const removed: string[] = []
  const target = skillsDir(codexHome)
  for (const name of syncedSkillsOf(codexHome, pluginId)) {
    try {
      rmSync(join(target, name), { recursive: true, force: true })
      removed.push(name)
    } catch {
      // 删不掉时保留，下次同步会覆盖
    }
  }
  return removed
}
