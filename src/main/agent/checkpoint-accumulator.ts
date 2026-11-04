import { captureFiles, type FileSnapshot } from './checkpoints'

/**
 * 一个回合内的检查点累积器。同一路径只抓第一次（写入前），
 * 审批卡允许与规则直放两条路都汇到这里。
 */
export class CheckpointAccumulator {
  private readonly files = new Map<string, FileSnapshot>()
  private readonly tools = new Set<string>()

  constructor(private readonly workspace: string) {}

  /** 记录一次写入意图；在文件真正落盘前调用。 */
  capture(paths: string[], toolName?: string): void {
    if (paths.length === 0) return
    if (toolName) this.tools.add(toolName)
    for (const snapshot of captureFiles(this.workspace, paths)) {
      if (!this.files.has(snapshot.path)) this.files.set(snapshot.path, snapshot)
    }
  }

  get size(): number {
    return this.files.size
  }

  summary(): string {
    const tools = [...this.tools].join(' / ')
    return tools || '文件改动'
  }

  take(): FileSnapshot[] {
    const files = [...this.files.values()]
    this.files.clear()
    this.tools.clear()
    return files
  }
}
