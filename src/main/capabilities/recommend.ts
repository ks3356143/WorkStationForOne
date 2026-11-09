import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { RECOMMENDED_CLI_TOOLS } from '../../shared/recommendations'

const EXECUTABLE_EXTS = ['.exe', '.cmd', '.bat', '.com']

/** PATH 中某条命令的候选文件（Windows 可执行扩展名按优先级排列）。 */
export function pathCandidates(name: string, pathValue: string): string[] {
  const dirs = pathValue
    .split(delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean)
  return dirs.flatMap((dir) => EXECUTABLE_EXTS.map((ext) => join(dir, `${name}${ext}`)))
}

/** 推荐工具在本机 PATH 里的安装状态；只读文件存在性，不 spawn、不联网。 */
export function scanRecommended(
  pathValue: string,
  exists: (file: string) => boolean = existsSync
): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const tool of RECOMMENDED_CLI_TOOLS) {
    result[tool.id] = tool.detect.some((name) =>
      pathCandidates(name, pathValue).some((file) => exists(file))
    )
  }
  return result
}
