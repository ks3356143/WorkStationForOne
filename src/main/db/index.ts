import { app } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AgentRepository } from './agent'
import { ApprovalRuleRepository } from './approval-rules'
import { AuditLog } from './audit'
import { ExpertRepository } from './experts'
import { ToolPrefRepository } from './tool-prefs'
import { migrate, openDatabase } from './database'
import { applyPendingRestore } from './restore'
import { HabitRepository } from './habits'
import { LearningRepository } from './learning'
import { McpPolicyRepository } from './mcp'
import { NoteRepository } from './notes'
import { ProviderRepository } from './providers'
import { ReminderMuteRepository } from './reminders'
import { runInTransaction } from './transaction'
import { TaskRepository } from './tasks'
import { dateKey } from '../../shared/date-key'
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
  experts: ExpertRepository
  providers: ProviderRepository
  mcp: McpPolicyRepository
  approvalRules: ApprovalRuleRepository
  toolPrefs: ToolPrefRepository
  reminders: ReminderMuteRepository
  audit: AuditLog
  /** 可嵌套事务；MCP 写入用它把业务写入和审计绑在一起 */
  transaction: <T>(run: () => T) => T
  close: () => void
}

export function initDatabase(): DatabaseContext {
  // 优先级：WS_DATA_DIR（测试缝）> 位置文件 > 默认根。
  const appData = app.getPath('appData')
  const envDataDir = process.env.WS_DATA_DIR
  const resolved = resolveAppRoot({
    locationFile: locationFileFor(appData),
    ...(envDataDir ? { envDataDir } : {}),
    fallbackRoot: defaultAppDir(appData)
  })
  if (resolved.location.error) console.error('[storage]', resolved.location.error)
  const layout = resolveLayout(resolved.root)
  // WS_DATA_DIR 历来直接指向 data 目录；只在该模式下沿用它的原值，
  // 其余情况由根目录派生，避免把它多套一层 data/。
  const dataDir = envDataDir ? resolve(envDataDir) : layout.dataDir
  mkdirSync(dataDir, { recursive: true })
  const dbFile = join(dataDir, 'workstation.db')
  const backupDir = join(dataDir, 'backups')
  // 恢复必须在开库之前完成；失败会回滚到恢复前的数据库，不阻断启动。
  const restore = applyPendingRestore({ dbFile, dataDir, backupDir })
  if (restore.applied) console.info(`[restore] 已从 ${restore.backup} 恢复`)
  else if (restore.error) console.error('[restore]', restore.error)
  const db = openDatabase(dbFile)
  migrate(db)
  const audit = new AuditLog(db)
  // 环境变量模式下 codex-home 跟着 data 目录走，与既有冒烟/校验的落点一致；
  // 正常模式才放到根目录下，和插件目录同级。
  const codexHome = envDataDir ? join(dataDir, 'codex-home') : layout.codexHome
  const reminders = new ReminderMuteRepository(db)
  try {
    reminders.pruneBefore(dateKey())
  } catch (error) {
    console.error('[reminder] 清理过期静音记录失败', error)
  }
  return {
    file: dbFile,
    layout: { ...layout, dataDir, dbFile, backupDir, codexHome },
    db,
    audit,
    tasks: new TaskRepository(db, audit),
    notes: new NoteRepository(db, audit),
    learning: new LearningRepository(db, audit),
    habits: new HabitRepository(db, audit),
    agent: new AgentRepository(db),
    experts: new ExpertRepository(db),
    providers: new ProviderRepository(db),
    mcp: new McpPolicyRepository(db, audit),
    approvalRules: new ApprovalRuleRepository(db),
    toolPrefs: new ToolPrefRepository(db),
    reminders,
    transaction: (run) => runInTransaction(db, run),
    close: () => db.close()
  }
}
