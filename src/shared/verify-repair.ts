// 执行后验证修复：生成「跑验证并修复」的提示词，由用户点击预填、用户发送。
// 不在主进程自动执行命令，也不自动重试副作用回合。

const MAX_PATHS = 20

export function buildVerifyPrompt(changedPaths: string[]): string {
  const paths = Array.from(new Set(changedPaths.map((p) => p.trim()).filter(Boolean))).slice(
    0,
    MAX_PATHS
  )
  const lines = ['请对本轮改动做一次验证并修复：']
  if (paths.length > 0) {
    lines.push(`本轮改动文件：\n${paths.map((path) => `- ${path}`).join('\n')}`)
  }
  lines.push(
    '步骤：1) 在本工作区运行项目的类型检查与测试（如 npm run typecheck、npm test）；2) 如失败，定位并修复；3) 修复后再跑一遍；4) 最后用中文总结改了什么、验证结果。',
    '不要提交代码，不要推送。'
  )
  return lines.join('\n\n')
}
