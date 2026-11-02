import { app } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { AgentRepository } from './agent'
import { ApprovalRuleRepository } from './approval-rules'
import { AuditLog } from './audit'
import { migrate, openDatabase } from './database'
import { HabitRepository } from './habits'
import { LearningRepository } from './learning'
import { McpPolicyRepository } from './mcp'
import { NoteRepository } from './notes'
import { ProviderRepository } from './providers'
import { runInTransaction } from './transaction'
import { TaskRepository } from './tasks'
import {
  defaultAppDir,
  locationFileFor,
  resolveAppRoot,
  resolveLayout,
  type StorageLayout
} from '../storage/location'

export interface DatabaseContext {
  /** 库文件路径与原始连接：备份模块要直接对连接做 VACUUM INTO */
  file: string
  /** 本次启动解析出的存储布局；插件、备份、codex-home 都从它取路径 */
  layout: StorageLayout
  db: DatabaseSync
  tasks: TaskRepository
  notes: NoteRepository
  learning: LearningRepository
  habits: HabitRepository
  agent: AgentRepository
  providers: ProviderRepository
  mcp: McpPolicyRepository
  approvalRules: ApprovalRuleRepository
  audit: AuditLog
  /** 可嵌套事务；MCP 写入用它把业务写入和审计绑在一起 */
  transaction: <T>(run: () => T) => T
  close: () => void
}

export function initDatabase(): DatabaseContext {
  // 优先级：WS_DATA_DIR（测试缝）> 位置文件 > 默认根。
  const appData = app.getPath('appData')
  const resolved = resolveAppRoot({
    locationFile: locationFileFor(appData),
    ...(process.env.WS_DATA_DIR ? { envDataDir: process.env.WS_DATA_DIR } : {}),
    fallbackRoot: defaultAppDir(appData)
  })
  if (resolved.location.error) console.error('[storage]', resolved.location.error)
  const layout = resolveLayout(resolved.root)
  mkdirSync(layout.dataDir, { recursive: true })
  const db = openDatabase(layout.dbFile)
  migrate(db)
  const audit = new AuditLog(db)
  return {
    file: layout.dbFile,
    layout,
    db,
    audit,
    tasks: new TaskRepository(db, audit),
    notes: new NoteRepository(db, audit),
    learning: new LearningRepository(db, audit),
    habits: new HabitRepository(db, audit),
    agent: new AgentRepository(db),
    providers: new ProviderRepository(db),
    mcp: new McpPolicyRepository(db, audit),
    approvalRules: new ApprovalRuleRepository(db),
    transaction: (run) => runInTransaction(db, run),
    close: () => db.close()
  }
}
