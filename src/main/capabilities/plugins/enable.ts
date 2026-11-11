import type { PluginAgent } from '../../../shared/ipc'
import type { CapabilityCenter } from '../index'
import { splitPluginId } from './components'
import { setCodexPluginEnabled } from './codex-config'
import { removeSyncedSkills, syncPluginSkills } from './codex-skills'

/**
 * 按 Agent 启停技能：Claude 走插件服务（含 hooks/MCP 信任门），
 * Codex 改写私有 config.toml 的 enabled 并同步 / 删除 CODEX_HOME/skills 副本。
 * 插件启停 IPC 与专家激活共用，避免两条路径漂移。
 */
export function enablePluginForAgent(
  center: CapabilityCenter,
  id: string,
  agent: PluginAgent,
  enabled: boolean
): void {
  const plugin = center.repository.findPlugin(id, agent)
  if (!plugin) throw new Error('插件未安装')
  if (agent === 'codex') {
    const { name, market } = splitPluginId(id)
    setCodexPluginEnabled(center.codexHome, name, market, enabled, center.agentDir)
    if (enabled) {
      syncPluginSkills({
        codexHome: center.codexHome,
        pluginRoot: plugin.installPath,
        pluginId: id
      })
    } else {
      removeSyncedSkills(center.codexHome, id)
    }
    center.repository.setPluginEnabled(id, enabled, undefined, agent)
    return
  }
  center.plugins.setEnabled(id, enabled)
}
