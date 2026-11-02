import { safeStorage } from 'electron'

/**
 * 把加密的密钥表解成明文。
 * 只在主进程、只为本次子进程环境或本次连接测试调用；结果不落库、不写日志。
 */
export function decryptSecrets(map: Map<string, Buffer>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, encrypted] of map) {
    result[key] = safeStorage.decryptString(encrypted)
  }
  return result
}
