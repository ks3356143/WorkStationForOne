import type { ExpertDef } from '../experts'
import type { AgentExportResult, AgentKind } from './agent'

/** 内置与自定义合并后的专家视图；内置没有创建 / 更新时间。 */
export interface ExpertRecord extends ExpertDef {
  builtin: boolean
  createdAt?: number
  updatedAt?: number
}

export interface ExpertSaveInput {
  /** 传入即更新已有自定义专家；省略则新建 */
  id?: string
  name: string
  description: string
  persona: string
  tools: string[]
}

export interface ExpertSourceRecord {
  id: string
  name: string
  url: string
  ref: string
  root: string
  lastSyncedAt: number | null
  lastError: string
  createdAt: number
  updatedAt: number
}

export interface ExpertSourceInput {
  name: string
  url: string
  ref?: string
}

/** 市场浏览条目：只带展示字段，人设正文在导入时再读文件。 */
export interface ExpertMarketEntry {
  sourceId: string
  sourceName: string
  relPath: string
  id: string
  name: string
  description: string
  tools: string[]
}

export interface ExpertActivateResult {
  /** 已启用并设为★的工具键 */
  applied: string[]
  /** 未安装 / 未信任而跳过的工具键 */
  missing: string[]
}

export interface ExpertMarketApi {
  sources: () => Promise<ExpertSourceRecord[]>
  addSource: (input: ExpertSourceInput) => Promise<ExpertSourceRecord>
  removeSource: (id: string) => Promise<void>
  refresh: (id: string) => Promise<ExpertSourceRecord>
  list: () => Promise<ExpertMarketEntry[]>
  import: (sourceId: string, relPath: string) => Promise<ExpertRecord>
}

export interface ExpertApi {
  list: () => Promise<ExpertRecord[]>
  save: (input: ExpertSaveInput) => Promise<ExpertRecord>
  remove: (id: string) => Promise<boolean>
  importMarkdown: (text: string) => Promise<ExpertRecord>
  export: (id: string) => Promise<AgentExportResult>
  activate: (agent: AgentKind, id: string) => Promise<ExpertActivateResult>
  market: ExpertMarketApi
}
