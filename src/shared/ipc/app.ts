export type Theme = 'dark' | 'light'

export type Skin = 'prism' | 'classic'

export interface BackupResult {
  file: string
  dir: string
  bytes: number
  at: number
}

export interface AppInfo {
  version: string
  dataDir: string
  backupDir: string
  backupCount: number
}

export interface StorageInfo {
  /** 当前生效的根目录 */
  root: string
  /** 位置来源：环境变量 / 位置文件 / 默认值 */
  source: 'env' | 'file' | 'default'
  /** 已选定等待重启迁移的目标 */
  pending: string | null
  /** 上一次迁移的失败原因或旧目录残留提示 */
  lastError: string
  /** 根目录下的固定子目录，仅供展示 */
  layout: string[]
  /** 环境变量接管时不允许在界面改路径 */
  locked: boolean
}

export interface AppApi {
  setTheme: (theme: Theme) => Promise<void>
  backupNow: () => Promise<BackupResult>
  info: () => Promise<AppInfo>
  storage: () => Promise<StorageInfo>
  pickStorage: () => Promise<StorageInfo>
  cancelStorage: () => Promise<StorageInfo>
}
