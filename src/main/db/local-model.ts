import type { DatabaseSync } from 'node:sqlite'
import type { LocalModelConfig } from '../agent/local-model'

/** 单行配置：离线本地模型的回环端点、模型名与开关。 */
export class LocalModelRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(): LocalModelConfig {
    const row = this.db
      .prepare('SELECT base_url, model, enabled FROM local_model_config WHERE id = 1')
      .get() as { base_url: string; model: string; enabled: number } | undefined
    return row
      ? { baseUrl: row.base_url, model: row.model, enabled: row.enabled === 1 }
      : { baseUrl: '', model: '', enabled: false }
  }

  save(config: LocalModelConfig): LocalModelConfig {
    this.db
      .prepare(
        `INSERT INTO local_model_config (id, base_url, model, enabled)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, model = excluded.model, enabled = excluded.enabled`
      )
      .run(config.baseUrl.trim(), config.model.trim(), config.enabled ? 1 : 0)
    return this.get()
  }
}
