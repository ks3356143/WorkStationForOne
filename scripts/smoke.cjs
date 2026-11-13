const { app, BrowserWindow } = require('electron')
const { createServer } = require('node:http')
const { join } = require('node:path')
const {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')

// 冒烟跑真实主进程：SQLite、preload 与 IPC 全部走生产路径。
// 数据库、Chromium 存储与单实例锁都隔离到临时目录，避免污染真实工作站。
// 退出时 Chromium 仍持有缓存句柄，当次目录删不干净；改为启动时清理一小时前的残留。
function pruneStaleDirs() {
  const base = tmpdir()
  for (const name of readdirSync(base)) {
    if (!name.startsWith('ws-smoke-')) continue
    const path = join(base, name)
    try {
      if (Date.now() - statSync(path).mtimeMs < 60 * 60 * 1000) continue
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch {
      // 被其他进程占用时留到下次启动再清。
    }
  }
}

pruneStaleDirs()

const dataDir = mkdtempSync(join(tmpdir(), 'ws-smoke-'))
const userDir = join(dataDir, 'user')
const sessionDir = join(dataDir, 'session')
const agentWorkspace = join(dataDir, 'workspace')
const stubMcpServer = join(__dirname, 'stub-mcp-server.cjs')
const localSkillDir = join(dataDir, 'local-skill')
const sessionScanRoot = join(dataDir, 'home')
mkdirSync(userDir, { recursive: true })
mkdirSync(sessionDir, { recursive: true })
mkdirSync(agentWorkspace, { recursive: true })
mkdirSync(join(agentWorkspace, 'src'), { recursive: true })
writeFileSync(join(agentWorkspace, 'smoke-note.txt'), 'workspace smoke preview')
writeFileSync(join(agentWorkspace, 'src', 'main.ts'), 'const smoke = true')
writeFileSync(join(agentWorkspace, 'checkpoint.txt'), '原始内容')
mkdirSync(localSkillDir, { recursive: true })
writeFileSync(
  join(localSkillDir, 'SKILL.md'),
  '---\nname: local-skill\ndescription: local smoke skill\n---\nLocal smoke skill body.\n'
)
process.env.WS_PICK_SKILL = localSkillDir

// 更新横幅用：一个本地插件源，清单里 demo-skill 的版本高于已装版本，
// 这样启动检查能产出真实候选，横幅的「全部更新」才可点。
const updateSourceDir = join(dataDir, 'update-source')
mkdirSync(join(updateSourceDir, '.claude-plugin'), { recursive: true })
mkdirSync(join(updateSourceDir, 'plugins', 'demo-skill', '.claude-plugin'), { recursive: true })
writeFileSync(
  join(updateSourceDir, '.claude-plugin', 'marketplace.json'),
  JSON.stringify({
    name: 'wsfo-official',
    owner: { name: 'smoke' },
    plugins: [{ name: 'demo-skill', source: './plugins/demo-skill', description: 'Demo skill' }]
  })
)
writeFileSync(
  join(updateSourceDir, 'plugins', 'demo-skill', '.claude-plugin', 'plugin.json'),
  JSON.stringify({ name: 'demo-skill', version: '1.2.0', description: 'Demo skill' })
)
process.env.WS_SMOKE_UPDATE_SOURCE = updateSourceDir

// 专家市场用：一个本地子代理 Markdown 源，供添加源 / 浏览 / 导入断言
const expertSourceDir = join(dataDir, 'expert-source')
mkdirSync(expertSourceDir, { recursive: true })
writeFileSync(
  join(expertSourceDir, 'reviewer.md'),
  '---\nname: smoke-reviewer\ndescription: 冒烟代码审查专家\nmcp: [context7]\n---\n你是冒烟代码审查专家。\n'
)
writeFileSync(join(expertSourceDir, 'not-an-expert.md'), '没有 frontmatter 的普通文档\n')

// 本机会话扫描只读指向临时 home，绝不读取真实的 ~/.claude 或 ~/.codex
const claudeScanDir = join(sessionScanRoot, '.claude', 'projects', '-smoke-workspace')
const codexScanDir = join(sessionScanRoot, '.codex', 'sessions', '2026', '10', '30')
mkdirSync(claudeScanDir, { recursive: true })
mkdirSync(codexScanDir, { recursive: true })
// 插件导入扫描也读这个临时 home：给两个 Agent 各放一份最小配置
const scanClaudePlugins = join(sessionScanRoot, '.claude', 'plugins')
mkdirSync(join(scanClaudePlugins, 'cache', 'smoke-market', 'smoke-plugin', '1.0.0'), {
  recursive: true
})
writeFileSync(
  join(scanClaudePlugins, 'known_marketplaces.json'),
  JSON.stringify({
    'smoke-market': { source: { source: 'github', repo: 'smoke/plugins' } }
  })
)
writeFileSync(
  join(scanClaudePlugins, 'installed_plugins.json'),
  JSON.stringify({
    version: 2,
    plugins: {
      'smoke-plugin@smoke-market': [
        {
          scope: 'user',
          installPath: join(scanClaudePlugins, 'cache', 'smoke-market', 'smoke-plugin', '1.0.0'),
          version: '1.0.0'
        }
      ]
    }
  })
)
mkdirSync(join(sessionScanRoot, '.codex'), { recursive: true })
writeFileSync(
  join(sessionScanRoot, '.codex', 'config.toml'),
  [
    '[marketplaces.smoke-market]',
    'source_type = "git"',
    'source = "https://github.com/smoke/plugins.git"',
    '',
    '[plugins."smoke-plugin@smoke-market"]',
    'enabled = true',
    ''
  ].join('\n')
)
writeFileSync(
  join(claudeScanDir, 'smoke-claude-import.jsonl'),
  [
    JSON.stringify({
      type: 'user',
      cwd: agentWorkspace,
      timestamp: '2026-10-30T09:00:00.000Z',
      message: { content: '导入 Claude 冒烟会话' }
    }),
    JSON.stringify({
      type: 'assistant',
      cwd: agentWorkspace,
      timestamp: '2026-10-30T09:01:00.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '先读一下文件。' },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: { file_path: 'smoke-note.txt' }
          }
        ]
      }
    }),
    JSON.stringify({
      type: 'user',
      cwd: agentWorkspace,
      timestamp: '2026-10-30T09:02:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }]
      },
      toolUseResult: {}
    }),
    JSON.stringify({ type: 'summary', summary: 'Claude 冒烟会话' })
  ].join('\n')
)
writeFileSync(
  join(codexScanDir, 'rollout-smoke-import.jsonl'),
  [
    JSON.stringify({
      type: 'session_meta',
      payload: { session_id: 'smoke-codex-import', cwd: agentWorkspace }
    }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        role: 'user',
        content: [{ type: 'input_text', text: '导入 Codex 冒烟会话' }]
      }
    })
  ].join('\n')
)
process.env.WS_SESSION_SCAN_ROOT = sessionScanRoot
app.setPath('userData', userDir)
app.setPath('sessionData', sessionDir)
process.env.WS_DATA_DIR = join(dataDir, 'db')
// 原生目录选择器在自动化里跳过，但仍由主进程走同一套目录校验。
process.env.WS_PICK_WORKSPACE = agentWorkspace
process.env.WS_EXPORT_PATH = join(dataDir, 'session-export.md')
// Agent 走 stub CLI：验证真实 IPC → 子进程 → 渲染整条链路，但不调用模型、不消耗额度
process.env.WS_AGENT_CLI = join(__dirname, 'stub-agent.cjs')
process.env.WS_CODEX_CLI = join(__dirname, 'stub-codex.cjs')
// 插件市场操作单独走 stub，避免冒烟访问真实市场或写用户 ~/.claude
process.env.WS_CLAUDE_PLUGIN_CLI = join(__dirname, 'stub-plugin-cli.cjs')
// 不抢 Cherry Studio 等外部应用的 Ctrl+Alt+Space
process.env.WS_DISABLE_CAPTURE_SHORTCUT = '1'
// 提醒轮询调快，并把命中记录写到文件，供主进程侧断言
const reminderLog = join(dataDir, 'reminders.log')
process.env.WS_REMINDER_TICK_MS = '400'
process.env.WS_REMINDER_LOG = reminderLog
// 后台审批通知：冒烟不弹原生 toast，只记录触发；真实焦点判断由单测覆盖
const attentionLog = join(dataDir, 'attention.log')
process.env.WS_ATTENTION_LOG = attentionLog
process.env.WS_ATTENTION_FORCE = '1'
// 插件导入扫描用临时 home，绝不读用户真实的 ~/.claude 或 ~/.codex
process.env.WS_PLUGIN_SCAN_ROOT = sessionScanRoot

// Provider 测试连接的本地探针：只验证请求路径、鉴权头与结果映射，不访问外网。
const providerProbe = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/responses') {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      let model = ''
      try {
        model = JSON.parse(body)?.model ?? ''
      } catch {
        model = ''
      }
      if (model === 'missing-model') {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Model Not Exist' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'response', output_text: 'OK' }))
    })
    return
  }
  req.resume()
  if (req.method === 'GET' && req.url === '/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'smoke-model-a' }, { id: 'smoke-model-b' }] }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'probe endpoint not found' } }))
})
providerProbe.on('error', (error) => console.error('[smoke] Provider 探针服务失败', error))
providerProbe.listen(23334, '127.0.0.1')

// HTTP 外部 MCP 探针：走真实的 Streamable HTTP initialize / tools/list，并校验加密请求头解密后的透传。
const mcpHttpRequests = []
const mcpHttpProbe = createServer((req, res) => {
  let body = ''
  req.setEncoding('utf8')
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    let message = null
    try {
      message = JSON.parse(body)
    } catch {
      message = null
    }
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'not found' } }))
      return
    }
    if (req.headers['x-smoke-key'] !== 'smoke-secret') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'missing smoke key' } }))
      return
    }
    mcpHttpRequests.push({
      method: message?.method ?? '',
      session: req.headers['mcp-session-id'] ?? ''
    })
    if (message?.method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }
    if (message?.method === 'initialize') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'mcp-session-id': 'smoke-http-session'
      })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'smoke-http-mcp', version: '1.0.0' }
          }
        })
      )
      return
    }
    if (message?.method === 'tools/list') {
      // SSE 分支：真实 Streamable HTTP 服务器常以 text/event-stream 返回。
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [
              {
                name: 'http_echo',
                description: 'HTTP echo',
                inputSchema: { type: 'object' },
                annotations: { readOnlyHint: true, destructiveHint: false }
              },
              {
                name: 'http_write',
                description: 'HTTP write tool',
                inputSchema: { type: 'object' },
                annotations: { readOnlyHint: false, destructiveHint: false }
              }
            ]
          }
        })}\n\n`
      )
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: { code: -32601, message: 'unsupported method' }
      })
    )
  })
})
mcpHttpProbe.on('error', (error) => console.error('[smoke] HTTP MCP 探针服务失败', error))
mcpHttpProbe.listen(23335, '127.0.0.1')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const consoleErrors = []
const contextShot = process.env.WS_SMOKE_CONTEXT_SHOT?.trim()
const checkpointShot = process.env.WS_SMOKE_CHECKPOINT_SHOT?.trim()
const threadShot = process.env.WS_SMOKE_THREAD_SHOT?.trim()
const errorShot = process.env.WS_SMOKE_ERROR_SHOT?.trim()
const toolsShot = process.env.WS_SMOKE_TOOLS_SHOT?.trim()
const toolsShot2 = process.env.WS_SMOKE_TOOLS_SHOT2?.trim()
const toolsTheme = process.env.WS_SMOKE_TOOLS_THEME?.trim()
const recShot = process.env.WS_SMOKE_REC_SHOT?.trim()
const reviewShot = process.env.WS_SMOKE_REVIEW_SHOT?.trim()
const reviewSize = process.env.WS_SMOKE_REVIEW_SIZE?.trim()
const reviewTheme = process.env.WS_SMOKE_REVIEW_THEME?.trim()
const turnShot = process.env.WS_SMOKE_TURN_SHOT?.trim()
const turnSize = process.env.WS_SMOKE_TURN_SIZE?.trim()
const turnTheme = process.env.WS_SMOKE_TURN_THEME?.trim()
const weeklyShot = process.env.WS_SMOKE_WEEKLY_SHOT?.trim()
const weeklySize = process.env.WS_SMOKE_WEEKLY_SIZE?.trim()
const weeklyTheme = process.env.WS_SMOKE_WEEKLY_THEME?.trim()
const triageShot = process.env.WS_SMOKE_TRIAGE_SHOT?.trim()
const triageSize = process.env.WS_SMOKE_TRIAGE_SIZE?.trim()
const triageTheme = process.env.WS_SMOKE_TRIAGE_THEME?.trim()
const habitStatsShot = process.env.WS_SMOKE_HABIT_SHOT?.trim()
const habitStatsSize = process.env.WS_SMOKE_HABIT_SIZE?.trim()
const habitStatsTheme = process.env.WS_SMOKE_HABIT_THEME?.trim()
// 工具面截图可指定窗口尺寸（如 1180x720），用于最小尺寸检查
const toolsSize = (process.env.WS_SMOKE_TOOLS_SIZE?.trim() ?? '')
  .split('x')
  .map((value) => Number.parseInt(value, 10))
let win = null

app.on('browser-window-created', (_event, created) => {
  // 生产窗口默认允许节流；冒烟要按真实时间等待动画与 IPC 回包。
  created.webContents.setBackgroundThrottling(false)
  created.webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      consoleErrors.push(`${event.message} (${event.sourceId}:${event.lineNumber})`)
    }
    if (contextShot && String(event.message ?? '').includes('SMOKE_CONTEXT_SHOT')) {
      void created.webContents
        .capturePage()
        .then((image) => writeFileSync(contextShot, image.toPNG()))
        .catch(() => {})
    }
    if (checkpointShot && String(event.message ?? '').includes('SMOKE_CHECKPOINT_SHOT')) {
      void created.webContents
        .capturePage()
        .then((image) => writeFileSync(checkpointShot, image.toPNG()))
        .catch(() => {})
    }
    if (threadShot && String(event.message ?? '').includes('SMOKE_THREAD_SHOT')) {
      void created.webContents
        .capturePage()
        .then((image) => writeFileSync(threadShot, image.toPNG()))
        .catch(() => {})
    }
    if (errorShot && String(event.message ?? '').includes('SMOKE_ERROR_SHOT')) {
      void created.webContents
        .capturePage()
        .then((image) => writeFileSync(errorShot, image.toPNG()))
        .catch(() => {})
    }
    if (toolsShot2 && String(event.message ?? '').includes('SMOKE_TOOLS_SHOT2')) {
      void created.webContents
        .capturePage()
        .then((image) => writeFileSync(toolsShot2, image.toPNG()))
        .catch(() => {})
    }
    if (recShot && String(event.message ?? '').includes('SMOKE_REC_SHOT')) {
      void created.webContents
        .capturePage()
        .then((image) => writeFileSync(recShot, image.toPNG()))
        .catch(() => {})
    }
    if (reviewShot && String(event.message ?? '').includes('SMOKE_REVIEW_SHOT')) {
      if (reviewSize) {
        const [shotWidth, shotHeight] = reviewSize.split('x').map(Number)
        if (shotWidth >= 1180 && shotHeight >= 720) {
          created.setContentSize(shotWidth, shotHeight)
        }
      }
      setTimeout(() => {
        void created.webContents
          .capturePage()
          .then((image) => writeFileSync(reviewShot, image.toPNG()))
          .catch(() => {})
      }, 900)
    }
    if (turnShot && String(event.message ?? '').includes('SMOKE_TURN_SHOT')) {
      if (turnSize) {
        const [shotWidth, shotHeight] = turnSize.split('x').map(Number)
        if (shotWidth >= 1180 && shotHeight >= 720) {
          created.setContentSize(shotWidth, shotHeight)
        }
      }
      setTimeout(() => {
        void created.webContents
          .capturePage()
          .then((image) => writeFileSync(turnShot, image.toPNG()))
          .catch(() => {})
      }, 900)
    }
    if (weeklyShot && String(event.message ?? '').includes('SMOKE_WEEKLY_SHOT')) {
      if (weeklySize) {
        const [shotWidth, shotHeight] = weeklySize.split('x').map(Number)
        if (shotWidth >= 1180 && shotHeight >= 720) {
          created.setContentSize(shotWidth, shotHeight)
        }
      }
      setTimeout(() => {
        void created.webContents
          .capturePage()
          .then((image) => writeFileSync(weeklyShot, image.toPNG()))
          .catch(() => {})
      }, 900)
    }
    if (triageShot && String(event.message ?? '').includes('SMOKE_TRIAGE_SHOT')) {
      if (triageSize) {
        const [shotWidth, shotHeight] = triageSize.split('x').map(Number)
        if (shotWidth >= 1180 && shotHeight >= 720) {
          created.setContentSize(shotWidth, shotHeight)
        }
      }
      setTimeout(() => {
        void created.webContents
          .capturePage()
          .then((image) => writeFileSync(triageShot, image.toPNG()))
          .catch(() => {})
      }, 900)
    }
    if (habitStatsShot && String(event.message ?? '').includes('SMOKE_HABIT_SHOT')) {
      if (habitStatsSize) {
        const [shotWidth, shotHeight] = habitStatsSize.split('x').map(Number)
        if (shotWidth >= 1180 && shotHeight >= 720) {
          created.setContentSize(shotWidth, shotHeight)
        }
      }
      setTimeout(() => {
        void created.webContents
          .capturePage()
          .then((image) => writeFileSync(habitStatsShot, image.toPNG()))
          .catch(() => {})
      }, 900)
    }
    if (
      toolsShot &&
      // SHOT2 的文本包含 SHOT，必须互斥判断，否则第一张会被拍两次
      !String(event.message ?? '').includes('SMOKE_TOOLS_SHOT2') &&
      String(event.message ?? '').includes('SMOKE_TOOLS_SHOT')
    ) {
      const [shotWidth, shotHeight] = toolsSize
      if (shotWidth >= 1180 && shotHeight >= 720) {
        created.setContentSize(shotWidth, shotHeight)
      }
      setTimeout(
        () => {
          void created.webContents
            .capturePage()
            .then((image) => writeFileSync(toolsShot, image.toPNG()))
            .catch(() => {})
        },
        shotWidth ? 900 : 0
      )
    }
  })
  if (!win) win = created
})

// 加载真实入口：单实例锁、数据库、IPC 与 preload 都由它建立。
require('../out/main/index.js')

async function waitForWindow(timeout = 20_000) {
  const started = Date.now()
  while (!win && Date.now() - started < timeout) await sleep(100)
  if (!win) throw new Error('主窗口未创建：确认 out/ 已构建，且没有实例占用同一 userData')
  return win
}

async function run() {
  await waitForWindow()
  const backupDir = join(process.env.WS_DATA_DIR, 'backups')
  mkdirSync(backupDir, { recursive: true })
  writeFileSync(join(backupDir, 'workstation-99999999-999999.db'), 'not a database')
  if (win.webContents.isLoading()) {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve))
  }
  // 测试不抢前台：窗口保持渲染但完全透明、不进任务栏、不激活。
  win.setSkipTaskbar(true)
  win.setOpacity(0)
  win.showInactive()
  await sleep(1800)

  await win.webContents.executeJavaScript(
    `window.__WS_MCP_STUB__ = ${JSON.stringify(stubMcpServer)}; window.__WS_AGENT_WORKSPACE__ = ${JSON.stringify(agentWorkspace)}; window.__WS_UPDATE_SOURCE__ = ${JSON.stringify(updateSourceDir)}; window.__WS_SMOKE_SHOT__ = ${Boolean(contextShot)}; window.__WS_SMOKE_CHECKPOINT_SHOT__ = ${Boolean(checkpointShot)}; window.__WS_SMOKE_ERROR_SHOT__ = ${Boolean(errorShot)}; window.__WS_SMOKE_TOOLS_SHOT__ = ${Boolean(toolsShot)}; window.__WS_SMOKE_TOOLS_SHOT2__ = ${Boolean(toolsShot2)}; window.__WS_SMOKE_TOOLS_THEME__ = ${JSON.stringify(toolsTheme ?? '')}; window.__WS_SMOKE_REC_SHOT__ = ${Boolean(recShot)}; window.__WS_SMOKE_REVIEW_SHOT__ = ${Boolean(reviewShot)}; window.__WS_SMOKE_REVIEW_THEME__ = ${JSON.stringify(reviewTheme ?? '')}; window.__WS_SMOKE_TURN_SHOT__ = ${Boolean(turnShot)}; window.__WS_SMOKE_TURN_THEME__ = ${JSON.stringify(turnTheme ?? '')}; window.__WS_SMOKE_WEEKLY_SHOT__ = ${Boolean(weeklyShot)}; window.__WS_SMOKE_WEEKLY_THEME__ = ${JSON.stringify(weeklyTheme ?? '')}; window.__WS_SMOKE_TRIAGE_SHOT__ = ${Boolean(triageShot)}; window.__WS_SMOKE_TRIAGE_THEME__ = ${JSON.stringify(triageTheme ?? '')}; window.__WS_SMOKE_HABIT_SHOT__ = ${Boolean(habitStatsShot)}; window.__WS_SMOKE_HABIT_THEME__ = ${JSON.stringify(habitStatsTheme ?? '')}`
  )
  // Injected as a template literal: regex backslashes need double escaping.
  let results
  try {
    results = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const all = (sel) => [...document.querySelectorAll(sel)]
    const one = (sel) => document.querySelector(sel)
    const byText = (sel, text) => all(sel).find((el) => el.textContent.includes(text))
    const activeNav = () => one('.w1-navitem.on .w1-navtext b')?.textContent?.trim() ?? ''
    const navTo = async (label) => {
      const item = all('.w1-navitem').find((el) => el.querySelector('.w1-navtext b')?.textContent?.trim() === label)
      item?.click()
      await sleep(600)
      return item
    }
    const taskScopeTo = async (label) => {
      const item = all('.w1-todorow').find(
        (el) => el.querySelector('.w1-todolabel')?.textContent?.trim() === label
      )
      item?.click()
      await sleep(400)
      return Boolean(item)
    }
    const taskRow = (text) => all('.w1-todorowwrap').find((el) => el.textContent?.includes(text))
    const setValue = (el, value) => {
      if (!el) throw new Error('setValue target missing')
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      if (el instanceof HTMLSelectElement) el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const waitFor = async (fn, timeout = 3000) => {
      const started = Date.now()
      while (Date.now() - started < timeout) {
        try {
          if (await fn()) return true
        } catch {
          // 重渲染期间节点可能暂时不存在
        }
        await sleep(50)
      }
      return false
    }
    const openPalette = async (wait = 600) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))
      await sleep(wait)
    }
    const checks = []
    const check = (name, ok, detail = '') => {
      checks.push({ name, ok, detail })
      window.__smokeProgress = checks.map((item) => item.name)
    }

    check('左侧导航五个入口', all('.w1-navitem').length === 5, String(all('.w1-navitem').length))
    // 外壳不能被程序化滚动：scrollIntoView（笔记跳转、任务定位）会连带顶栏一起上移，
    // 顶栏就被窗口上缘裁掉。overflow: hidden 仍是滚动容器，必须用 clip。
    const shellScroll = (() => {
      const shell = one('.w1')
      const bar = one('.w1-bar')
      if (!shell || !bar) return null
      const before = bar.getBoundingClientRect().top
      shell.scrollTop = 30
      const scrolled = shell.scrollTop
      const after = bar.getBoundingClientRect().top
      shell.scrollTop = 0
      return { before, scrolled, after, overflow: getComputedStyle(shell).overflow }
    })()
    check(
      '外壳不接受程序化滚动（顶栏不被裁切）',
      Boolean(shellScroll) &&
        shellScroll.scrolled === 0 &&
        Math.abs(shellScroll.after - shellScroll.before) < 0.5 &&
        shellScroll.overflow === 'clip',
      JSON.stringify(shellScroll)
    )
    // 顶栏入场动画不能留 backwards：动画时间线暂停时会把顶栏钉在 translateY(-6px)
    await waitFor(() => one('.w1-bar')?.getAnimations().length === 0, 3000)
    const barSettled = one('.w1-bar')
    check(
      '顶栏动画结束后回到原位',
      Boolean(barSettled) &&
        getComputedStyle(barSettled).transform === 'none' &&
        Math.abs(barSettled.getBoundingClientRect().top) < 0.5,
      barSettled ? getComputedStyle(barSettled).transform : 'missing'
    )
    check(
      'preload 桥可用（真实 IPC 路径）',
      typeof window.ws?.tasks?.list === 'function' &&
        typeof window.ws?.notes?.page === 'function' &&
        typeof window.ws?.learning?.list === 'function' &&
        typeof window.ws?.learning?.newIntroduced === 'function',
      typeof window.ws
    )
    check(
      '窗口控制为三枚自绘按钮',
      all('.w1-wcbtn').length === 3 &&
        all('.w1-wcbtn')
          .map((el) => el.getAttribute('aria-label'))
          .join('/') === '最小化/最大化/关闭',
      all('.w1-wcbtn')
        .map((el) => el.getAttribute('aria-label'))
        .join('/')
    )
    check(
      '导航顺序为今日任务 Agent 笔记 学习',
      all('.w1-navitem .w1-navtext b')
        .map((el) => el.textContent?.trim())
        .join('/') === '今日/任务/Agent/笔记/学习',
      all('.w1-navitem .w1-navtext b')
        .map((el) => el.textContent?.trim())
        .join('/')
    )
    check('默认停在今日', activeNav() === '今日', activeNav())
    check('今日看板可见', !!one('.w1-main'))
    check('完成热力图可见', !!one('.w1-heat'))
    check(
      '热力图按 26 周 × 7 天渲染',
      all('.w1-heatcol').length === 26 && all('.w1-heatcol i').length === 182,
      all('.w1-heatcol').length + ' × ' + all('.w1-heatcol i').length
    )
    check(
      '热力图统计文案',
      one('.w1-heatstats')?.textContent?.includes('项完成') ?? false,
      one('.w1-heatstats')?.textContent ?? ''
    )
    check('看板与 Agent 不同时可见', !one('.w1-dock') && !one('.w1-agent'))
    check('初始任务 8 项', all('.w1-task').length === 8, String(all('.w1-task').length))
    check('初始完成 2 项', all('.w1-task.done').length === 2, String(all('.w1-task.done').length))
    check('状态栏初始无待审批', one('.w1-status')?.textContent?.includes('无待审批') ?? false)
    check(
      '状态栏显示 MCP 桥',
      one('.w1-st-mcp')?.textContent?.includes('MCP 桥') ?? false,
      one('.w1-st-mcp')?.textContent ?? ''
    )
    check(
      '舰队总览初始为空',
      one('.w1-fleet .w1-frow')?.textContent?.includes('0会话') ?? false,
      one('.w1-fleet .w1-frow')?.textContent ?? ''
    )
    const launchNames = all('.w1-launch .w1-lname')
    check(
      '外部启动器名称有宽度',
      launchNames.length === 2 && launchNames.every((el) => el.getBoundingClientRect().width > 30),
      launchNames.map((el) => el.textContent + ':' + Math.round(el.getBoundingClientRect().width)).join(' ')
    )

    const themeBefore = document.documentElement.dataset.theme
    const fgBefore = getComputedStyle(one('.w1')).getPropertyValue('--fg').trim()
    check('状态栏有主题按钮', !!one('.w1-theme'), one('.w1-theme')?.textContent ?? '')
    one('.w1-theme')?.click()
    await sleep(350)
    const themeAfter = document.documentElement.dataset.theme
    const fgAfter = getComputedStyle(one('.w1')).getPropertyValue('--fg').trim()
    check(
      '主题可切换',
      themeAfter === (themeBefore === 'light' ? 'dark' : 'light'),
      themeBefore + ' -> ' + themeAfter
    )
    check('主题令牌生效', themeAfter !== themeBefore && fgAfter !== fgBefore && fgAfter.length > 0, fgBefore + ' -> ' + fgAfter)
    check(
      '主题写入本地存储',
      localStorage.getItem('workstation.theme') === themeAfter,
      String(localStorage.getItem('workstation.theme'))
    )
    check('主题切换有提示', one('.w1-toast')?.textContent?.includes('模式'), one('.w1-toast')?.textContent ?? '')
    one('.w1-theme')?.click()
    await sleep(350)
    check('主题可切回', document.documentElement.dataset.theme === themeBefore, document.documentElement.dataset.theme)
    one('.w1-theme')?.blur()

    const quickAddLink = one('.w1-tasks .w1-quickadd')
    check('今日卡有快速添加入口', Boolean(quickAddLink))
    quickAddLink?.click()
    const composerFocused = await waitFor(
      () => document.activeElement?.classList.contains('w1-todoinput') === true,
      3000
    )
    check(
      '快速添加切到任务并聚焦输入',
      activeNav() === '任务' && composerFocused,
      activeNav() + '|' + (document.activeElement?.className ?? '')
    )

    await navTo('任务')
    check('导航切换到任务', activeNav() === '任务' && !!one('.w1-todos'), activeNav())
    check(
      '任务工作区与其他视图互斥',
      !one('.w1-main') && !one('.w1-agent') && !one('.w1-notesview') && !one('.w1-learn'),
      activeNav()
    )
    check(
      '任务默认停在今天',
      all('.w1-todorow').find((el) => el.classList.contains('on'))?.textContent?.includes('今天'),
      all('.w1-todorow').find((el) => el.classList.contains('on'))?.textContent ?? ''
    )
    check('今天清单 6 项', all('.w1-todorowwrap').length === 6, String(all('.w1-todorowwrap').length))
    const quickCard = one('.w1-todoquick')
    const quickStyle = quickCard ? getComputedStyle(quickCard) : null
    const quickBg = quickStyle?.backgroundColor ?? ''
    check(
      '快速添加卡底色不透出页面',
      quickBg === 'rgb(27, 24, 56)',
      quickBg || 'missing'
    )
    // 底部深色内阴影会把 10px 下内边距压成一条缝，看着像底色没铺到边框
    check(
      '快速添加卡底部没有压暗内阴影',
      Boolean(quickStyle) && !quickStyle.boxShadow.includes('inset'),
      quickStyle?.boxShadow ?? 'missing'
    )
    // 提示行到卡片底边必须留出完整内边距，且这段不出现更暗的横带
    const quickHintBottom =
      one('.w1-todoquickhint')?.getBoundingClientRect().bottom ?? 0
    const quickBottomGap = quickCard ? quickCard.getBoundingClientRect().bottom - quickHintBottom : 0
    check(
      '快速添加卡下内边距完整',
      quickBottomGap >= 9 && quickBottomGap <= 13,
      quickBottomGap.toFixed(2)
    )
    check(
      '任务行显示清单与优先级',
      taskRow('重构 auth 模块')?.textContent?.includes('#工作') &&
        taskRow('重构 auth 模块')?.textContent?.includes('高'),
      taskRow('重构 auth 模块')?.textContent ?? ''
    )

    const quickInput = one('.w1-todoinput')
    setValue(quickInput, '明天 15:00 提交周报 !高 #工作')
    await sleep(250)
    check(
      '快速添加解析预览',
      ['明天', '15:00', '高', '#工作'].every((part) =>
        one('.w1-todoquickhint')?.textContent?.includes(part)
      ),
      one('.w1-todoquickhint')?.textContent ?? ''
    )
    const hlMarks = all('.w1-hlk')
    check(
      '输入框内联高亮四类 token',
      hlMarks.length === 4 &&
        hlMarks.map((el) => el.textContent).join('|') === '明天|15:00|!高|#工作',
      hlMarks.map((el) => el.textContent).join('|')
    )
    check(
      '高亮按种类着色',
      hlMarks
        .map((el) => [...el.classList].find((name) => name.startsWith('w1-hlk-')) ?? '')
        .join(',') === 'w1-hlk-date,w1-hlk-time,w1-hlk-priority,w1-hlk-list',
      hlMarks.map((el) => [...el.classList].join('.')).join(' / ')
    )
    quickInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
    )
    await sleep(200)
    check(
      '输入法组合中的 Enter 不提交',
      quickInput.value !== '' && taskRow('提交周报') === undefined,
      quickInput.value
    )
    quickInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(500)
    check('快速添加后清空输入', quickInput.value === '')
    check(
      '快速添加提示去向',
      one('.w1-toast')?.textContent?.includes('已添加「提交周报」'),
      one('.w1-toast')?.textContent ?? ''
    )
    await taskScopeTo('即将到来')
    check(
      '新任务进入即将到来并带日期',
      taskRow('提交周报') !== undefined && taskRow('提交周报')?.textContent?.includes('明天 15:00'),
      taskRow('提交周报')?.textContent ?? ''
    )

    taskRow('提交周报')?.querySelector('.w1-todobody')?.click()
    await sleep(300)
    check('任务详情可展开', !!one('.w1-todoedit') && !!one('.w1-tododatequick'))
    setValue(one('.w1-todoedit input[id^="todo-title-"]'), '提交周报 v2')
    setValue(one('.w1-todoedit textarea[id^="todo-notes-"]'), '补充备注')
    setValue(one('.w1-todoedit input[id^="todo-list-"]'), '验证二')
    byText('.w1-todopriopt', '中')?.click()
    await sleep(150)
    one('.w1-todosave')?.click()
    await waitFor(
      () =>
        taskRow('提交周报 v2') !== undefined &&
        (taskRow('提交周报 v2')?.textContent ?? '').includes('#验证二') &&
        (taskRow('提交周报 v2')?.textContent ?? '').includes('中') &&
        (taskRow('提交周报 v2')?.textContent ?? '').includes('备注') &&
        !one('.w1-todoedit'),
      3000
    )
    check(
      '任务标题与详情可编辑保存',
      taskRow('提交周报 v2') !== undefined &&
        taskRow('提交周报 v2')?.textContent?.includes('#验证二') &&
        taskRow('提交周报 v2')?.textContent?.includes('中') &&
        taskRow('提交周报 v2')?.textContent?.includes('备注') &&
        !one('.w1-todoedit') &&
        document.activeElement?.classList.contains('w1-todobody'),
      taskRow('提交周报 v2')?.textContent ?? ''
    )

    taskRow('提交周报 v2')?.querySelector('.w1-todocb')?.click()
    const leftUpcoming = await waitFor(() => taskRow('提交周报 v2') === undefined, 3000)
    check('完成后离开即将到来', leftUpcoming, all('.w1-todorowwrap').length)
    await taskScopeTo('已完成')
    await waitFor(() => taskRow('提交周报 v2') !== undefined, 2000)
    check('已完成包含刚完成的任务', taskRow('提交周报 v2') !== undefined)

    taskRow('提交周报 v2')?.querySelector('.w1-todobody')?.click()
    await waitFor(() => !!one('.w1-todoedit'), 2000)
    one('.w1-tododelete')?.click()
    await waitFor(() => byText('.w1-tododelete', '再次点击确认删除') !== undefined, 1500)
    check('删除需要二次确认', byText('.w1-tododelete', '再次点击确认删除') !== undefined)
    one('.w1-tododelete')?.click()
    await waitFor(() => taskRow('提交周报 v2') === undefined, 3000)
    check('删除任务后列表移除', taskRow('提交周报 v2') === undefined)

    await taskScopeTo('全部任务')
    const taskSearch = one('.w1-todosearch input')
    setValue(taskSearch, 'auth')
    await sleep(300)
    check(
      '任务搜索命中标题',
      all('.w1-todorowwrap').length === 1 && taskRow('重构 auth 模块') !== undefined,
      String(all('.w1-todorowwrap').length)
    )
    one('.w1-todosearch button')?.click()
    await sleep(300)
    check('清空任务搜索恢复', all('.w1-todorowwrap').length === 6, String(all('.w1-todorowwrap').length))

    // 清单重命名：行内输入、Enter 提交、Esc 取消、重名被拦
    const listEdit = all('.w1-todolistedit').find((el) =>
      el.getAttribute('aria-label')?.includes('工作')
    )
    check('清单行有重命名入口', Boolean(listEdit), String(all('.w1-todolistedit').length))
    listEdit?.click()
    await sleep(250)
    const renameInput = one('.w1-todorenaming')
    check('点击后出现行内输入框', Boolean(renameInput), one('.w1-todorail')?.textContent ?? '')
    setValue(renameInput, '工作流')
    await sleep(60)
    renameInput?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await sleep(450)
    const listLabels = () => all('.w1-todolistrow .w1-todolabel').map((el) => el.textContent)
    check(
      '重命名后清单栏更新',
      listLabels().includes('工作流') && !listLabels().includes('工作'),
      listLabels().join('|')
    )
    check(
      '重命名后任务行跟着改',
      all('.w1-todorowwrap').some((el) => el.textContent?.includes('#工作流')) ||
        one('.w1-todomain')?.textContent?.includes('工作流'),
      all('.w1-todorowwrap').length + ' 行'
    )

    all('.w1-todolistedit')
      .find((el) => el.getAttribute('aria-label')?.includes('工作流'))
      ?.click()
    await sleep(250)
    const dupInput = one('.w1-todorenaming')
    setValue(dupInput, '学习')
    await sleep(60)
    dupInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(250)
    check(
      '重名被拦下并给出提示',
      one('.w1-todolisthint')?.textContent?.includes('已存在同名清单') && Boolean(one('.w1-todorenaming')),
      one('.w1-todolisthint')?.textContent ?? 'missing'
    )
    one('.w1-todorenaming')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    await sleep(250)
    check(
      'Esc 取消重命名且清单未变',
      !one('.w1-todorenaming') && listLabels().includes('工作流'),
      listLabels().join('|')
    )

    // 只做三件事：从全部未完成里挑三条，完成一条自动补位
    const threeBtn = byText('.w1-planbtn', '只做三件事')
    threeBtn?.click()
    await sleep(350)
    check(
      '开启后只显示三条',
      all('.w1-todorowwrap').length === 3 && !!one('.w1-threebar'),
      all('.w1-todorowwrap').length + ' 行'
    )
    check(
      '三件事横幅不撑出横向滚动',
      document.documentElement.scrollWidth <= innerWidth,
      document.documentElement.scrollWidth + ' / ' + innerWidth
    )
    const firstTitle = one('.w1-todorowwrap .w1-todotitletext')?.textContent?.trim() ?? ''
    one('.w1-todorowwrap .w1-todocb')?.click()
    // 补位依赖落库回包与重排，固定 sleep 偶发抢跑，改成条件等待
    await waitFor(() => {
      const titles = all('.w1-todorowwrap .w1-todotitletext').map(
        (el) => el.textContent?.trim() ?? ''
      )
      return all('.w1-todorowwrap').length === 3 && !titles.includes(firstTitle)
    }, 2000)
    const afterTitles = all('.w1-todorowwrap .w1-todotitletext').map((el) =>
      el.textContent?.trim() ?? ''
    )
    check(
      '完成一件后自动补位仍是三条',
      afterTitles.length === 3 && firstTitle !== '' && !afterTitles.includes(firstTitle),
      firstTitle + ' -> ' + afterTitles.join(' / ')
    )
    byText('.w1-threebar button', '退出')?.click()
    await sleep(300)
    check(
      '退出后恢复完整列表',
      !one('.w1-threebar') && all('.w1-todorowwrap').length >= 3,
      String(all('.w1-todorowwrap').length)
    )
    // 把刚才勾掉的任务还原：它已离开未完成列表，得去「已完成」里取消勾选
    byText('.w1-todorow', '已完成')?.click()
    await waitFor(
      () =>
        all('.w1-todorowwrap').some(
          (row) => row.querySelector('.w1-todotitletext')?.textContent?.trim() === firstTitle
        ),
      2000
    )
    const doneRow = all('.w1-todorowwrap').find(
      (row) => row.querySelector('.w1-todotitletext')?.textContent?.trim() === firstTitle
    )
    doneRow?.querySelector('.w1-todocb')?.click()
    await waitFor(
      () =>
        !all('.w1-todorowwrap').some(
          (row) => row.querySelector('.w1-todotitletext')?.textContent?.trim() === firstTitle
        ),
      2000
    )
    byText('.w1-todorow', '今天')?.click()
    const taskRestored = await waitFor(
      () => all('.w1-todotitletext').some((el) => el.textContent?.trim() === firstTitle),
      2000
    )
    check(
      '还原被勾选的任务',
      taskRestored,
      all('.w1-todotitletext')
        .map((el) => el.textContent?.trim())
        .join(' / ')
    )

    // 重复任务：设成每周后完成，应自动生成下一周的实例（落在「即将到来」）
    const repeatInput = one('.w1-todoinput')
    setValue(repeatInput, '每周复盘')
    await sleep(120)
    repeatInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await waitFor(() => taskRow('每周复盘') !== undefined, 3000)
    // 列表刚经过 View Transition 时行节点可能被替换，等一帧再点，避免点空。
    await sleep(120)
    taskRow('每周复盘')?.querySelector('.w1-todobody')?.click()
    if (!(await waitFor(() => !!one('.w1-todoedit'), 2000))) {
      taskRow('每周复盘')?.querySelector('.w1-todobody')?.click()
      await waitFor(() => !!one('.w1-todoedit'), 1500)
    }
    byText('.w1-todoedit .w1-todopriopt', '每周')?.click()
    await waitFor(
      () => byText('.w1-todoedit .w1-todopriopt', '每周')?.getAttribute('aria-pressed') === 'true',
      1500
    )
    byText('.w1-todoedit .w1-todosave', '保存')?.click()
    const repeatBadge = await waitFor(
      () =>
        all('.w1-todorowwrap')
          .find((row) => row.textContent?.includes('每周复盘'))
          ?.querySelector('.w1-todorepeat')?.textContent === '↻ 每周',
      3000
    )
    const badge = all('.w1-todorowwrap')
      .find((row) => row.textContent?.includes('每周复盘'))
      ?.querySelector('.w1-todorepeat')?.textContent
    check('保存后任务显示重复标记', repeatBadge, badge ?? 'missing')

    await waitFor(() => !one('.w1-todoedit'), 2000)
    taskRow('每周复盘')?.querySelector('.w1-todocb')?.click()
    const repeatCreated = await waitFor(async () => {
      const list = await window.ws.tasks.list()
      return list.filter((task) => task.title === '每周复盘').length === 2
    }, 3000)
    const repeated = await window.ws.tasks.list()
    const copies = repeated.filter((task) => task.title === '每周复盘')
    const openCopy = copies.find((task) => !task.done)
    const todayKey = new Date().toLocaleDateString('sv-SE')
    const expectedDue = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('sv-SE')
    check(
      '完成后自动生成下一周的实例',
      repeatCreated && copies.length === 2 && Boolean(openCopy) && openCopy.dueDate === expectedDue,
      copies.map((task) => (task.done ? 'done@' : 'open@') + (task.dueDate ?? '-')).join(' / ')
    )
    check('新实例落在今天之后', openCopy?.dueDate !== todayKey, openCopy?.dueDate ?? '-')

    // 收尾：完成态在「已完成」里，下一轮在「即将到来」里，分别删掉
    const removeRow = async (row) => {
      if (!row) return
      row.querySelector('.w1-todobody')?.click()
      await waitFor(() => !!one('.w1-todoedit'), 2000)
      byText('.w1-todoedit .w1-tododelete', '删除任务')?.click()
      await waitFor(
        () => byText('.w1-todoedit .w1-tododelete', '再次点击确认删除') !== undefined,
        1500
      )
      byText('.w1-todoedit .w1-tododelete', '再次点击确认删除')?.click()
      await waitFor(() => !one('.w1-todoedit'), 3000)
    }
    byText('.w1-todorow', '已完成')?.click()
    await sleep(400)
    await removeRow(
      all('.w1-todorowwrap').find((item) => item.textContent?.includes('每周复盘'))
    )
    byText('.w1-todorow', '即将到来')?.click()
    await sleep(400)
    await removeRow(
      all('.w1-todorowwrap').find((item) => item.textContent?.includes('每周复盘'))
    )
    byText('.w1-todorow', '今天')?.click()
    await sleep(400)

    // 每 N 天：默认 3 天，保存后在行上显示「↻ 每 3 天」，完成后下一次落在 +3 天
    const expectedEvery = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString('sv-SE')
    const everyInput = one('.w1-todoinput')
    setValue(everyInput, '每三天复盘')
    await sleep(120)
    everyInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await waitFor(() => taskRow('每三天复盘') !== undefined, 3000)
    await sleep(120)
    taskRow('每三天复盘')?.querySelector('.w1-todobody')?.click()
    if (!(await waitFor(() => !!one('.w1-todoedit'), 2000))) {
      taskRow('每三天复盘')?.querySelector('.w1-todobody')?.click()
      await waitFor(() => !!one('.w1-todoedit'), 1500)
    }
    byText('.w1-todoedit .w1-todopriopt', '每 N 天')?.click()
    await waitFor(() => Boolean(one('.w1-todorepeatnum')), 1500)
    const everyValue = one('.w1-todorepeatnum')?.value ?? ''
    const everyPreview = await waitFor(
      () => (one('.w1-todorepeatnext')?.textContent ?? '').includes(expectedEvery),
      1500
    )
    byText('.w1-todoedit .w1-todosave', '保存')?.click()
    const everySaved = await waitFor(async () => {
      const list = await window.ws.tasks.list()
      return list.find((task) => task.title === '每三天复盘')?.repeat === 'every:3'
    }, 3000)
    const everyBadge = await waitFor(
      () =>
        all('.w1-todorowwrap')
          .find((row) => row.textContent?.includes('每三天复盘'))
          ?.querySelector('.w1-todorepeat')?.textContent === '↻ 每 3 天',
      3000
    )
    check(
      '每 N 天规则可保存并预览下次日期',
      everyValue === '3' && everyPreview && everySaved && everyBadge,
      everyValue + '|' + everyPreview + '|' + everySaved + '|' + everyBadge
    )
    await waitFor(() => !one('.w1-todoedit'), 2000)
    taskRow('每三天复盘')?.querySelector('.w1-todocb')?.click()
    const everyCreated = await waitFor(async () => {
      const list = await window.ws.tasks.list()
      return list.filter((task) => task.title === '每三天复盘').length === 2
    }, 3000)
    const everyCopies = (await window.ws.tasks.list()).filter(
      (task) => task.title === '每三天复盘'
    )
    const nextEvery = everyCopies.find((task) => !task.done)
    check(
      '完成后下一实例按每 3 天推进',
      everyCreated && nextEvery?.dueDate === expectedEvery,
      (nextEvery?.dueDate ?? '-') + ' vs ' + expectedEvery
    )
    byText('.w1-todorow', '已完成')?.click()
    await sleep(400)
    await removeRow(all('.w1-todorowwrap').find((item) => item.textContent?.includes('每三天复盘')))
    byText('.w1-todorow', '即将到来')?.click()
    await sleep(400)
    await removeRow(all('.w1-todorowwrap').find((item) => item.textContent?.includes('每三天复盘')))
    byText('.w1-todorow', '今天')?.click()
    await sleep(400)

    // 每月第 N 个周几：参数行可选第 2 个 + 周二，保存为 monthly-nth:2:2
    const monthlyInput = one('.w1-todoinput')
    setValue(monthlyInput, '每月复盘二')
    await sleep(120)
    monthlyInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await waitFor(() => taskRow('每月复盘二') !== undefined, 3000)
    await sleep(120)
    taskRow('每月复盘二')?.querySelector('.w1-todobody')?.click()
    if (!(await waitFor(() => !!one('.w1-todoedit'), 2000))) {
      taskRow('每月复盘二')?.querySelector('.w1-todobody')?.click()
      await waitFor(() => !!one('.w1-todoedit'), 1500)
    }
    byText('.w1-todoedit .w1-todopriopt', '每月第 N 个')?.click()
    await waitFor(
      () => Boolean(byText('.w1-todoedit .w1-todopriopt', '第 2 个')),
      1500
    )
    byText('.w1-todoedit .w1-todopriopt', '第 2 个')?.click()
    await waitFor(
      () =>
        byText('.w1-todoedit .w1-todopriopt', '第 2 个')?.getAttribute('aria-pressed') === 'true',
      1500
    )
    byText('.w1-todoedit .w1-todopriopt', '周二')?.click()
    await waitFor(
      () => byText('.w1-todoedit .w1-todopriopt', '周二')?.getAttribute('aria-pressed') === 'true',
      1500
    )
    byText('.w1-todoedit .w1-todosave', '保存')?.click()
    const monthlySaved = await waitFor(async () => {
      const list = await window.ws.tasks.list()
      return list.find((task) => task.title === '每月复盘二')?.repeat === 'monthly-nth:2:2'
    }, 3000)
    const monthlyActual =
      (await window.ws.tasks.list()).find((task) => task.title === '每月复盘二')?.repeat ?? 'missing'
    const monthlyBadge = await waitFor(
      () =>
        all('.w1-todorowwrap')
          .find((row) => row.textContent?.includes('每月复盘二'))
          ?.querySelector('.w1-todorepeat')?.textContent === '↻ 每月第 2 个周二',
      3000
    )
    check(
      '每月第 N 个周几可保存并显示标签',
      monthlySaved && monthlyBadge,
      monthlyActual + '|' + monthlyBadge
    )
    byText('.w1-todorow', '今天')?.click()
    await sleep(300)
    await removeRow(all('.w1-todorowwrap').find((item) => item.textContent?.includes('每月复盘二')))
    // 到点提醒：建一条时间为「当前时刻」的今日任务，等主进程轮询命中。
    // 轮询按分钟精确匹配；这 1.4 秒内若跨过分钟边界就可能错过，此时删掉重建一次。
    const addReminderTask = async () => {
      const clock = new Date().toTimeString().slice(0, 5)
      const input = one('.w1-todoinput')
      setValue(input, '提醒测试 ' + clock)
      await sleep(120)
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      )
      await sleep(1400)
      return new Date().toTimeString().slice(0, 5) === clock
    }
    const removeReminderTask = async () => {
      const row = all('.w1-todorowwrap').find((item) => item.textContent?.includes('提醒测试'))
      if (!row) return
      row.querySelector('.w1-todobody')?.click()
      await sleep(300)
      byText('.w1-todoedit .w1-tododelete', '删除任务')?.click()
      await sleep(150)
      byText('.w1-todoedit .w1-tododelete', '再次点击确认删除')?.click()
      await sleep(400)
    }
    let reminderSameMinute = false
    for (let attempt = 0; attempt < 3 && !reminderSameMinute; attempt += 1) {
      reminderSameMinute = await addReminderTask()
      if (!reminderSameMinute) await removeReminderTask()
    }
    check('提醒轮询期间同分钟未跨界', reminderSameMinute)
    await removeReminderTask()

    check(
      '循环任务两条都已清理',
      !all('.w1-todorowwrap').some((item) => item.textContent?.includes('每周复盘')),
      String(all('.w1-todorowwrap').length)
    )

    const planButton = byText('button', '计划今天')
    check('任务区有计划今天入口', Boolean(planButton))
    planButton?.click()
    await waitFor(() => all('.w1-plancol')[0]?.querySelector('.w1-planrow') !== undefined, 2500)
    check('计划面板与容量条', !!one('.w1-plan') && !!one('.w1-plan .w1-capbar'))
    const beforePlanned = all('.w1-plancol')[1]?.querySelectorAll('.w1-planrow').length ?? 0
    all('.w1-plancol')[0]?.querySelector('.w1-planrow')?.click()
    await waitFor(
      () => (all('.w1-plancol')[1]?.querySelectorAll('.w1-planrow').length ?? 0) === beforePlanned + 1,
      3000
    )
    const afterPlanned = all('.w1-plancol')[1]?.querySelectorAll('.w1-planrow').length ?? 0
    check('加入今天后进入已计划列', afterPlanned === beforePlanned + 1, beforePlanned + '->' + afterPlanned)
    byText('.w1-planfoot button', '完成')?.click()
    await sleep(300)
    check('计划面板可关闭', !one('.w1-plan'))

    const scheduleButton = byText('button', '排程预览')
    check('任务区有排程预览入口', Boolean(scheduleButton))
    scheduleButton?.click()
    await sleep(400)
    check('排程预览面板打开', !!one('.w1-sched') && !!one('.w1-schedlist'))
    check(
      '排程预览有结果或空态',
      !!one('.w1-schedempty') || all('.w1-schedblock').length > 0 || all('.w1-schedrow').length > 0,
      all('.w1-schedblock').length + '/' + all('.w1-schedrow').length
    )
    byText('.w1-schedfoot button', '取消')?.click()
    await sleep(300)
    check('排程预览可关闭', !one('.w1-sched'))

    check('View Transitions API 可用', typeof document.startViewTransition === 'function')
    const vtNames = all('.w1-todorowwrap').map(
      (el) => getComputedStyle(el).viewTransitionName ?? ''
    )
    check(
      '任务行有唯一过渡名',
      vtNames.length > 0 && new Set(vtNames).size === vtNames.length && vtNames.every((name) => name.startsWith('task-')),
      String(vtNames.length) + '/' + String(new Set(vtNames).size)
    )
    window.__vt = 0
    const originalVt = document.startViewTransition?.bind(document)
    document.startViewTransition = (callback) => {
      window.__vt += 1
      return originalVt(callback)
    }
    one('.w1-todorowwrap .w1-todobody')?.click()
    await sleep(400)
    one('.w1-todosave')?.click()
    await sleep(500)
    document.startViewTransition = originalVt
    check('保存走 View Transition', window.__vt >= 1, String(window.__vt))
    setValue(taskSearch, 'auth')
    await sleep(250)
    taskSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(300)
    check(
      '任务搜索 Esc 清空',
      taskSearch.value === '' && all('.w1-todorowwrap').length === 6,
      taskSearch.value + ' · ' + all('.w1-todorowwrap').length
    )
    setValue(taskSearch, 'auth')
    await sleep(250)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true, bubbles: true })
    )
    await sleep(400)
    check(
      '搜索中新建任务会清空搜索并聚焦',
      taskSearch.value === '' && document.activeElement === one('.w1-todoinput'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    taskRow('周报收尾')?.querySelector('.w1-todobody')?.click()
    await sleep(250)
    one('.w1-todoedit input[id^="todo-title-"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    await waitFor(
      () =>
        !one('.w1-todoedit') &&
        activeNav() === '任务' &&
        document.activeElement?.classList.contains('w1-todobody'),
      2000
    )
    check(
      'Esc 收起任务详情但不离开视图',
      !one('.w1-todoedit') &&
        activeNav() === '任务' &&
        document.activeElement?.classList.contains('w1-todobody'),
      document.activeElement?.className?.toString?.() ?? activeNav()
    )

    const railItem = (label) =>
      all('.w1-todorow').find(
        (el) => el.querySelector('.w1-todolabel')?.textContent?.trim() === label
      )
    const dragTo = async (fromRow, target, wait = 700) => {
      if (!fromRow || !target) return false
      const dt = new DataTransfer()
      fromRow
        .querySelector('.w1-tododrag')
        ?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await sleep(90)
      const highlighted = target.classList.contains('drop')
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await sleep(wait)
      return highlighted
    }

    railItem('今天')?.click()
    await sleep(450)
    const todayBefore = all('.w1-todorowwrap').length
    const dragRow = all('.w1-todorowwrap')[0]
    const dragTitle = dragRow?.querySelector('.w1-todotitletext')?.textContent?.trim() ?? ''

    const highlighted = await dragTo(dragRow, railItem('即将到来'))
    check('拖拽悬停高亮清单', highlighted)
    check(
      '拖到即将到来后离开今天',
      Boolean(dragTitle) && !taskRow(dragTitle) && all('.w1-todorowwrap').length === todayBefore - 1,
      dragTitle + ' · ' + all('.w1-todorowwrap').length + '/' + todayBefore
    )
    railItem('即将到来')?.click()
    await sleep(450)
    check('任务出现在即将到来清单', Boolean(taskRow(dragTitle)))

    await dragTo(taskRow(dragTitle), railItem('今天'))
    railItem('今天')?.click()
    await sleep(500)
    check(
      '拖回今天后恢复',
      Boolean(taskRow(dragTitle)) && all('.w1-todorowwrap').length === todayBefore,
      dragTitle + ' · ' + all('.w1-todorowwrap').length + '/' + todayBefore
    )

    await navTo('今日')
    one('.w1-ctlink')?.click()
    await sleep(500)
    check('今日卡可进入任务工作区', activeNav() === '任务' && !!one('.w1-todos'), activeNav())
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true, bubbles: true })
    )
    await sleep(350)
    check(
      'Ctrl+Shift+N 聚焦任务输入',
      document.activeElement === one('.w1-todoinput') && activeNav() === '任务',
      document.activeElement?.className?.toString?.() ?? ''
    )
    await navTo('今日')

    one('.w1-motion')?.focus()
    await openPalette()
    const taskCommandInput = one('.w1-paletteinput')
    setValue(taskCommandInput, '新建任务')
    await sleep(300)
    taskCommandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(600)
    check(
      '命令面板新建任务聚焦输入',
      activeNav() === '任务' && document.activeElement === one('.w1-todoinput'),
      document.activeElement?.className?.toString?.() ?? ''
    )
    await navTo('今日')

    // 两处 hover 高亮都是 inset 2px 线，必须画在左内边距里而不是压住内容。
    // 今日看板曾因左内边距为 0 让线盖住时间文字；13-responsive.css 还会把值覆盖回去。
    // 放在任务块末尾：来回切视图会重建 DOM，前面的断言持有旧节点引用。
    await navTo('任务')
    taskScopeTo('全部任务')
    const rowReady = await waitFor(() => Boolean(one('.w1-todorowmain')), 4000)
    const rowGeometry = rowReady
      ? await (async () => {
          const row = one('.w1-todorowmain')
          const drag = row.querySelector('.w1-tododrag')
          const pad = parseFloat(getComputedStyle(row).paddingLeft || '0')
          const gap = drag
            ? drag.getBoundingClientRect().left - row.getBoundingClientRect().left
            : 0
          return {
            ok: pad >= 6 && gap >= 6,
            detail: 'padding ' + pad + 'px · 手柄距左 ' + gap.toFixed(1) + 'px'
          }
        })()
      : { ok: false, detail: '等不到任务行' }
    check('任务行 hover 高亮线不压住拖拽手柄', rowGeometry.ok, rowGeometry.detail)

    await navTo('今日')
    const cardReady = await waitFor(() => Boolean(one('.w1-task .w1-time')), 4000)
    const cardGeometry = cardReady
      ? await (async () => {
          const row = one('.w1-task')
          const time = row.querySelector('.w1-time')
          const pad = parseFloat(getComputedStyle(row).paddingLeft || '0')
          const gap = time.getBoundingClientRect().left - row.getBoundingClientRect().left
          return {
            ok: pad >= 6 && gap >= 6,
            detail: 'padding ' + pad + 'px · 时间距左 ' + gap.toFixed(1) + 'px'
          }
        })()
      : { ok: false, detail: '等不到看板任务行' }
    check('看板任务行 hover 高亮线不压住时间', cardGeometry.ok, cardGeometry.detail)

    one('.w1-st-reminders')?.click()
    await waitFor(() => Boolean(one('.w1-remindersheet')), 2000)
    const reminderRows = all('.w1-reminderrow')
    check(
      '提醒中心列出今天的时间点',
      Boolean(one('.w1-remindersheet')) && reminderRows.length > 0,
      String(reminderRows.length)
    )
    reminderRows[0]?.querySelector('.w1-reminderopen')?.click()
    const reminderJumped = await waitFor(
      () => Boolean(one('.w1-todos') && one('.w1-todoedit')),
      3000
    )
    check(
      '提醒行可跳到任务详情',
      reminderJumped,
      one('.w1-todoedit')?.textContent?.slice(0, 60) ?? 'missing'
    )

    one('.w1-st-reminders')?.click()
    await waitFor(() => Boolean(one('.w1-remindersheet')), 2000)
    const snoozeRow = all('.w1-reminderrow')[0]
    const snoozeTitle = snoozeRow?.querySelector('.w1-reminderrowmain b')?.textContent ?? ''
    const oldTime = snoozeRow?.querySelector('.w1-reminderopen time')?.textContent ?? ''
    snoozeRow?.querySelectorAll('.w1-reminderact')[1]?.click()
    const reminderSnoozed = await waitFor(async () => {
      const tasks = await window.ws.tasks.list()
      return tasks.some((task) => task.title === snoozeTitle && task.time !== oldTime)
    }, 3000)
    check('提醒中心可延后 10 分钟', reminderSnoozed, snoozeTitle + ' ' + oldTime)

    const muteRow = all('.w1-reminderrow')[0]
    const muteTitle = muteRow?.querySelector('.w1-reminderrowmain b')?.textContent ?? ''
    const muteCountBefore = all('.w1-reminderrow').length
    muteRow?.querySelector('.w1-remindermute')?.click()
    const reminderMuted = await waitFor(
      () => all('.w1-reminderrow').length === muteCountBefore - 1,
      2500
    )
    check('提醒中心可今天不再提醒', reminderMuted, muteTitle)
    const mutedStored = await waitFor(async () => {
      const tasks = await window.ws.tasks.list()
      const target = tasks.find((task) => task.title === muteTitle)
      if (!target) return false
      return (await window.ws.reminders.muted(todayKey)).includes(target.id)
    }, 3000)
    check('今天不再提醒已写入数据库', mutedStored, muteTitle)

    one('.w1-reminderclose')?.click()
    await waitFor(() => !one('.w1-remindersheet'), 2000)
    one('.w1-st-reminders')?.click()
    await waitFor(() => Boolean(one('.w1-remindersheet')), 2000)
    check(
      '重新打开后静音项仍隐藏',
      !all('.w1-reminderrow').some((row) => row.textContent?.includes(muteTitle)),
      muteTitle
    )
    const mutedBar = one('.w1-remindermutedbar')
    check('提醒中心显示静音计数', Boolean(mutedBar), mutedBar?.textContent ?? 'missing')
    one('.w1-reminderrestore')?.click()
    const restoredMute = await waitFor(
      () => all('.w1-reminderrow').some((row) => row.textContent?.includes(muteTitle)),
      2500
    )
    check('恢复全部让静音项回到列表', restoredMute, muteTitle)
    const muteCleared = await waitFor(async () => {
      const tasks = await window.ws.tasks.list()
      const target = tasks.find((task) => task.title === muteTitle)
      if (!target) return false
      return !(await window.ws.reminders.muted(todayKey)).includes(target.id)
    }, 2500)
    check('恢复全部清空数据库静音', muteCleared, muteTitle)

    const customRow = all('.w1-reminderrow')[0]
    const customTitle = customRow?.querySelector('.w1-reminderrowmain b')?.textContent ?? ''
    customRow?.querySelector('.w1-remindersnooze')?.click()
    const snoozeMenuReady = await waitFor(
      () => all('.w1-snoozemenu button').length === 4,
      2000
    )
    const snoozeOptions = all('.w1-snoozemenu button').map((el) => el.textContent?.trim() ?? '')
    check(
      '稍后菜单提供四档时间',
      snoozeMenuReady && snoozeOptions.includes('明天 09:00'),
      snoozeOptions.join(' / ')
    )
    byText('.w1-snoozemenu button', '明天 09:00')?.click()
    const nextDay = (() => {
      const date = new Date()
      date.setDate(date.getDate() + 1)
      return date.toLocaleDateString('sv-SE')
    })()
    const customSnoozed = await waitFor(async () => {
      const tasks = await window.ws.tasks.list()
      const task = tasks.find((item) => item.title === customTitle)
      return task?.dueDate === nextDay && task.time === '09:00'
    }, 3000)
    check('提醒中心可延后到明天 09:00', customSnoozed, customTitle)

    one('.w1-reminderclose')?.click()
    await waitFor(() => !one('.w1-remindersheet'), 2000)

    await openPalette()
    const globalInput = one('.w1-paletteinput')
    setValue(globalInput, '跑步 5 km')
    const taskSearchHit = await waitFor(
      () => all('.w1-paletteitem').some((item) => item.textContent?.includes('跑步 5 km')),
      3000
    )
    check(
      '命令面板可全局搜索任务',
      taskSearchHit,
      all('.w1-paletteitem').length + ' 项'
    )
    globalInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const globalJumped = await waitFor(
      () =>
        activeNav() === '任务' &&
        (one('.w1-todoedit input')?.value ?? '').includes('跑步 5 km'),
      3000
    )
    check(
      '全局搜索命中后跳到任务详情',
      globalJumped,
      one('.w1-todoedit input')?.value ?? 'missing'
    )

    await openPalette()
    const noteInput = one('.w1-paletteinput')
    setValue(noteInput, '特征值')
    const noteHit = await waitFor(
      () => all('.w1-paletteitem').some((item) => item.textContent?.includes('特征值')),
      3000
    )
    noteInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const noteJumped = await waitFor(
      () =>
        Boolean(one('.w1-notedetail')) &&
        (one('.w1-notedetail-text')?.value ?? '').includes('特征值'),
      3000
    )
    check('全局搜索笔记直接打开详情', noteHit && noteJumped, one('.w1-notedetail-text')?.value ?? 'missing')
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    one('.w1-notedetail')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    await waitFor(() => !one('.w1-notedetail'), 2000)

    await openPalette()
    const learningInput = one('.w1-paletteinput')
    setValue(learningInput, '甲单独 10 天完成')
    const learningHit = await waitFor(
      () =>
        all('.w1-paletteitem').some((item) => item.textContent?.includes('甲单独 10 天完成')),
      3000
    )
    learningInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const learningJumped = await waitFor(
      () => Boolean(one('.w1-litem.jump.open')),
      2500
    )
    check(
      '全局搜索学习卡定位并高亮',
      learningHit && learningJumped,
      one('.w1-litem.jump')?.textContent?.slice(0, 60) ?? 'missing'
    )

    await navTo('任务')
    const inboxSelected = await waitFor(() => {
      byText('.w1-todorow', '收集箱')?.click()
      return (one('.w1-todorow.on')?.textContent ?? '').includes('收集箱')
    }, 3000)
    if (!inboxSelected) throw new Error('收集箱未选中')
    const inboxInput = one('.w1-todoinput')
    setValue(inboxInput, '未排期验证')
    await sleep(100)
    inboxInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const unplannedReady = await waitFor(async () => {
      const task = (await window.ws.tasks.list()).find((item) => item.title === '未排期验证')
      return Boolean(task && !task.plannedFor && !task.dueDate)
    }, 3000)
    if (!unplannedReady) throw new Error('未排期任务创建失败')
    byText('.w1-planbtn', '周视图')?.click()
    const weekReady = await waitFor(() => all('.w1-wkday').length === 7, 3000)
    await waitFor(() => Boolean(one('.w1-weekbacklog')), 2000)
    check(
      '任务周视图显示七天',
      weekReady,
      String(all('.w1-wkday').length) + ' 列 · ' + String(all('.w1-wktask').length) + ' 项'
    )
    check(
      '周视图显示未排期任务',
      Boolean(one('.w1-weekbacklog')),
      one('.w1-weekbacklog')?.textContent?.slice(0, 50) ?? 'missing'
    )
    const backlogChip = all('.w1-wkchip').find((el) =>
      el.textContent?.includes('未排期验证')
    )
    const firstDay = one('.w1-wkday')?.getAttribute('data-week-date') ?? ''
    backlogChip?.focus()
    backlogChip?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', altKey: true, bubbles: true })
    )
    const backlogScheduled = await waitFor(async () => {
      const tasks = await window.ws.tasks.list()
      const task = tasks.find((item) => item.title === '未排期验证')
      return (
        task?.plannedFor === firstDay &&
        Boolean(all('.w1-wkday')[0]?.textContent?.includes('未排期验证'))
      )
    }, 3000)
    check('未排期任务 Alt+→ 排到本周一', backlogScheduled, firstDay)

    const scheduledTask = (await window.ws.tasks.list()).find(
      (item) => item.title === '未排期验证'
    )
    const scheduledButton = scheduledTask
      ? one('.w1-wkday [data-task-id="' + scheduledTask.id + '"]')
      : null
    scheduledButton?.focus()
    scheduledButton?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', altKey: true, bubbles: true })
    )
    const movedByKeyboard = await waitFor(async () => {
      const tasks = await window.ws.tasks.list()
      const task = tasks.find((item) => item.id === scheduledTask?.id)
      const secondDay = all('.w1-wkday')[1]?.getAttribute('data-week-date')
      return (
        task?.plannedFor === secondDay &&
        Boolean(all('.w1-wkday')[1]?.textContent?.includes('未排期验证'))
      )
    }, 3000)
    check('任务卡 Alt+→ 移动一天', movedByKeyboard, scheduledTask?.id ?? 'missing')
    const focusFollowed = await waitFor(
      () => document.activeElement?.getAttribute('data-task-id') === scheduledTask?.id,
      2000
    )
    check(
      '键盘移动后焦点跟随任务',
      focusFollowed,
      document.activeElement?.getAttribute('data-task-id') ?? 'missing'
    )

    const rangeBefore = one('.w1-weekrange')?.textContent ?? ''
    one('[aria-label="下一周"]')?.click()
    await sleep(250)
    const rangeAfter = one('.w1-weekrange')?.textContent ?? ''
    check(
      '周视图可切换周',
      weekReady && rangeAfter !== rangeBefore && all('.w1-wkday').length === 7,
      rangeBefore + ' → ' + rangeAfter
    )
    byText('.w1-wkbtn', '今天')?.click()
    await sleep(200)
    byText('.w1-planbtn', '列表视图')?.click()
    await sleep(200)

    await navTo('Agent')
    check('导航切换到 Agent', activeNav() === 'Agent', activeNav())
    check('Agent 工作区出现', !!one('.w1-agent') && !!one('.w1-dock') && !!one('.w1-rail'))
    check('切换后今日看板隐藏', !one('.w1-main'))
    check(
      'Agent 初始为空态',
      !!one('.w1-agentempty') && all('.w1-sess').length === 0,
      String(all('.w1-sess').length)
    )
    // 头部 Agent 标签页不能是死按钮：目标 Agent 没有会话时应直接新建一个
    const codexTab = all('.w1-dhead .w1-tab').find((tab) =>
      (tab.textContent ?? '').includes('Codex')
    )
    codexTab?.click()
    const tabCreated = await waitFor(async () => {
      const bundle = await window.ws.agent.sessions()
      return (
        bundle.sessions.some((session) => session.agent === 'codex') &&
        (one('.w1-dhead .w1-tab.on')?.textContent ?? '').includes('Codex')
      )
    }, 3000)
    check(
      '点头部 Codex 标签新建 Codex 会话',
      tabCreated,
      one('.w1-dhead')?.textContent?.slice(0, 60) ?? 'missing'
    )
    one('.w1-adelete')?.click()
    await waitFor(() => (one('.w1-adelete')?.textContent ?? '') === '确认删除', 2000)
    one('.w1-adelete')?.click()
    const tabBackToEmpty = await waitFor(() => !!one('.w1-agentempty'), 3000)
    check('删除唯一 Codex 会话后回到空态', tabBackToEmpty, String(tabBackToEmpty))
    one('.w1-agentempty .w1-pb.pri')?.click()
    await sleep(600)
    check(
      '新建真实会话',
      all('.w1-sess').length === 1 && (one('.w1-tdiv')?.textContent ?? '').includes('新会话'),
      one('.w1-tdiv')?.textContent ?? ''
    )
    check(
      '未选择工作区时输入禁用',
      !!one('.w1-aworkspacegate') && one('#composer-input')?.disabled === true,
      one('.w1-aworkspace')?.getAttribute('title') ?? 'missing'
    )
    one('.w1-aworkspacegate .w1-pb')?.click()
    const workspaceReady = await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const workspaceTitle = one('.w1-aworkspace')?.getAttribute('title') ?? ''
    check(
      '选择工作区后启用对话',
      workspaceReady && workspaceTitle.includes('workspace'),
      workspaceTitle
    )
    const workspacePersisted = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.some((session) => session.workspace?.endsWith('workspace'))
    }, 3000)
    check(
      '工作区已落库',
      workspacePersisted,
      one('.w1-aworkspace')?.textContent?.trim() ?? 'missing'
    )

    const input = one('#composer-input')
    setValue(input, '测一下多会话回复')
    await sleep(80)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(250)
    check('发送后出现等待动画', !!one('.w1-typing'))
    await navTo('今日')
    await sleep(1300)
    await navTo('Agent')
    check('切换视图后仍收到助手回复', all('.w1-amsg').length >= 1, String(all('.w1-amsg').length))
    check('等待动画结束', !one('.w1-typing'))
    check(
      '会话标题取首条消息',
      byText('.w1-sess', '测一下多会话回复') !== undefined,
      one('.w1-sess')?.textContent ?? ''
    )

    const streamedText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? ''
    check(
      '回复来自 CLI 的流式文本',
      streamedText.includes('先把当前看板读一遍') && streamedText.includes('读完了'),
      streamedText
    )
    const markdownStrong = all('.w1-amsg').at(-1)?.querySelector('.w1-atext .w1-md strong')
    check(
      '助手回复渲染 Markdown 加粗',
      markdownStrong?.textContent === '6 项待办',
      markdownStrong?.textContent ?? 'missing'
    )
    const codeCopy = all('.w1-amsg').at(-1)?.querySelector('.w1-md-copy')
    const codeBlock = all('.w1-amsg').at(-1)?.querySelector('.w1-md-code pre code')
    check(
      '代码块渲染并可复制',
      Boolean(codeBlock) && codeCopy?.textContent?.trim() === '复制',
      codeCopy?.textContent ?? 'missing'
    )
    codeCopy?.click()
    await sleep(250)
    check(
      '代码块复制反馈',
      codeCopy?.textContent?.trim() === '已复制',
      codeCopy?.textContent ?? 'missing'
    )

    const toolCard = all('.w1-amsg').at(-1)?.querySelector('.w1-tool')
    check(
      '工具调用渲染成卡片且状态已完成',
      toolCard?.textContent?.includes('Read') &&
        toolCard?.textContent?.includes('src/main/index.ts') &&
        toolCard?.textContent?.includes('完成'),
      toolCard?.textContent ?? 'missing'
    )
    check('真实回复不是演示文案', !streamedText.includes('我先读取今天的看板'), streamedText)

    const copyButton = all('.w1-amsg .w1-copy[aria-label="复制这条回复"]').at(-1)
    check('助手消息有复制按钮', Boolean(copyButton))
    copyButton?.click()
    await sleep(250)
    check(
      '复制后给出已复制反馈',
      (copyButton?.textContent ?? '') === '已复制',
      copyButton?.textContent ?? 'missing'
    )

    const contextInput = one('#composer-input')
    contextInput?.focus()
    const contextValue = '附件上下文 @smoke'
    const contextSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    contextSetter.call(contextInput, contextValue)
    contextInput?.setSelectionRange?.(contextValue.length, contextValue.length)
    contextInput?.dispatchEvent(new Event('input', { bubbles: true }))
    const contextReady = await waitFor(() => Boolean(one('.w1-ctxpick-row')), 3000)
    const contextRow = one('.w1-ctxpick-row')
    check(
      '输入 @ 弹出工作区文件选择器',
      contextReady &&
        Boolean(contextRow) &&
        (contextRow?.textContent ?? '').includes('smoke-note.txt'),
      contextRow?.textContent ?? 'missing'
    )
    contextRow?.click()
    await sleep(150)
    const contextChip = one('.w1-ctxchip')
    check(
      '@ 选择后出现附件标签',
      (contextChip?.textContent ?? '').includes('smoke-note.txt'),
      contextChip?.textContent ?? 'missing'
    )
    if (window.__WS_SMOKE_SHOT__) {
      // 重新打开选择器，让截图同时看到附件标签与文件列表；仅由 WS_SMOKE_CONTEXT_SHOT 开启。
      await sleep(400)
      contextSetter.call(contextInput, '附件上下文  ')
      contextInput?.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(40)
      const reopenValue = '附件上下文  @'
      contextSetter.call(contextInput, reopenValue)
      contextInput?.setSelectionRange?.(reopenValue.length, reopenValue.length)
      contextInput?.dispatchEvent(new Event('input', { bubbles: true }))
      const reopened = await waitFor(() => Boolean(one('.w1-ctxpick-row')), 2000)
      check('@ 选择器在附加后可再次打开', reopened)
      const panel = one('.w1-pop')
      const panelRect = panel?.getBoundingClientRect()
      const stack = panelRect
        ? document
            .elementsFromPoint(panelRect.left + 40, panelRect.top + 60)
            .slice(0, 5)
            .map((el) => el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 40))
        : []
      check(
        '@ 弹层层叠在聊天线程之上',
        stack[0]?.includes('w1-ctxpick') === true,
        String(getComputedStyle(panel ?? document.body).zIndex) + ' · ' + stack.join(' > ')
      )
      console.log('SMOKE_CONTEXT_SHOT')
      await sleep(10000)
      const closeValue = '附件上下文 '
      contextSetter.call(contextInput, closeValue)
      contextInput?.setSelectionRange?.(closeValue.length, closeValue.length)
      contextInput?.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(150)
    }
    contextInput?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const contextReply = await waitFor(
      () => (all('.w1-amsg').at(-1)?.textContent ?? '').includes('已读取 smoke-note.txt'),
      4000
    )
    check(
      '@ 附件内容注入提示词',
      contextReply &&
        (all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? '').includes(
          '内容完整'
        ),
      all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? 'missing'
    )
    const contextUser = all('.w1-umsg').at(-1)
    check(
      '用户消息保留附件路径',
      (contextUser?.textContent ?? '').includes('@smoke-note.txt'),
      contextUser?.textContent ?? 'missing'
    )
    const contextPersisted = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.messages.some(
        (message) => message.text === '附件上下文' && message.contextFiles?.includes('smoke-note.txt')
      )
    }, 3000)
    check('附件路径已落库', contextPersisted)

    const questionInput = one('#composer-input')
    setValue(questionInput, '需要问答')
    await sleep(80)
    questionInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const questionShown = await waitFor(() => Boolean(one('.w1-question')), 4000)
    check(
      'Agent 提问显示独立问题卡',
      questionShown && all('.w1-qgroup').length === 2 && !one('.w1-toolperm'),
      String(all('.w1-qgroup').length)
    )
    const staging = byText('.w1-qopt', 'Staging')
    staging?.querySelector('input')?.click()
    byText('.w1-qopt', '类型检查')?.querySelector('input')?.click()
    byText('.w1-qopt', '单元测试')?.querySelector('input')?.click()
    await sleep(120)
    check(
      '问答单选与多选都可选择',
      staging?.querySelector('input')?.checked === true &&
        byText('.w1-qopt', '类型检查')?.querySelector('input')?.checked === true &&
        byText('.w1-qopt', '单元测试')?.querySelector('input')?.checked === true,
      all('.w1-qopt.on').length + ' selected'
    )
    byText('.w1-qacts .w1-pb.pri', '提交回答')?.click()
    const questionAnswered = await waitFor(
      () =>
        !one('.w1-question') &&
        (all('.w1-atext').at(-1)?.textContent ?? '').includes(
          '问答完成：Staging / 类型检查, 单元测试'
        ),
      5000
    )
    check(
      '问答提交后回写答案并继续',
      questionAnswered,
      all('.w1-atext').at(-1)?.textContent ?? ''
    )

    const failInput = one('#composer-input')
    setValue(failInput, '这次注定失败')
    await sleep(80)
    failInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    const failReported = await waitFor(
      () =>
        (all('.w1-amsg .w1-atext.error').at(-1)?.textContent ?? '').includes('模拟失败'),
      4000
    )
    const failedText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')
    check(
      'CLI 失败时明确报错',
      failReported && failedText?.classList.contains('error') === true,
      failedText?.textContent ?? 'missing'
    )
    const failIdle = await waitFor(() => !one('.w1-typing'), 2000)
    check('失败后不残留等待动画', failIdle && !one('.w1-typing'))

    const errorsBefore = all('.w1-atext.error').length
    const userMessagesBefore = all('.w1-umsg').length
    all('.w1-amsg .w1-retry').at(-1)?.click()
    const retried = await waitFor(() => all('.w1-atext.error').length === errorsBefore + 1, 5000)
    check(
      '失败回合可手动重试且不重复用户消息',
      retried && all('.w1-umsg').length === userMessagesBefore,
      (errorsBefore + 1) + ' errors · ' + all('.w1-umsg').length + '/' + userMessagesBefore
    )

    const askInput = one('#composer-input')
    setValue(askInput, '需要审批')
    await sleep(80)
    askInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () =>
        !!one('.w1-toolperm') &&
        (one('.w1-toolperm')?.textContent ?? '').includes('tmp/stub.txt'),
      2000
    )
    check(
      '工具审批卡出现并显示目标',
      !!one('.w1-toolperm') &&
        (one('.w1-toolperm')?.textContent ?? '').includes('Write') &&
        (one('.w1-toolperm')?.textContent ?? '').includes('tmp/stub.txt'),
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? ''
    )
    const approvalDiff = await waitFor(
      () =>
        !!one('.w1-toolperm .w1-diffview') &&
        (one('.w1-toolperm .w1-diffview')?.textContent ?? '').includes('tmp/stub.txt') &&
        (one('.w1-toolperm .w1-diffview')?.textContent ?? '').includes('ok'),
      3000
    )
    check(
      '审批卡展示文件改动 diff',
      approvalDiff && (one('.w1-toolperm .w1-diffview-kind')?.textContent ?? '') === '新增',
      one('.w1-toolperm .w1-diffview')?.textContent?.slice(0, 100) ?? 'missing'
    )
    const approvalActionsVisible = await waitFor(() => {
      const card = one('.w1-toolperm .w1-pb.pri')
      const thread = one('.w1-thread')
      if (!card || !thread) return false
      const action = card.getBoundingClientRect()
      const viewport = thread.getBoundingClientRect()
      return action.top >= viewport.top && action.bottom <= viewport.bottom
    }, 3000)
    check(
      '审批卡操作按钮随 diff 展开保持可见',
      approvalActionsVisible,
      one('.w1-toolperm .w1-pb.pri')?.getBoundingClientRect().top + ' / ' +
        one('.w1-thread')?.getBoundingClientRect().bottom
    )
    byText('.w1-toolperm .w1-pb.pri', '允许一次')?.click()
    await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('已写入临时文件'),
      2500
    )
    check(
      '允许后 CLI 继续并写入工具卡',
      !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('已写入临时文件') &&
        (one('.w1-thread')?.textContent ?? '').includes('tmp/stub.txt'),
      one('.w1-thread')?.textContent?.slice(-80) ?? ''
    )
    const diffToggle = all('.w1-tool .w1-tooldiff').at(-1)
    diffToggle?.click()
    const toolDiff = await waitFor(
      () =>
        !!one('.w1-toolwrap .w1-diffview') &&
        (one('.w1-toolwrap .w1-diffview')?.textContent ?? '').includes('tmp/stub.txt'),
      3000
    )
    check(
      '工具卡可展开查看改动',
      toolDiff && (diffToggle?.textContent ?? '').includes('收起改动'),
      one('.w1-toolwrap .w1-diffview')?.textContent?.slice(0, 100) ?? 'missing'
    )

    setValue(askInput, '需要审批')
    await sleep(80)
    askInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(() => !!one('.w1-toolperm'), 2000)
    byText('.w1-toolperm .w1-pb', '拒绝')?.click()
    await waitFor(
      () => !one('.w1-toolperm') && (one('.w1-thread')?.textContent ?? '').includes('权限被拒绝'),
      2500
    )
    check(
      '拒绝后 CLI 停止写入',
      !one('.w1-toolperm') && (one('.w1-thread')?.textContent ?? '').includes('权限被拒绝'),
      one('.w1-thread')?.textContent?.slice(-80) ?? ''
    )

    const sessionAskInput = one('#composer-input')
    setValue(sessionAskInput, '连续审批')
    await sleep(80)
    sessionAskInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const firstWriteCard = await waitFor(
      () => (one('.w1-toolperm')?.textContent ?? '').includes('连续审批第一次'),
      2500
    )
    check(
      '敏感工具卡没有此工作区允许',
      firstWriteCard && !(one('.w1-toolperm')?.textContent ?? '').includes('此工作区允许'),
      one('.w1-toolperm')?.textContent?.slice(0, 140) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '本会话允许')?.click()
    const sessionAllowed = await waitFor(
      () =>
        (one('.w1-thread')?.textContent ?? '').includes('连续审批：两次均允许') &&
        !one('.w1-toolperm'),
      3000
    )
    check(
      '本会话允许后第二次 Write 自动放行',
      sessionAllowed,
      one('.w1-thread')?.textContent?.slice(-120) ?? ''
    )

    const checkpointInput = one('#composer-input')
    setValue(checkpointInput, '检查点写入')
    await sleep(80)
    checkpointInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const checkpointCard = await waitFor(
      () => (one('.w1-toolperm')?.textContent ?? '').includes('checkpoint.txt'),
      3000
    )
    check('检查点样例弹出写入审批', checkpointCard, one('.w1-toolperm')?.textContent ?? 'missing')
    byText('.w1-toolperm .w1-pb', '允许一次')?.click()
    const checkpointWritten = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('检查点写入完成'),
      4000
    )
    const checkpointSession = (await window.ws.agent.threads()).sessions.find(
      (session) => session.title === '测一下多会话回复'
    )
    let writtenText = ''
    if (checkpointSession) {
      const file = await window.ws.agent.readWorkspaceFile(checkpointSession.id, 'checkpoint.txt')
      writtenText = file.text
    }
    check(
      '允许后文件被改写',
      checkpointWritten && writtenText === '改后内容',
      writtenText || 'missing'
    )
    const checkpointStored = checkpointSession
      ? await waitFor(async () => {
          const list = await window.ws.agent.checkpoints(checkpointSession.id)
          return list.length > 0
        }, 3000)
      : false
    check('检查点已落库', checkpointStored)
    const checkpointTurnText = () =>
      all('.w1-turnchanges').find((el) => el.textContent?.includes('checkpoint.txt'))
        ?.textContent ?? ''
    const turnSummary = await waitFor(
      () =>
        checkpointTurnText().includes('1 个文件') &&
        checkpointTurnText().includes('+1') &&
        checkpointTurnText().includes('−1'),
      3000
    )
    check(
      '回合改动摘要显示文件与行数',
      turnSummary && checkpointTurnText().includes('checkpoint.txt'),
      checkpointTurnText().slice(0, 160) || 'missing'
    )
    const turnRollback = await waitFor(() => Boolean(one('.w1-tc-rollback')), 3000)
    check('最新回合有回退入口', turnRollback, one('.w1-tc-rollback')?.textContent ?? 'missing')
    if (window.__WS_SMOKE_TURN_SHOT__) {
      const previousTheme = document.documentElement.dataset.theme
      const previousStoredTheme = localStorage.getItem('workstation.theme')
      if (window.__WS_SMOKE_TURN_THEME__ === 'light') {
        document.documentElement.dataset.theme = 'light'
        localStorage.setItem('workstation.theme', 'light')
        await sleep(400)
      }
      const turnThread = one('.w1-thread')
      if (turnThread) turnThread.scrollTop = turnThread.scrollHeight
      await sleep(200)
      console.log('SMOKE_TURN_SHOT')
      await sleep(1200)
      if (window.__WS_SMOKE_TURN_THEME__ === 'light') {
        if (previousTheme) document.documentElement.dataset.theme = previousTheme
        else document.documentElement.removeAttribute('data-theme')
        if (previousStoredTheme === null) localStorage.removeItem('workstation.theme')
        else localStorage.setItem('workstation.theme', previousStoredTheme)
        await sleep(300)
      }
    }
    one('.w1-tc-rollback')?.click()
    await sleep(120)
    check(
      '回合回退需要二次确认',
      (one('.w1-tc-rollback')?.textContent ?? '').includes('再次点击确认'),
      one('.w1-tc-rollback')?.textContent ?? 'missing'
    )
    byText('.w1-aworkspacefiles', '检查点')?.click()
    const checkpointRow = await waitFor(() => Boolean(one('.w1-cprow')), 3000)
    check('检查点面板列出快照', checkpointRow, one('.w1-cprow')?.textContent ?? 'missing')
    const checkpointSheet = one('.w1-wssheet')
    const sheetTop = checkpointSheet
      ? (() => {
          const rect = checkpointSheet.getBoundingClientRect()
          return document.elementFromPoint(rect.left + 40, rect.top + 40)
        })()
      : null
    check(
      '检查点面板在聊天线程之上',
      Boolean(checkpointSheet) && Boolean(sheetTop) && checkpointSheet.contains(sheetTop),
      sheetTop?.className ?? 'missing'
    )
    if (window.__WS_SMOKE_CHECKPOINT_SHOT__) {
      console.log('SMOKE_CHECKPOINT_SHOT')
      await sleep(6000)
    }
    one('.w1-cprollback')?.click()
    await sleep(120)
    check(
      '回退需要二次确认',
      (one('.w1-cprollback')?.textContent ?? '').includes('确认回退'),
      one('.w1-cprollback')?.textContent ?? 'missing'
    )
    one('.w1-cprollback')?.click()
    const rollbackDone = await waitFor(
      () => (one('.w1-toast')?.textContent ?? '').includes('已回退'),
      4000
    )
    let restoredText = ''
    if (checkpointSession) {
      const file = await window.ws.agent.readWorkspaceFile(checkpointSession.id, 'checkpoint.txt')
      restoredText = file.text
    }
    check(
      '回退恢复写入前内容',
      rollbackDone && restoredText === '原始内容',
      restoredText || 'missing'
    )
    one('.w1-wssheet .w1-fleetclose')?.click()
    await sleep(200)
    const turnRestored = await waitFor(
      () => checkpointTurnText().includes('已回退'),
      4000
    )
    check(
      '回合摘要同步已回退状态',
      turnRestored && !one('.w1-tc-rollback'),
      checkpointTurnText().slice(0, 160) || 'missing'
    )

    const planInput = one('#composer-input')
    byText('.w1-planmode', '计划模式')?.click()
    await sleep(100)
    check(
      '计划模式按钮切换为执行',
      one('.w1-planmode')?.getAttribute('aria-pressed') === 'true',
      one('.w1-planmode')?.textContent ?? 'missing'
    )
    setValue(planInput, '计划模式 看入口')
    await sleep(80)
    planInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    const planReplied = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('计划模式：只读'),
      4000
    )
    check('计划模式传递到 CLI', planReplied)
    setValue(planInput, '需要审批')
    await sleep(80)
    planInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    const planDenied = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('权限被拒绝'),
      4000
    )
    check(
      '计划模式不发写入审批卡',
      planDenied && !one('.w1-toolperm'),
      one('.w1-thread')?.textContent?.slice(-80) ?? 'missing'
    )
    await waitFor(() => one('.w1-planmode:not([disabled])') !== null, 3000)
    byText('.w1-planmode', '切到执行')?.click()
    const backToAct = await waitFor(
      () => one('.w1-planmode')?.getAttribute('aria-pressed') === 'false',
      3000
    )
    check('切回执行模式', backToAct, one('.w1-planmode')?.getAttribute('aria-pressed') ?? 'missing')

    const imageInput = one('#composer-input')
    const imageB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const imageBytes = Uint8Array.from(atob(imageB64), (char) => char.charCodeAt(0))
    const imageTransfer = new DataTransfer()
    imageTransfer.items.add(new File([imageBytes], 'shot.png', { type: 'image/png' }))
    imageInput?.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: imageTransfer,
        bubbles: true,
        cancelable: true
      })
    )
    const imageChip = await waitFor(() => Boolean(one('.w1-imgchip')), 4000)
    check('粘贴图片生成附件标签', imageChip, one('.w1-imgchip')?.textContent ?? 'missing')
    setValue(imageInput, '图片上下文')
    await sleep(80)
    imageInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    const imageReply = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('图片：已收到 1 张 image/png'),
      4000
    )
    const imageThumb = await waitFor(() => Boolean(one('.w1-umsgimage')), 3000)
    check('图片以 base64 注入 Claude', imageReply)
    check(
      '用户消息显示图片缩略图',
      imageThumb && (one('.w1-umsgimage')?.getAttribute('src') ?? '').startsWith('data:image/png'),
      one('.w1-umsgimage')?.getAttribute('src')?.slice(0, 30) ?? 'missing'
    )
    const imagePersisted = checkpointSession
      ? await waitFor(async () => {
          const bundle = await window.ws.agent.threads()
          return bundle.messages.some(
            (message) => message.text === '图片上下文' && message.images?.length === 1
          )
        }, 3000)
      : false
    check('图片引用已落库', imagePersisted)

    const cleanupImage = await window.ws.agent.saveImage({
      mime: 'image/png',
      data: imageB64,
      name: 'cleanup.png'
    })
    const cleanupA = await window.ws.agent.createSession({
      id: 's-smoke-img-a',
      agent: 'claude',
      title: '图片清理 A'
    })
    const cleanupB = await window.ws.agent.createSession({
      id: 's-smoke-img-b',
      agent: 'claude',
      title: '图片清理 B'
    })
    const cleanupNow = Date.now()
    await window.ws.agent.saveMessage({
      id: 'smoke-img-a-msg',
      sessionId: cleanupA.id,
      role: 'user',
      text: 'A',
      timeLabel: '刚刚',
      images: [cleanupImage],
      createdAt: cleanupNow
    })
    await window.ws.agent.saveMessage({
      id: 'smoke-img-b-msg',
      sessionId: cleanupB.id,
      role: 'user',
      text: 'B',
      timeLabel: '刚刚',
      images: [cleanupImage],
      createdAt: cleanupNow + 1
    })
    await window.ws.agent.deleteSession(cleanupA.id)
    let sharedImageAlive = true
    try {
      await window.ws.agent.imageData(cleanupImage)
    } catch {
      sharedImageAlive = false
    }
    check('共享图片在删除一个会话后保留', sharedImageAlive)
    await window.ws.agent.deleteSession(cleanupB.id)
    let orphanImageRemoved = false
    try {
      await window.ws.agent.imageData(cleanupImage)
    } catch {
      orphanImageRemoved = true
    }
    check('最后一个引用删除后图片文件被清理', orphanImageRemoved)

    const mcpInput = one('#composer-input')
    setValue(mcpInput, 'MCP 概览')
    await sleep(80)
    mcpInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('MCP 概览：读取成功'),
      2500
    )
    const mcpText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? ''
    const mcpTool = all('.w1-amsg').at(-1)?.querySelector('.w1-tool')
    check('MCP 读工具可被 Claude 调用', mcpText.includes('MCP 概览：读取成功'), mcpText)
    check(
      'MCP 工具调用显示为已完成',
      mcpTool?.textContent?.includes('today_overview') && mcpTool?.textContent?.includes('完成'),
      mcpTool?.textContent ?? 'missing'
    )

    const mcpWriteInput = one('#composer-input')
    setValue(mcpWriteInput, 'MCP 写任务')
    await sleep(80)
    mcpWriteInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('MCP 写任务：已创建'),
      2500
    )
    const mcpWriteText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? ''
    const mcpWriteTool = all('.w1-amsg').at(-1)?.querySelector('.w1-tool')
    check('MCP 任务写入返回成功', mcpWriteText.includes('MCP 写任务：已创建'), mcpWriteText)
    check(
      'MCP 写入工具卡显示完成',
      mcpWriteTool?.textContent?.includes('tasks_create') &&
        mcpWriteTool?.textContent?.includes('完成'),
      mcpWriteTool?.textContent ?? 'missing'
    )

    await window.ws.mcp.setPolicy('task', 'ask')
    await sleep(150)
    const mcpAskInput = one('#composer-input')
    setValue(mcpAskInput, 'MCP 审批写入')
    await sleep(80)
    mcpAskInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(() => !!one('.w1-mcpapprove'), 2000)
    check(
      '询问模式弹出 MCP 写入审批卡',
      !!one('.w1-mcpapprove') &&
        (one('.w1-mcpapprove')?.textContent ?? '').includes('tasks_create') &&
        (one('.w1-mcpapprove')?.textContent ?? '').includes('MCP 审批写入'),
      one('.w1-mcpapprove')?.textContent?.slice(0, 100) ?? 'missing'
    )
    byText('.w1-mcpapprove .w1-pb.pri', '允许一次')?.click()
    await waitFor(
      () =>
        !one('.w1-mcpapprove') &&
        (one('.w1-thread')?.textContent ?? '').includes('MCP 审批写入：已创建'),
      3000
    )
    check(
      '允许一次后写入完成',
      !one('.w1-mcpapprove') &&
        (one('.w1-thread')?.textContent ?? '').includes('MCP 审批写入：已创建'),
      one('.w1-thread')?.textContent?.slice(-100) ?? ''
    )

    const claudeRuleInput = one('#composer-input')
    setValue(claudeRuleInput, 'MCP 规则写入')
    await sleep(80)
    claudeRuleInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await waitFor(() => !!one('.w1-mcpapprove'), 2000)
    check(
      'MCP 卡出现此工作区允许',
      (one('.w1-mcpapprove')?.textContent ?? '').includes('此工作区允许'),
      one('.w1-mcpapprove')?.textContent?.slice(0, 120) ?? 'missing'
    )
    byText('.w1-mcpapprove .w1-pb', '此工作区允许')?.click()
    const ruleWriteDone = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('MCP 规则写入：已创建'),
      3000
    )
    check('MCP 工作区规则允许后写入完成', ruleWriteDone, one('.w1-thread')?.textContent?.slice(-100) ?? '')

    const autoWriteInput = one('#composer-input')
    setValue(autoWriteInput, 'MCP 自动写入')
    await sleep(80)
    autoWriteInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const autoWriteDone = await waitFor(
      () =>
        (one('.w1-thread')?.textContent ?? '').includes('MCP 自动写入：已创建') &&
        !one('.w1-mcpapprove'),
      3000
    )
    check(
      '工作区规则命中后第二次 MCP 写入无卡',
      autoWriteDone,
      one('.w1-thread')?.textContent?.slice(-100) ?? ''
    )

    one('.w1-settings')?.click()
    await waitFor(() => !!one('.w1-settings-sheet'), 2000)
    const ruleShown = await waitFor(
      () => (one('.w1-setrules')?.textContent ?? '').includes('tasks_create'),
      2000
    )
    check('设置页显示审批规则', ruleShown, one('.w1-setrules')?.textContent?.slice(0, 120) ?? 'missing')
    byText('.w1-setrule .w1-setbtn', '撤销')?.click()
    const ruleRevoked = await waitFor(
      () => !(one('.w1-setrules')?.textContent ?? '').includes('tasks_create'),
      2000
    )
    check('设置页可撤销审批规则', ruleRevoked, one('.w1-setrules')?.textContent ?? 'empty')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(() => !one('.w1-settings-sheet'), 2000)

    const revokedInput = one('#composer-input')
    setValue(revokedInput, 'MCP 审批写入')
    await sleep(80)
    revokedInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const cardBack = await waitFor(() => !!one('.w1-mcpapprove'), 2500)
    check('撤销后 MCP 写入重新弹卡', cardBack, one('.w1-mcpapprove')?.textContent?.slice(0, 120) ?? 'missing')
    byText('.w1-mcpapprove .w1-pb', '拒绝')?.click()
    await waitFor(() => !one('.w1-mcpapprove'), 2000)

    await window.ws.mcp.setPolicy('task', 'write')
    await sleep(150)

    await navTo('今日')
    await sleep(500)
    check(
      'MCP 写入后任务出现在今日',
      (one('.w1-main')?.textContent ?? '').includes('MCP 写入测试'),
      one('.w1-main')?.textContent?.slice(0, 120) ?? ''
    )
    await navTo('Agent')
    await sleep(400)

    document.querySelector('[aria-label="新建 Codex 会话"]')?.click()
    await sleep(700)
    check(
      '新建 Codex 会话（继承 CLI 时只读）',
      all('.w1-sess').length === 2 &&
        (one('.w1-term')?.textContent ?? '').includes('codex') &&
        (one('.w1-term')?.textContent ?? '').includes('read-only'),
      one('.w1-term')?.textContent ?? ''
    )
    check(
      '新 Codex 会话先要求工作区',
      !!one('.w1-aworkspacegate') && one('#composer-input')?.disabled === true,
      one('.w1-aworkspace')?.getAttribute('title') ?? 'missing'
    )
    one('.w1-aworkspacegate .w1-pb')?.click()
    const codexWorkspaceReady = await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    check(
      'Codex 工作区选择后启用',
      codexWorkspaceReady && (one('.w1-aworkspace')?.getAttribute('title') ?? '').includes('workspace'),
      one('.w1-aworkspace')?.getAttribute('title') ?? 'missing'
    )
    await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.filter((session) => session.workspace).length >= 2
    }, 3000)

    const codexInput = one('#composer-input')
    setValue(codexInput, '读一下入口')
    await sleep(80)
    codexInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(1000)
    const codexText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? ''
    check('Codex 回复来自 JSONL 流', codexText.includes('Codex 只读回复'), codexText)
    check(
      'Codex 子进程使用会话工作区',
      codexText.includes('工作目录：') && codexText.includes('workspace'),
      codexText.slice(-120)
    )
    const codexTool = all('.w1-amsg').at(-1)?.querySelector('.w1-tool')
    check(
      'Codex 命令渲染成工具卡',
      codexTool?.textContent?.includes('Shell') &&
        codexTool?.textContent?.includes('Get-Content') &&
        codexTool?.textContent?.includes('完成'),
      codexTool?.textContent ?? 'missing'
    )

    byText('.w1-sess', '测一下多会话回复')?.click()
    await sleep(400)
    check(
      '可切回 Claude 会话',
      (one('.w1-term')?.textContent ?? '').includes('claude'),
      one('.w1-term')?.textContent ?? ''
    )

    // 搜索框随会话栏挂载，切会话时可能还没渲染，固定 sleep 会偶发 target missing
    await waitFor(() => Boolean(one('.w1-railsearch input')), 2000)
    const sessionSearch = one('.w1-railsearch input')
    setValue(sessionSearch, 'Codex 只读回复')
    const contentHit = await waitFor(
      () =>
        Boolean(one('.w1-sess.search')) &&
        (one('.w1-sess.search .w1-sm')?.textContent ?? '').includes('Codex 只读回复'),
      4000
    )
    check(
      '会话搜索命中正文',
      contentHit && (one('.w1-sess.search .w1-srhit')?.textContent ?? '') === '正文',
      one('.w1-sess.search')?.textContent?.slice(0, 100) ?? 'missing'
    )
    one('.w1-sess.search')?.click()
    const jumped = await waitFor(() => Boolean(one('.w1-msg-jump')), 3000)
    check(
      '搜索跳转到命中消息',
      jumped && (one('.w1-msg-jump')?.textContent ?? '').includes('Codex 只读回复'),
      one('.w1-msg-jump')?.textContent?.slice(0, 80) ?? 'missing'
    )
    setValue(sessionSearch, '测一下多会话回复')
    const titleHit = await waitFor(
      () => (one('.w1-sess.search .w1-st')?.textContent ?? '').includes('测一下多会话回复'),
      4000
    )
    check(
      '会话搜索命中标题',
      titleHit,
      one('.w1-sess.search')?.textContent?.slice(0, 80) ?? 'missing'
    )
    sessionSearch.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    const searchCleared = await waitFor(
      () => !one('.w1-railsearch input')?.value && !one('.w1-sess.search'),
      3000
    )
    check(
      'Esc 清空会话搜索',
      searchCleared && all('.w1-sess').length >= 2,
      String(all('.w1-sess').length)
    )

    const renameTarget = [...document.querySelectorAll('.w1-sessrow')].find((row) =>
      row.textContent?.includes('测一下多会话回复')
    )
    renameTarget?.querySelector('.w1-sessrenameicon')?.click()
    await waitFor(() => Boolean(one('.w1-sessrename')), 2000)
    const sessionRenameInput = one('.w1-sessrename')
    setValue(sessionRenameInput, '重命名验证')
    sessionRenameInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const renamed = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.some((session) => session.title === '重命名验证')
    }, 3000)
    check(
      '会话重命名写入数据库',
      renamed && Boolean(byText('.w1-sess', '重命名验证')),
      one('.w1-sess')?.textContent?.slice(0, 80) ?? 'missing'
    )

    const revertTarget = [...document.querySelectorAll('.w1-sessrow')].find((row) =>
      row.textContent?.includes('重命名验证')
    )
    revertTarget?.querySelector('.w1-sessrenameicon')?.click()
    await waitFor(() => Boolean(one('.w1-sessrename')), 2000)
    const sessionRevertInput = one('.w1-sessrename')
    setValue(sessionRevertInput, '测一下多会话回复')
    sessionRevertInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const reverted = await waitFor(
      () => Boolean(byText('.w1-sess', '测一下多会话回复')),
      3000
    )
    check(
      '会话重命名可改回原标题',
      reverted,
      one('.w1-sess')?.textContent?.slice(0, 80) ?? 'missing'
    )

    const exportButton = byText('.w1-aworkspacefiles', '导出')
    exportButton?.click()
    const exported = await waitFor(
      () => Boolean(byText('.w1-aworkspacefiles', '已导出')),
      3000
    )
    check(
      '会话可导出 Markdown',
      exported,
      one('.w1-term')?.textContent?.slice(-40) ?? 'missing'
    )

    const pinRow = [...document.querySelectorAll('.w1-sessrow')].find((row) =>
      row.textContent?.includes('测一下多会话回复')
    )
    pinRow?.querySelector('.w1-sesspinicon')?.click()
    const pinned = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.some(
        (session) => session.title === '测一下多会话回复' && session.pinned === true
      )
    }, 3000)
    const pinnedRow = [...document.querySelectorAll('.w1-sessrow')].find((row) =>
      row.textContent?.includes('测一下多会话回复')
    )
    check(
      '会话置顶写入数据库并显示标记',
      pinned &&
        pinnedRow?.classList.contains('pinned') === true &&
        (pinnedRow?.querySelector('.w1-spinmark')?.textContent ?? '') === '置顶' &&
        pinnedRow?.querySelector('.w1-sesspinicon')?.getAttribute('aria-pressed') === 'true',
      pinnedRow?.textContent?.slice(0, 80) ?? 'missing'
    )

    pinnedRow?.querySelector('.w1-sesspinicon')?.click()
    const unpinned = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.some(
        (session) => session.title === '测一下多会话回复' && !session.pinned
      )
    }, 3000)
    check('会话可取消置顶', unpinned && !document.querySelector('.w1-spinmark'), String(unpinned))

    const beforeDelete = await window.ws.agent.threads()
    const beforeIds = new Set(beforeDelete.sessions.map((session) => session.id))
    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    const createdNew = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.some((session) => !beforeIds.has(session.id))
    }, 3000)
    const createdBundle = await window.ws.agent.threads()
    const doomed = createdBundle.sessions.find((session) => !beforeIds.has(session.id))
    one('.w1-adelete')?.click()
    const armed = await waitFor(
      () => (one('.w1-adelete')?.textContent ?? '') === '确认删除',
      2000
    )
    one('.w1-adelete')?.click()
    const deleted = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return (
        !bundle.sessions.some((session) => session.id === doomed?.id) &&
        all('.w1-sess').length === beforeIds.size
      )
    }, 3000)
    check(
      '会话删除二次确认并写库',
      createdNew && armed && deleted && Boolean(one('.w1-sess.on')),
      createdNew + ' / ' + armed + ' / ' + deleted + ' / ' + (doomed?.id ?? 'missing')
    )

    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await sleep(500)
    one('.w1-aworkspacegate .w1-pb')?.click()
    await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const slowInput = one('#composer-input')
    setValue(slowInput, '并发慢会话一号')
    await sleep(80)
    slowInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(200)
    check('慢会话开始运行', !!one('.w1-typing'))
    check(
      '运行中的会话禁用删除',
      one('.w1-adelete')?.disabled === true,
      String(one('.w1-adelete')?.disabled)
    )

    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await sleep(500)
    one('.w1-aworkspacegate .w1-pb')?.click()
    await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const fastInput = one('#composer-input')
    setValue(fastInput, '第二个并发会话')
    await sleep(80)
    fastInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    const fastDone = await waitFor(
      () =>
        (one('.w1-thread')?.textContent ?? '').includes('读完了') &&
        !one('.w1-typing'),
      3000
    )
    check(
      '另一个会话在前一个运行中正常完成',
      fastDone,
      one('.w1-thread')?.textContent?.slice(-80) ?? 'missing'
    )

    byText('.w1-sess', '并发慢会话一号')?.click()
    await sleep(250)
    check('切回慢会话仍在等待', !!one('.w1-typing'), one('.w1-term')?.textContent ?? '')
    const slowDone = await waitFor(
      () =>
        (one('.w1-thread')?.textContent ?? '').includes('慢会话结束') &&
        !one('.w1-typing'),
      5000
    )
    check(
      '慢会话稍后独立完成',
      slowDone,
      one('.w1-thread')?.textContent?.slice(-80) ?? 'missing'
    )

    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await sleep(500)
    one('.w1-aworkspacegate .w1-pb')?.click()
    await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const stopInput = one('#composer-input')
    setValue(stopInput, '并发慢会话二号')
    await sleep(80)
    stopInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const stopReady = await waitFor(
      () => Boolean(one('.w1-stop')) && one('.w1-stop')?.disabled === false && !!one('.w1-typing'),
      3000
    )
    check('运行中可停止当前回复', stopReady, one('.w1-stop')?.disabled === false ? 'ready' : 'missing')
    one('.w1-stop')?.click()
    const stopDone = await waitFor(() => !one('.w1-typing') && !one('.w1-stop'), 4000)
    const stopThread = one('.w1-thread')?.textContent ?? ''
    check(
      '停止后回到空闲且不写入后续文本',
      stopDone && !stopThread.includes('慢会话结束'),
      stopThread.slice(-80)
    )

    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await sleep(500)
    one('.w1-aworkspacegate .w1-pb')?.click()
    await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const approvalAInput = one('#composer-input')
    setValue(approvalAInput, '并发审批甲')
    await sleep(80)
    approvalAInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const approvalAVisible = await waitFor(() => !!one('.w1-toolperm'), 2500)
    check(
      '会话甲出现审批卡',
      approvalAVisible && (one('.w1-toolperm')?.textContent ?? '').includes('tmp/concurrent.txt'),
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? 'missing'
    )

    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await sleep(500)
    one('.w1-aworkspacegate .w1-pb')?.click()
    await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const approvalBInput = one('#composer-input')
    setValue(approvalBInput, '并发审批乙')
    await sleep(80)
    approvalBInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const approvalBVisible = await waitFor(
      () =>
        !!one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('等待并发审批'),
      2500
    )
    check(
      '会话乙出现自己的审批卡',
      approvalBVisible,
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? 'missing'
    )
    check(
      '后台审批入口提示另一会话',
      (one('.w1-queue')?.textContent ?? '').includes('1 项待审批'),
      one('.w1-queue')?.textContent ?? 'missing'
    )

    byText('.w1-sess', '并发审批甲')?.click()
    await sleep(300)
    check(
      '切到会话甲仍看到自己的审批卡',
      (one('.w1-toolperm')?.textContent ?? '').includes('tmp/concurrent.txt'),
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb.pri', '允许一次')?.click()
    const approvalADone = await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('并发审批已允许'),
      2500
    )
    check(
      '允许会话甲后它单独完成',
      approvalADone && (one('.w1-queue')?.textContent ?? '').includes('1 项待审批'),
      one('.w1-thread')?.textContent?.slice(-80) ?? 'missing'
    )

    byText('.w1-sess', '并发审批乙')?.click()
    await sleep(300)
    check(
      '会话乙的审批卡没有被误关',
      (one('.w1-toolperm')?.textContent ?? '').includes('tmp/concurrent.txt'),
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '拒绝')?.click()
    const approvalBDone = await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('并发审批已拒绝'),
      2500
    )
    check(
      '会话乙拒绝后独立完成',
      approvalBDone && (one('.w1-status')?.textContent ?? '').includes('无待审批'),
      one('.w1-thread')?.textContent?.slice(-80) ?? 'missing'
    )

    const fleetButton = one('.w1-st-fleet')
    check(
      '状态栏有舰队入口',
      (fleetButton?.textContent ?? '').includes('舰队'),
      fleetButton?.textContent ?? 'missing'
    )
    fleetButton?.click()
    await waitFor(() => !!one('.w1-fleetsheet'), 2000)
    const fleetRows = all('.w1-fleetrow')
    check(
      '舰队控制台列出全部会话',
      fleetRows.length >= 6 &&
        (one('.w1-fleetsheet')?.textContent ?? '').includes('Claude Code') &&
        (one('.w1-fleetsheet')?.textContent ?? '').includes('Codex'),
      String(fleetRows.length) + ' 行 · ' + (one('.w1-fleetheadmeta')?.textContent ?? '')
    )
    check(
      '舰队汇总显示运行与审批',
      (one('.w1-fleetheadmeta')?.textContent ?? '').includes('会话') &&
        (one('.w1-fleetheadmeta')?.textContent ?? '').includes('待审批'),
      one('.w1-fleetheadmeta')?.textContent ?? 'missing'
    )

    byText('.w1-fleetheadmeta .w1-capmini', '存预设')?.click()
    const presetReady = await waitFor(() => !!one('.w1-fleetpreset'), 3000)
    check(
      '会话预设可保存',
      presetReady && (one('.w1-fleetpresets')?.textContent ?? '').includes('预设'),
      one('.w1-fleetpresets')?.textContent?.slice(0, 80) ?? 'missing'
    )
    one('.w1-fleetpresetdel')?.click()
    const presetRemoved = await waitFor(() => !one('.w1-fleetpreset'), 3000)
    check('会话预设可删除', presetRemoved)

    byText('.w1-fleetheadmeta .w1-capmini', '用量')?.click()
    const usageReady = await waitFor(() => !!one('.w1-fleetusage'), 3000)
    const usageRuns = await window.ws.agent.usage(7)
    check(
      '舰队用量统计可用',
      usageReady &&
        usageRuns.length > 0 &&
        (one('.w1-fleetusagesum')?.textContent ?? '').includes(String(usageRuns.length)),
      String(usageRuns.length) + ' 轮 · ' + (one('.w1-fleetusagesum')?.textContent ?? 'missing')
    )
    byText('.w1-fleetfilters button', '运行中')?.click()
    await sleep(250)
    check(
      '舰队筛选可切到运行中',
      !!one('.w1-fleetempty') && all('.w1-fleetrow').length === 0,
      one('.w1-fleetempty')?.textContent?.slice(0, 40) ?? 'missing'
    )
    byText('.w1-fleetfilters button', '全部')?.click()
    await sleep(250)

    const archiveTarget = all('.w1-fleetrow').find((row) =>
      row.textContent?.includes('测一下多会话回复')
    )
    const archiveId = archiveTarget?.getAttribute('data-session-id')
    archiveTarget?.querySelector('.w1-fleetarchive')?.click()
    const archived = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.some(
        (session) => session.id === archiveId && session.archived === true
      )
    }, 3000)
    const hiddenFromRail = !all('.w1-sess').some((el) =>
      el.textContent?.includes('测一下多会话回复')
    )
    check(
      '会话可归档并从会话栏隐藏',
      archived &&
        hiddenFromRail &&
        !all('.w1-fleetrow').some((row) => row.getAttribute('data-session-id') === archiveId),
      archiveId ?? 'missing'
    )

    byText('.w1-fleetfilters button', '已归档')?.click()
    await sleep(250)
    const archivedRow = all('.w1-fleetrow').find(
      (row) => row.getAttribute('data-session-id') === archiveId
    )
    archivedRow?.querySelector('.w1-fleetopen')?.click()
    const restored = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.some((session) => session.id === archiveId && !session.archived)
    }, 3000)
    byText('.w1-fleetfilters button', '全部')?.click()
    await sleep(250)
    check(
      '已归档会话可取消归档',
      restored &&
        all('.w1-sess').some((el) => el.textContent?.includes('测一下多会话回复')) &&
        all('.w1-fleetrow').some((row) => row.getAttribute('data-session-id') === archiveId),
      String(restored)
    )

    byText('.w1-fleetheadmeta .w1-capmini', '用量')?.click()
    await sleep(150)
    byText('.w1-fleetheadmeta .w1-capmini', '导入本机')?.click()
    const importListed = await waitFor(() => all('.w1-fleetimportrow').length === 2, 3000)
    check(
      '舰队可只读扫描本机会话',
      importListed &&
        (one('.w1-fleetimport')?.textContent ?? '').includes('只读扫描') &&
        (one('.w1-fleetimport')?.textContent ?? '').includes('Claude 冒烟会话') &&
        (one('.w1-fleetimport')?.textContent ?? '').includes('导入 Codex 冒烟会话'),
      one('.w1-fleetimport')?.textContent?.slice(0, 120) ?? 'missing'
    )
    const rowsBeforeImport = all('.w1-fleetrow').length
    const claudeImport = all('.w1-fleetimportrow').find((el) =>
      el.textContent.includes('Claude 冒烟会话')
    )
    claudeImport?.querySelector('.w1-fleetimportbtn')?.click()
    const importedRow = await waitFor(
      () =>
        claudeImport?.classList.contains('on') &&
        (claudeImport?.textContent ?? '').includes('补历史'),
      3000
    )
    const importedThreads = await window.ws.agent.threads()
    const persistedImport = importedThreads.sessions.find(
      (session) => session.resumeId === 'smoke-claude-import'
    )
    check(
      '导入的本机会话进入舰队并落库',
      importedRow &&
        all('.w1-fleetrow').length === rowsBeforeImport + 1 &&
        !!persistedImport &&
        persistedImport.workspace === window.__WS_AGENT_WORKSPACE__ &&
        persistedImport.agent === 'claude',
      String(all('.w1-fleetrow').length) +
        ' 行 · ' +
        (persistedImport ? persistedImport.id : 'missing')
    )
    byText('.w1-fleetrow', 'Claude 冒烟会话')?.querySelector('.w1-fleetopen')?.click()
    const fleetClosed = await waitFor(() => !one('.w1-fleetsheet'), 2000)
    check(
      '舰队可打开并切回会话',
      fleetClosed && activeNav() === 'Agent' && !!one('.w1-dock'),
      activeNav()
    )
    const importHistoryReady = await waitFor(
      () =>
        !!one('.w1-importnote') &&
        (one('.w1-thread')?.textContent ?? '').includes('导入 Claude 冒烟会话') &&
        (one('.w1-thread')?.textContent ?? '').includes('Read') &&
        (one('.w1-thread')?.textContent ?? '').includes('smoke-note.txt'),
      2500
    )
    check(
      '导入会话显示只读历史与工具卡',
      importHistoryReady,
      one('.w1-thread')?.textContent?.slice(0, 160) ?? 'missing'
    )

    const forkButton = all('.w1-amsg .w1-fork').at(-1)
    const forkHint = forkButton?.getAttribute('title') ?? ''
    check('最新回复提供真分叉提示', forkHint.includes('真分叉'), forkHint)
    forkButton?.click()
    const forked = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.some(
        (session) =>
          session.title.includes('分叉') &&
          session.resumeId === persistedImport?.resumeId &&
          session.pendingFork === true &&
          bundle.messages.some((message) => message.sessionId === session.id)
      )
    }, 3000)
    check(
      '会话可从最新回复真分叉',
      forked && (one('.w1-sess.on .w1-st')?.textContent ?? '').includes('分叉'),
      one('.w1-sess.on .w1-st')?.textContent ?? 'missing'
    )

    await navTo('今日')
    check('返回今日后仍有任务', all('.w1-task').length > 0, String(all('.w1-task').length))

    const cardRow = all('.w1-task').find(
      (el) => el.dataset.taskId && !el.classList.contains('done')
    )
    const cardId = cardRow?.dataset.taskId ?? ''
    const timeline = one('.w1-tl')
    if (cardRow && timeline && cardId) {
      const dt = new DataTransfer()
      cardRow.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
      )
      const rect = timeline.getBoundingClientRect()
      const dropX = rect.left + rect.width * 0.5
      timeline.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: dropX,
          clientY: rect.top + 10
        })
      )
      await sleep(80)
      check('时间轴拖拽高亮', timeline.classList.contains('drop'))
      timeline.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: dropX,
          clientY: rect.top + 10
        })
      )
      const timeCell = () =>
        document.querySelector('.w1-task[data-task-id="' + cardId + '"] .w1-time')
      await waitFor(() => timeCell()?.textContent?.trim() === '15:30', 2500)
      const draggedTime = timeCell()?.textContent?.trim()
      check('拖到时间轴写入 15:30', draggedTime === '15:30', String(draggedTime))
    }
    const undone = one('.w1-task:not(.done)')
    const undoneTitle = undone?.querySelector('.w1-ttext')?.textContent ?? ''
    const doneBefore = all('.w1-task.done').length
    undone?.click()
    // 完成动作要落库再重渲染，固定 sleep 会抢跑成旧计数
    await waitFor(() => all('.w1-task.done').length === doneBefore + 1, 2500)
    check(
      '勾选任务后完成数 +1',
      all('.w1-task.done').length === doneBefore + 1,
      doneBefore + ' -> ' + all('.w1-task.done').length
    )
    check(
      '任务进度同步',
      (one('.w1-tprog b')?.textContent ?? '').includes(doneBefore + 1 + ' / '),
      one('.w1-tprog b')?.textContent ?? ''
    )

    byText('.w1-filter', '已完成')?.click()
    const filteredDone = await waitFor(
      () => all('.w1-task').length === doneBefore + 1,
      2000
    )
    check(
      '筛选已完成',
      filteredDone,
      all('.w1-task').length + '（期望 ' + (doneBefore + 1) + '）'
    )
    byText('.w1-filter', '全部')?.click()
    await waitFor(
      () => all('.w1-task').length > all('.w1-task.done').length,
      2000
    )
    check(
      '筛选恢复全部',
      all('.w1-task').length > all('.w1-task.done').length &&
        all('.w1-task.done').length === doneBefore + 1,
      String(all('.w1-task').length)
    )

    // 完成动作放在今日卡计数断言之后，避免改变看板基线
    one('.w1-st-reminders')?.click()
    await waitFor(() => Boolean(one('.w1-remindersheet')), 2000)
    const reminderDoneRow = all('.w1-reminderrow')[0]
    const reminderDoneTitle =
      reminderDoneRow?.querySelector('.w1-reminderrowmain b')?.textContent ?? ''
    reminderDoneRow?.querySelector('.w1-reminderact')?.click()
    const reminderDone = await waitFor(async () => {
      const tasks = await window.ws.tasks.list()
      return tasks.some((task) => task.title === reminderDoneTitle && task.done)
    }, 3000)
    check('提醒中心可直接完成任务', reminderDone, reminderDoneTitle)
    one('.w1-reminderclose')?.click()
    await waitFor(() => !one('.w1-remindersheet'), 2000)

    // 子任务：父任务行显示进度，勾选后更新，删父任务连带清理
    await navTo('任务')
    await sleep(500)
    const topBefore = (await window.ws.tasks.list()).filter((task) => !task.parentId).length
    const subParent = one('.w1-todoinput')
    setValue(subParent, '整理季度复盘')
    await sleep(120)
    subParent.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await sleep(600)
    const subParentFound = await waitFor(
      () => all('.w1-todorowwrap').some((row) => row.textContent?.includes('整理季度复盘')),
      3000
    )
    // 新任务带 View Transition；过渡遮罩会吞掉紧跟着的点击，按 aria-expanded 重试
    const openSubtaskDetail = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const body = all('.w1-todorowwrap')
          .find((row) => row.textContent?.includes('整理季度复盘'))
          ?.querySelector('.w1-todobody')
        if (!body) {
          await sleep(300)
          continue
        }
        if (body.getAttribute('aria-expanded') !== 'true') body.click()
        if (await waitFor(() => Boolean(one('.w1-todosubadd input')), 1000)) return true
      }
      return false
    }
    const subInputOpen = await openSubtaskDetail()
    const subInput = one('.w1-todosubadd input')
    check(
      '详情里有子任务输入框',
      subParentFound && subInputOpen && Boolean(subInput),
      subParentFound ? (subInputOpen ? 'open' : 'detail missing') : 'row missing'
    )
    if (!subInput) throw new Error('子任务输入框未出现')
    for (const title of ['收集数据', '写结论']) {
      setValue(subInput, title)
      await sleep(80)
      subInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      )
      await waitFor(() => all('.w1-todosubrow').length === (title === '收集数据' ? 1 : 2), 2500)
    }
    check(
      '子任务出现在详情里',
      all('.w1-todosubrow').length === 2,
      String(all('.w1-todosubrow').length)
    )
    one('.w1-todosubrow .w1-todocb')?.click()
    const subBadgeOf = () =>
      all('.w1-todorowwrap')
        .find((row) => row.textContent?.includes('整理季度复盘'))
        ?.querySelector('.w1-todosubcount')?.textContent
    await waitFor(() => subBadgeOf() === '1/2', 2500)
    const subBadge = subBadgeOf()
    check('父任务行显示 1/2 进度', subBadge === '1/2', subBadge ?? 'missing')
    const subCounts = await window.ws.tasks.list()
    check(
      '子任务不进入清单计数',
      subCounts.filter((task) => !task.parentId).length === topBefore + 1,
      topBefore + ' -> ' + subCounts.filter((task) => !task.parentId).length
    )
    // 删掉父任务：子任务应一起软删
    byText('.w1-todoedit .w1-tododelete', '删除任务')?.click()
    await waitFor(
      () => byText('.w1-todoedit .w1-tododelete', '再次点击确认删除') !== undefined,
      1500
    )
    byText('.w1-todoedit .w1-tododelete', '再次点击确认删除')?.click()
    await waitFor(async () => {
      const rows = await window.ws.tasks.list()
      return !rows.some((task) => task.parentId)
    }, 3000)
    const afterDelete = await window.ws.tasks.list()
    check(
      '删除父任务后子任务一并移除',
      !afterDelete.some((task) => task.parentId),
      String(afterDelete.filter((task) => task.parentId).length)
    )

    // 设置面板：从左侧导航打开，读到真实数据路径与版本
    await navTo('今日')
    one('.w1-settings')?.click()
    await sleep(600)
    check('设置面板可打开', !!one('.w1-settings-sheet'), one('.w1-navver')?.textContent ?? '')
    const settingsText = one('.w1-settings-sheet')?.textContent ?? ''
    check(
      '设置面板显示版本与数据路径',
      settingsText.includes('当前版本 v') && settingsText.includes('ws-smoke-'),
      settingsText.slice(0, 120)
    )
    check(
      '设置面板读到备份份数',
      (one('.w1-setbackupcount')?.textContent ?? '').includes('份'),
      one('.w1-setbackupcount')?.textContent ?? 'missing'
    )
    const storageInfo = await window.ws.app.storage()
    check(
      '设置面板显示存储位置',
      storageInfo.root.includes('ws-smoke-') &&
        settingsText.includes('存储位置') &&
        (one('.w1-setstoragerow')?.textContent ?? '').includes(
          storageInfo.root.split(/[\\/]/).pop()
        ),
      storageInfo.root
    )

    const backupLoaded = await waitFor(() => all('.w1-backuprow').length >= 2, 3000)
    check(
      '备份列表显示可恢复快照',
      backupLoaded && all('.w1-backuprow').some((row) => row.textContent?.includes('99999999')),
      all('.w1-backuprow')
        .map((row) => row.querySelector('.w1-backupmain span')?.textContent ?? '')
        .join(',')
    )

    const corruptRow = all('.w1-backuprow').find((row) => row.textContent?.includes('99999999'))
    corruptRow?.querySelector('.w1-backupbtn')?.click()
    await waitFor(() => Boolean(one('.w1-backupconfirm')), 2000)
    corruptRow?.querySelector('.w1-backupconfirm .w1-backupbtn.danger')?.click()
    const restoreError = await waitFor(
      () => (one('.w1-backuperror')?.textContent ?? '').includes('数据库'),
      3000
    )
    check(
      '损坏备份给出可读错误',
      restoreError,
      one('.w1-backuperror')?.textContent?.slice(0, 80) ?? 'missing'
    )

    const validRow = all('.w1-backuprow').find((row) => !row.textContent?.includes('99999999'))
    validRow?.querySelector('.w1-backupbtn')?.click()
    await waitFor(() => Boolean(one('.w1-backupconfirm')), 2000)
    validRow?.querySelector('.w1-backupconfirm .w1-backupbtn.danger')?.click()
    const pendingReady = await waitFor(
      () => (one('.w1-backupstate.pending')?.textContent ?? '').includes('恢复已排好'),
      3000
    )
    const pendingState = await window.ws.app.restoreStatus()
    const safetyVisible = await waitFor(
      () => all('.w1-backuprow').some((row) => row.textContent?.includes('恢复前快照')),
      3000
    )
    check(
      '恢复进入待重启并留下安全快照',
      pendingReady && pendingState.status === 'pending' && safetyVisible,
      JSON.stringify(pendingState)
    )

    check('设置面板有 Provider 卡片', !!one('.w1-provcard'))
    check(
      '本机模型设置卡就绪',
      !!one('.w1-localmodel') && all('.w1-localmodel input').length >= 3,
      String(all('.w1-localmodel input').length)
    )
    check(
      'Provider 接线台有双目标端口',
      all('.w1-provport').length === 2 && !!one('.w1-provdeckhead'),
      String(all('.w1-provport').length)
    )
    check(
      'Provider 模式是信号路由',
      !!one('.w1-provroute') && all('.w1-provroute .w1-provseg button').length === 2,
      one('.w1-provroute')?.textContent ?? 'missing'
    )
    check(
      'Provider 继承态有说明卡',
      !!one('.w1-provinherit'),
      one('.w1-provinherit')?.textContent ?? 'missing'
    )
    byText('.w1-provseg button', 'Codex CLI')?.click()
    await sleep(200)
    byText('.w1-provseg button', '自定义')?.click()
    await sleep(200)
    check(
      'Provider 可切到 Codex CLI',
      one('[aria-label="Provider 目标"] button.on')?.textContent?.includes('Codex') === true &&
        !!one('[aria-label="Codex 协议"]'),
      one('[aria-label="Provider 目标"] button.on')?.textContent ?? ''
    )
    const codexProtocol = one('[aria-label="Codex 协议"]')
    check(
      'Codex 协议只剩 Responses',
      codexProtocol?.textContent?.trim() === 'Responses' &&
        !(codexProtocol?.textContent ?? '').includes('Chat'),
      codexProtocol?.textContent?.trim() ?? 'missing'
    )
    byText('.w1-provseg button', 'Claude Code')?.click()
    await sleep(200)
    byText('.w1-provseg button', '自定义')?.click()
    await sleep(200)
    check(
      '设置面板有数据桥分区',
      settingsText.includes('数据桥') && all('.w1-modepair').length === 4,
      String(all('.w1-modepair').length)
    )
    await sleep(300)
    check(
      '设置面板有活动记录',
      all('.w1-auditrow').length > 0 &&
        (one('.w1-auditlist')?.textContent ?? '').includes('MCP'),
      one('.w1-auditlist')?.textContent?.slice(0, 100) ?? ''
    )
    byText('.w1-provseg button', '自定义')?.click()
    await sleep(200)
    setValue(one('input[aria-label="Provider 名称"]'), 'Smoke Provider')
    setValue(one('input[aria-label="Provider Base URL"]'), 'http://127.0.0.1:23333')
    setValue(one('input[aria-label="Provider 模型"]'), 'smoke-model')
    setValue(one('input[aria-label="Provider API Key"]'), 'sk-smoke-secret')
    byText('.w1-provsave', '保存并启用')?.click()
    await sleep(700)
    check(
      'Provider 加密保存并启用',
      (one('.w1-provstatus')?.textContent ?? '').includes('已加密保存'),
      one('.w1-provstatus')?.textContent ?? ''
    )
    check(
      'Provider 加密 Key 显示胶囊状态',
      (one('.w1-provkeytag')?.textContent ?? '').includes('已加密') &&
        (one('.w1-provstate')?.textContent ?? '').includes('已启用'),
      (one('.w1-provkeytag')?.textContent ?? '') +
        ' / ' +
        (one('.w1-provstate')?.textContent ?? '')
    )
    byText('.w1-provseg button', '继承 Claude Code')?.click()
    await sleep(400)
    check(
      'Provider 可切回继承 CLI',
      one('[aria-label="Provider 模式"] button.on')?.textContent?.includes(
        '继承 Claude Code'
      ) === true,
      one('[aria-label="Provider 模式"] button.on')?.textContent ?? ''
    )

    // Codex app-server：工作区审批走同一条 preload → 主进程 → 渲染链路
    byText('.w1-provseg button', 'Codex CLI')?.click()
    await sleep(200)
    byText('.w1-provseg button', '自定义')?.click()
    await sleep(200)
    setValue(one('input[aria-label="Provider 名称"]'), 'Smoke Codex Provider')
    setValue(one('input[aria-label="Provider Base URL"]'), 'http://127.0.0.1:23334')
    setValue(one('input[aria-label="Provider 模型"]'), 'smoke-codex-model')
    setValue(one('input[aria-label="Provider API Key"]'), 'sk-smoke-codex-secret')
    await sleep(120)
    const providerMeta = one('.w1-provmeta')?.textContent ?? ''
    check(
      'Provider 卡显示鉴权与端点',
      providerMeta.includes('Bearer') && providerMeta.includes('/responses'),
      providerMeta || 'missing'
    )
    byText('.w1-provsave', '保存并启用')?.click()
    await waitFor(
      () => (one('.w1-provstatus')?.textContent ?? '').includes('已加密保存'),
      3000
    )
    check(
      'Codex Provider 加密保存并启用',
      (one('.w1-provstatus')?.textContent ?? '').includes('已加密保存'),
      one('.w1-provstatus')?.textContent ?? ''
    )
    byText('.w1-provtest', '测试连接')?.click()
    const probeOk = await waitFor(
      () => (one('.w1-provtestresult.ok')?.textContent ?? '').includes('连接正常'),
      4000
    )
    check(
      'Provider 测试连接成功',
      probeOk && (one('.w1-provtestresult.ok')?.textContent ?? '').includes('ms'),
      one('.w1-provtestresult')?.textContent ?? 'missing'
    )
    byText('.w1-provmodelrow button', '拉取模型')?.click()
    const modelsLoaded = await waitFor(
      () => Boolean(byText('.w1-provmodels button', 'smoke-model-a')),
      4000
    )
    check(
      'Provider 模型列表可拉取',
      modelsLoaded && (one('.w1-provmodels')?.textContent ?? '').includes('smoke-model-b'),
      one('.w1-provmodels')?.textContent?.slice(0, 120) ?? 'missing'
    )
    byText('.w1-provmodels button', 'smoke-model-a')?.click()
    await waitFor(
      () => (one('input[aria-label="Provider 模型"]')?.value ?? '') === 'smoke-model-a',
      2000
    )
    check(
      '选择模型会回填输入框',
      (one('input[aria-label="Provider 模型"]')?.value ?? '') === 'smoke-model-a',
      one('input[aria-label="Provider 模型"]')?.value ?? 'missing'
    )
    setValue(one('input[aria-label="Provider Base URL"]'), 'http://127.0.0.1:23339')
    await sleep(120)
    byText('.w1-provtest', '测试连接')?.click()
    const probeFailed = await waitFor(
      () => Boolean(one('.w1-provtestresult.fail')),
      5000
    )
    check(
      'Provider 测试连接失败有原因',
      probeFailed && /连接|超时|凭据|端点/.test(one('.w1-provtestresult.fail')?.textContent ?? ''),
      one('.w1-provtestresult.fail')?.textContent ?? 'missing'
    )

    setValue(one('input[aria-label="Provider Base URL"]'), 'http://127.0.0.1:23334')
    setValue(one('input[aria-label="Provider 模型"]'), 'missing-model')
    await sleep(120)
    byText('.w1-provtest', '测试连接')?.click()
    const modelFail = await waitFor(
      () =>
        (one('.w1-provtestresult.fail')?.textContent ?? '').includes('模型不可用') &&
        (one('.w1-provtestresult.fail')?.textContent ?? '').includes('模型名'),
      4000
    )
    check(
      'Provider 测试连接提示模型不可用',
      modelFail,
      one('.w1-provtestresult.fail')?.textContent?.slice(0, 120) ?? 'missing'
    )

    setValue(one('input[aria-label="Provider Base URL"]'), 'http://127.0.0.1:23334/anthropic')
    setValue(one('input[aria-label="Provider 模型"]'), 'smoke-model-a')
    await sleep(120)
    byText('.w1-provtest', '测试连接')?.click()
    const protocolFail = await waitFor(
      () =>
        (one('.w1-provtestresult.fail')?.textContent ?? '').includes('协议') &&
        (one('.w1-provtestresult.fail')?.textContent ?? '').includes('Responses'),
      4000
    )
    check(
      'Provider 测试连接提示协议错配',
      protocolFail,
      one('.w1-provtestresult.fail')?.textContent?.slice(0, 160) ?? 'missing'
    )

    byText('.w1-settabs button', '能力中心')?.click()
    await waitFor(() => !!one('.w1-cap') && !!one('.w1-capnav'), 3000)
    check(
      '设置里有能力中心五分区',
      all('.w1-capnav button').length === 5 &&
        (one('.w1-capscope')?.textContent ?? '').includes('应用私有'),
      one('.w1-capnav')?.textContent ?? 'missing'
    )
    byText('.w1-capnav button', '推荐')?.click()
    await waitFor(() => all('.w1-caprow.rec').length === 26, 4000)
    check(
      '推荐页展示精选 CLI 清单',
      all('.w1-caprow.rec').length === 26 &&
        (one('.w1-cap')?.textContent ?? '').includes('ripgrep') &&
        (one('.w1-cap')?.textContent ?? '').includes('winget install --id'),
      String(all('.w1-caprow.rec').length)
    )
    const recSearch = one('.w1-capsearch')
    setValue(recSearch, 'ripgrep')
    await sleep(250)
    check(
      '推荐页可按关键词过滤',
      all('.w1-caprow.rec').length === 1 &&
        (one('.w1-caprow.rec')?.textContent ?? '').includes('ripgrep'),
      String(all('.w1-caprow.rec').length)
    )
    setValue(recSearch, '')
    await sleep(200)
    byText('.w1-capsort button', '系统')?.click()
    await sleep(250)
    check('推荐页可按分类过滤', all('.w1-caprow.rec').length === 4, String(all('.w1-caprow.rec').length))
    byText('.w1-capsort button', '全部')?.click()
    await sleep(200)
    check(
      '推荐页显示安装状态徽标',
      all('.w1-caprow.rec .w1-capbadge').length === 23,
      String(all('.w1-caprow.rec .w1-capbadge').length)
    )
    one('.w1-caprow.rec .w1-capmini[aria-label*="复制"]')?.click()
    const recCopyToast = await waitFor(
      () => (one('.w1-toast')?.textContent ?? '').includes('已复制 winget install'),
      2000
    )
    check('推荐页可复制安装命令', recCopyToast, one('.w1-toast')?.textContent ?? 'missing')
    check(
      '推荐页环境依赖行带双源选择',
      all('.w1-caprow.runtime').length === 3 &&
        all('.w1-caprow.runtime .w1-capsrcseg').every((seg) => seg.querySelectorAll('button').length === 2),
      String(all('.w1-caprow.runtime').length)
    )
    const nodeRuntimeRow = all('.w1-caprow.runtime').find((row) => (row.textContent ?? '').includes('node / npx'))
    const nodeSystemBtn = [...(nodeRuntimeRow?.querySelectorAll('.w1-capsrcseg button') ?? [])].find((b) => (b.textContent ?? '').startsWith('系统'))
    nodeSystemBtn?.click()
    const sourceToast = await waitFor(() => (one('.w1-toast')?.textContent ?? '').includes('node 生效源：系统'), 2000)
    check('环境依赖可切换生效源', sourceToast, one('.w1-toast')?.textContent ?? 'missing')
    check(
      '环境依赖托管安装入口存在',
      Boolean(nodeRuntimeRow?.querySelector('.w1-capmini[aria-label="安装 node 托管版本"]')),
      nodeRuntimeRow?.textContent?.slice(0, 80) ?? 'missing'
    )
    check(
      '推荐页 MCP 推荐组渲染',
      all('.w1-caprow.mcp-rec').length === 3 &&
        (one('.w1-caprow.mcp-rec')?.textContent ?? '').includes('无鉴权'),
      String(all('.w1-caprow.mcp-rec').length)
    )
    one('.w1-caprow.mcp-rec .w1-capmini[aria-label="添加 DeepWiki"]')?.click()
    const deepwikiAdded = await waitFor(async () => {
      const list = await window.ws.capability.mcp.list()
      const server = list.find((item) => item.url === 'https://mcp.deepwiki.com/mcp')
      return Boolean(server) && server.enabled === false && server.trusted === false
    }, 4000)
    check('MCP 推荐一键添加且默认停用未信任', deepwikiAdded, 'deepwiki')
    const deepwikiRow = (await window.ws.capability.mcp.list()).find(
      (item) => item.url === 'https://mcp.deepwiki.com/mcp'
    )
    if (deepwikiRow) await window.ws.capability.mcp.remove(deepwikiRow.id)
    check(
      '技能库推荐带添加源入口',
      all('.w1-caprow.skill-rec').length === 1 &&
        Boolean(one('.w1-caprow.skill-rec .w1-capmini[aria-label*="添加插件源"]')),
      one('.w1-caprow.skill-rec')?.textContent?.slice(0, 60) ?? 'missing'
    )
    byText('.w1-capnav button', '插件')?.click()
    await sleep(250)
    check(
      '插件页有源管理与本机导入入口',
      (one('.w1-capsrcblock')?.textContent ?? '').includes('SOURCES') &&
        (one('.w1-capsrcblock')?.textContent ?? '').includes('从本机导入') &&
        (one('.w1-capsrcblock')?.textContent ?? '').includes('添加源'),
      one('.w1-capsrcblock')?.textContent?.slice(0, 80) ?? 'missing'
    )
    // 按钮在源面板的 header 里；文本含 JSX 换行，用 includes 匹配
    const scanButton = all('.w1-capsrcblock .w1-capmini').find((button) =>
      (button.textContent ?? '').includes('从本机导入')
    )
    scanButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // 导入面板是第二块 .w1-capsrcblock，必须查全部节点
    const panelText = () => all('.w1-capsrcblock').map((el) => el.textContent ?? '').join(' | ')
    const importPanel = await waitFor(() => panelText().includes('IMPORT FROM MACHINE'), 4000)
    check(
      '本机导入面板列出两个 Agent',
      importPanel && panelText().includes('Claude') && panelText().includes('Codex'),
      panelText().slice(-120)
    )
    byText('.w1-capsrcblock .w1-capmini', '关闭')?.click()
    // 已安装区按 Agent 分段，Codex 半区读私有 codex-home
    const installed = await window.ws.capability.installedPlugins()
    check(
      '已安装列表接口按 Agent 返回插件',
      Array.isArray(installed) &&
        installed.every((item) => item.agent === 'claude' || item.agent === 'codex'),
      'count=' + installed.length + ' ' + installed.map((item) => item.agent + ':' + item.id).join(', ')
    )
    byText('.w1-capseg button', 'Codex')?.click()
    await sleep(200)
    check(
      '已安装区可切到 Codex 分段',
      (one('.w1-cap')?.textContent ?? '').includes('Codex'),
      one('.w1-cap')?.textContent?.slice(0, 60) ?? 'missing'
    )
    byText('.w1-capseg button', '全部')?.click()
    byText('.w1-capseg button', '市场')?.click()
    const marketLoaded = await waitFor(
      () => (one('.w1-capcard')?.textContent ?? '').includes('demo-skill'),
      5000
    )
    check(
      'Claude 市场清单可读取',
      marketLoaded,
      one('.w1-capgrid')?.textContent?.slice(0, 80) ?? 'missing'
    )
    one('.w1-capcard .w1-capmini.pri')?.click()
    await waitFor(
      () => (one('.w1-capcard')?.textContent ?? '').includes('已安装'),
      5000
    )
    check('市场插件可一键安装到私有目录', (one('.w1-capcard')?.textContent ?? '').includes('已安装'))

    byText('.w1-capseg button', '已安装')?.click()
    await sleep(300)
    const skillRow = byText('.w1-caprow', 'demo-skill')
    check('已安装列表显示私有插件', Boolean(skillRow), skillRow?.textContent ?? 'missing')
    // 启用开关只有一个入口：技能页
    byText('.w1-capnav button', '技能')?.click()
    await waitFor(() => Boolean(byText('.w1-caprow', 'demo-skill')), 3000)
    byText('.w1-caprow', 'demo-skill')?.querySelector('.w1-setbtn')?.click()
    const skillEnabled = await waitFor(
      () => (byText('.w1-caprow', 'demo-skill')?.textContent ?? '').includes('已启用'),
      5000
    )
    const skillState = await window.ws.capability.skills.list()
    check(
      '技能页启用插件并落库',
      skillEnabled && skillState.length === 1 && skillState[0].enabled === true,
      JSON.stringify(skillState.map((item) => [item.name, item.enabled]))
    )
    byText('.w1-capnav button', '插件')?.click()
    await sleep(300)

    byText('.w1-caphead .w1-capmini', '本地导入')?.click()
    const localSkillReady = await waitFor(
      () => Boolean(byText('.w1-caprow', 'local-skill')),
      4000
    )
    const localDetailButton = [
      ...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '详情')
    localDetailButton?.click()
    const localDocReady = await waitFor(
      () => (one('.w1-skilldoc pre')?.textContent ?? '').includes('Local smoke skill'),
      3000
    )
    check(
      '本地 SKILL.md 可导入并查看源文件',
      localSkillReady && localDocReady,
      one('.w1-skilldetail')?.textContent?.slice(0, 120) ?? 'missing'
    )
    await waitFor(() => {
      const buttons = [
        ...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])
      ]
      return buttons.length > 0 && buttons.every((button) => !button.disabled)
    }, 3000)
    const localRemove = [
      ...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '移除')
    localRemove?.click()
    await waitFor(
      () =>
        [...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])].some(
          (button) => button.textContent === '确认移除'
        ),
      2000
    )
    ;[
      ...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '确认移除')?.click()
    const localRemoved = await waitFor(() => !byText('.w1-caprow', 'local-skill'), 3000)
    const localList = await window.ws.capability.skills.list()
    check(
      '本地技能可从私有目录移除',
      localRemoved && localList.length === 1,
      JSON.stringify(localList.map((item) => item.name))
    )

    byText('.w1-capnav button', 'MCP')?.click()
    await sleep(300)
    check(
      '外部 MCP 说明包含 Codex Provider 会话',
      (one('.w1-cap')?.textContent ?? '').includes('Codex app-server') &&
        (one('.w1-cap')?.textContent ?? '').includes('密钥只进子进程环境'),
      one('.w1-capnote')?.textContent?.slice(0, 100) ?? 'missing'
    )
    const memoryCard = byText('.w1-capcard', 'Memory')
    memoryCard?.querySelector('.w1-capmini.pri')?.click()
    const memoryRowReady = await waitFor(
      () => Boolean(byText('.w1-caprow', 'Memory')),
      4000
    )
    byText('.w1-caprow', 'Memory')?.querySelector('.w1-setbtn')?.click()
    await waitFor(
      () =>
        (byText('.w1-caprow', 'Memory')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '确认信任并启用',
      2000
    )
    byText('.w1-caprow', 'Memory')?.querySelector('.w1-setbtn')?.click()
    const memoryEnabled = await waitFor(
      () =>
        (byText('.w1-caprow', 'Memory')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '已启用',
      3000
    )
    const mcpState = await window.ws.capability.mcp.list()
    check(
      '内置 MCP 可添加、信任并启用',
      memoryRowReady &&
        memoryEnabled &&
        mcpState.some((server) => server.catalogId === 'memory' && server.enabled),
      JSON.stringify(mcpState.map((server) => [server.name, server.enabled]))
    )

    // 环境自检搬到了内置工具页，随原生开关一起断言（见下方）

    byText('.w1-caphead .w1-capmini', '导出')?.click()
    const exportReady = await waitFor(
      () => (one('.w1-capjson')?.value ?? '').includes('mcpServers'),
      3000
    )
    const exportText = one('.w1-capjson')?.value ?? ''
    check(
      'MCP JSON 导出包含 Server 且不导密钥值',
      exportReady && exportText.includes('"Memory"') && !exportText.includes('Bearer '),
      exportText.slice(0, 100)
    )
    byText('.w1-capform .w1-capmini', '取消')?.click()
    await sleep(200)

    byText('.w1-caphead .w1-capmini', '导入')?.click()
    await waitFor(() => !!one('.w1-capjson'), 2000)
    setValue(
      one('.w1-capjson'),
      JSON.stringify({
        mcpServers: {
          Imported: { command: 'node', args: [window.__WS_MCP_STUB__] }
        }
      })
    )
    byText('.w1-capform .w1-capmini.pri', '导入')?.click()
    const importedReady = await waitFor(
      () => Boolean(byText('.w1-caprow', 'Imported')),
      4000
    )
    check(
      'MCP JSON 导入生成停用 Server',
      importedReady,
      one('.w1-caplist')?.textContent?.slice(-80) ?? 'missing'
    )
    for (let index = 0; index < 2; index += 1) {
      const remove = [
        ...(byText('.w1-caprow', 'Imported')?.querySelectorAll('.w1-capmini') ?? [])
      ].find((button) => button.textContent === '移除' || button.textContent === '确认移除')
      remove?.click()
      await sleep(150)
    }
    await waitFor(() => !byText('.w1-caprow', 'Imported'), 3000)

    byText('.w1-caphead .w1-capmini.pri', '自定义 Server')?.click()
    await waitFor(() => !!one('.w1-capform'), 2000)
    setValue(one('input[aria-label="MCP 名称"]'), 'Stub MCP')
    setValue(one('input[aria-label="MCP 命令"]'), 'node')
    setValue(one('textarea[aria-label="MCP 参数"]'), window.__WS_MCP_STUB__)
    byText('.w1-capform .w1-capmini.pri', '添加 Server')?.click()
    const stubAdded = await waitFor(() => Boolean(byText('.w1-caprow', 'Stub MCP')), 4000)
    check('自定义 MCP 可添加', stubAdded, one('.w1-caplist')?.textContent?.slice(-80) ?? 'missing')

    byText('.w1-caphead .w1-capmini.pri', '自定义 Server')?.click()
    await waitFor(() => !!one('.w1-capform'), 2000)
    setValue(one('input[aria-label="MCP 名称"]'), 'OAuth UI')
    setValue(one('select[aria-label="MCP 传输方式"]'), 'http')
    await sleep(150)
    setValue(one('input[aria-label="MCP URL"]'), 'https://example.com/mcp')
    setValue(one('select[aria-label="MCP 认证方式"]'), 'oauth')
    await sleep(150)
    check('选择 OAuth 后隐藏请求头输入', !one('textarea[aria-label="MCP 请求头"]'))
    byText('.w1-capform .w1-capmini.pri', '添加 Server')?.click()
    await waitFor(() => Boolean(byText('.w1-caprow', 'OAuth UI')), 4000)
    const oauthRow = byText('.w1-caprow', 'OAuth UI')
    const oauthButtons = [...(oauthRow?.querySelectorAll('.w1-capmini') ?? [])].map(
      (button) => button.textContent
    )
    check(
      'OAuth Server 显示未登录与登录入口',
      (oauthRow?.textContent ?? '').includes('OAuth · 未登录') && oauthButtons.includes('登录'),
      oauthRow?.textContent?.slice(0, 100) ?? 'missing'
    )
    for (let index = 0; index < 2; index += 1) {
      const remove = [...(byText('.w1-caprow', 'OAuth UI')?.querySelectorAll('.w1-capmini') ?? [])].find(
        (button) => button.textContent === '移除' || button.textContent === '确认移除'
      )
      remove?.click()
      await sleep(150)
    }
    await waitFor(() => !byText('.w1-caprow', 'OAuth UI'), 3000)

    byText('.w1-caprow', 'Stub MCP')?.querySelector('.w1-setbtn')?.click()
    await waitFor(
      () =>
        (byText('.w1-caprow', 'Stub MCP')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '确认信任并启用',
      2000
    )
    byText('.w1-caprow', 'Stub MCP')?.querySelector('.w1-setbtn')?.click()
    await waitFor(
      () =>
        (byText('.w1-caprow', 'Stub MCP')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '已启用',
      2000
    )
    const stubTestButton = [
      ...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '测试')
    stubTestButton?.click()
    const stubTested = await waitFor(() => {
      const row = byText('.w1-caprow', 'Stub MCP')
      const text = row?.textContent ?? ''
      return text.includes('已连接') && text.includes('echo') && text.includes('stub_status')
    }, 5000)
    check(
      '外部 MCP 可测试连接并列出工具',
      stubTested,
      byText('.w1-caprow', 'Stub MCP')?.textContent?.slice(-120) ?? 'missing'
    )

    const stubToolsButton = [
      ...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent?.startsWith('工具'))
    stubToolsButton?.click()
    const toolsVisible = await waitFor(() => all('.w1-captool').length === 2, 2000)
    await waitFor(
      () => all('.w1-captoolseg button').every((button) => !button.disabled),
      3000
    )
    const allowButton = [
      ...(byText('.w1-captool', 'echo')?.querySelectorAll('.w1-captoolseg button') ?? [])
    ].find((button) => button.textContent === '自动')
    allowButton?.click()
    const allowSaved = await waitFor(async () => {
      const list = await window.ws.capability.mcp.list()
      return (
        list
          .find((server) => server.name === 'Stub MCP')
          ?.tools.find((tool) => tool.name === 'echo')?.approval === 'allow'
      )
    }, 3000)
    await waitFor(
      () => all('.w1-captoolseg button').every((button) => !button.disabled),
      3000
    )
    const denyButton = [
      ...(byText('.w1-captool', 'stub_status')?.querySelectorAll('.w1-captoolseg button') ?? [])
    ].find((button) => button.textContent === '禁止')
    denyButton?.click()
    const denySaved = await waitFor(async () => {
      const list = await window.ws.capability.mcp.list()
      const stub = list.find((server) => server.name === 'Stub MCP')
      return (
        stub?.tools.find((tool) => tool.name === 'stub_status')?.approval === 'deny' &&
        stub.tools.find((tool) => tool.name === 'echo')?.approval === 'allow'
      )
    }, 3000)
    check(
      'MCP 工具级权限可设置',
      toolsVisible && allowSaved && denySaved,
      byText('.w1-captoolpanel', '工具级权限')?.textContent?.slice(0, 120) ?? 'missing'
    )

    // HTTP 外部 MCP：真实 Streamable HTTP + 加密请求头
    byText('.w1-caphead .w1-capmini.pri', '自定义 Server')?.click()
    await waitFor(() => !!one('.w1-capform'), 2000)
    setValue(one('input[aria-label="MCP 名称"]'), 'HTTP MCP')
    setValue(one('select[aria-label="MCP 传输方式"]'), 'http')
    await sleep(150)
    setValue(one('input[aria-label="MCP URL"]'), 'http://127.0.0.1:23335/mcp')
    setValue(one('textarea[aria-label="MCP 请求头"]'), 'X-Smoke-Key=smoke-secret')
    byText('.w1-capform .w1-capmini.pri', '添加 Server')?.click()
    const httpAdded = await waitFor(() => Boolean(byText('.w1-caprow', 'HTTP MCP')), 4000)
    byText('.w1-caprow', 'HTTP MCP')?.querySelector('.w1-setbtn')?.click()
    await waitFor(
      () =>
        (byText('.w1-caprow', 'HTTP MCP')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '确认信任并启用',
      2000
    )
    byText('.w1-caprow', 'HTTP MCP')?.querySelector('.w1-setbtn')?.click()
    await waitFor(
      () =>
        (byText('.w1-caprow', 'HTTP MCP')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '已启用',
      2000
    )
    const httpTestButton = [
      ...(byText('.w1-caprow', 'HTTP MCP')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '测试')
    httpTestButton?.click()
    const httpTested = await waitFor(() => {
      const text = byText('.w1-caprow', 'HTTP MCP')?.textContent ?? ''
      return text.includes('已连接') && text.includes('http_echo') && text.includes('http_write')
    }, 5000)
    const httpState = await window.ws.capability.mcp.list()
    const httpServer = httpState.find((server) => server.name === 'HTTP MCP')
    check(
      'HTTP 外部 MCP 可测试连接并列出工具',
      httpAdded &&
        httpTested &&
        httpServer?.transport === 'http' &&
        httpServer?.tools.some((tool) => tool.name === 'http_write'),
      byText('.w1-caprow', 'HTTP MCP')?.textContent?.slice(-120) ?? 'missing'
    )

    await waitFor(() => {
      const buttons = [...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])]
      return buttons.length > 0 && buttons.every((button) => !button.disabled)
    }, 3000)
    const firstRemove = [
      ...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '移除')
    firstRemove?.click()
    await waitFor(
      () =>
        [...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])].some(
          (button) => button.textContent === '确认移除'
        ),
      2000
    )
    const confirmRemove = [
      ...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '确认移除')
    confirmRemove?.click()
    const stubRemoved = await waitFor(() => !byText('.w1-caprow', 'Stub MCP'), 3000)
    const remainingMcp = await window.ws.capability.mcp.list()
    check(
      '自定义 MCP 可移除且不残留',
      stubRemoved &&
        remainingMcp.length === 2 &&
        remainingMcp.some((server) => server.catalogId === 'memory') &&
        remainingMcp.some(
          (server) => server.name === 'HTTP MCP' && server.transport === 'http'
        ),
      JSON.stringify(remainingMcp.map((server) => [server.name, server.transport]))
    )

    byText('.w1-caphead .w1-capmini.pri', '自定义 Server')?.click()
    await waitFor(() => !!one('.w1-capform'), 2000)
    setValue(one('input[aria-label="MCP 名称"]'), 'Codex Only')
    setValue(one('select[aria-label="MCP 归属的 Agent"]'), 'codex')
    await sleep(120)
    setValue(one('input[aria-label="MCP 命令"]'), 'node')
    setValue(one('textarea[aria-label="MCP 参数"]'), window.__WS_MCP_STUB__)
    byText('.w1-capform .w1-capmini.pri', '添加 Server')?.click()
    const codexOnlyAdded = await waitFor(() => Boolean(byText('.w1-caprow', 'Codex Only')), 4000)
    const codexOnlyState = await window.ws.capability.mcp.list()
    const codexOnly = codexOnlyState.find((server) => server.name === 'Codex Only')
    check(
      '外部 MCP 可限定为单一 Agent',
      codexOnlyAdded &&
        codexOnly?.targets === 'codex' &&
        (byText('.w1-caprow', 'Codex Only')?.textContent ?? '').includes('仅 Codex'),
      JSON.stringify(codexOnly?.targets ?? 'missing')
    )

    const codexOnlyRemove = [
      ...(byText('.w1-caprow', 'Codex Only')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '移除')
    codexOnlyRemove?.click()
    await waitFor(
      () =>
        [...(byText('.w1-caprow', 'Codex Only')?.querySelectorAll('.w1-capmini') ?? [])].some(
          (button) => button.textContent === '确认移除'
        ),
      2000
    )
    ;[
      ...(byText('.w1-caprow', 'Codex Only')?.querySelectorAll('.w1-capmini') ?? [])
    ]
      .find((button) => button.textContent === '确认移除')
      ?.click()
    await waitFor(() => !byText('.w1-caprow', 'Codex Only'), 3000)

    byText('.w1-capnav button', '插件')?.click()
    await sleep(250)
    // 插件源与更新检查：走主进程真实服务，不联网
    const pluginSourcesBefore = await window.ws.capability.pluginSources()
    check(
      '插件源接口可用',
      Array.isArray(pluginSourcesBefore),
      String(pluginSourcesBefore.length)
    )
    const localScan = await window.ws.capability.scanLocalPlugins()
    const claudeScan = localScan.find((item) => item.agent === 'claude')
    const codexScan = localScan.find((item) => item.agent === 'codex')
    check(
      '本机插件扫描读到两个 Agent 的市场与插件',
      localScan.length === 2 &&
        claudeScan?.detected === true &&
        claudeScan.marketplaces.some((item) => item.name === 'smoke-market') &&
        claudeScan.plugins.some((item) => item.id === 'smoke-plugin@smoke-market') &&
        codexScan?.detected === true &&
        codexScan.marketplaces.some((item) => item.name === 'smoke-market') &&
        codexScan.plugins.some((item) => item.id === 'smoke-plugin@smoke-market'),
      JSON.stringify({
        claude: [claudeScan?.marketplaces.length, claudeScan?.plugins.length],
        codex: [codexScan?.marketplaces.length, codexScan?.plugins.length]
      })
    )


    // 更新横幅：注册一个版本更高的本地源，让真实候选出现并走完整 UI
    await window.ws.capability.addPluginSource({
      name: 'smoke-update',
      url: window.__WS_UPDATE_SOURCE__
    })
    const detected = await window.ws.capability.checkUpdates()
    check(
      '启动更新检查产出真实候选',
      detected.some((item) => item.name === 'demo-skill' && item.latest === '1.2.0'),
      JSON.stringify(detected)
    )

    byText('.w1-capnav button', '插件')?.click()
    await sleep(200)
    const banner = await waitFor(() => Boolean(one('.w1-capupdate')), 3000)
    const applyButton = byText('.w1-capupdate .w1-capmini', '全部更新')
    check(
      '更新横幅出现「全部更新」按钮',
      banner && Boolean(applyButton),
      one('.w1-capupdate')?.textContent?.slice(0, 120) ?? 'missing'
    )

    // 批量更新：成功与失败要各自独立，失败项带原因且不拖垮其它条目
    const updateSkill = (await window.ws.capability.skills.list()).find(
      (item) => item.name === 'demo-skill'
    )
    const updateOutcome = await window.ws.capability.applyUpdates([
      {
        kind: 'plugin',
        id: updateSkill?.id ?? 'demo-skill@wsfo-official',
        name: 'demo-skill',
        agent: 'claude',
        current: '1.0.0',
        latest: '1.1.0'
      },
      {
        kind: 'mcp',
        id: 'missing-server',
        name: 'Missing',
        current: '0.0.1',
        latest: '0.0.2'
      }
    ])
    const updatedSkill = (await window.ws.capability.skills.list()).find(
      (item) => item.name === 'demo-skill'
    )
    check(
      '批量更新分发到插件并写入新版本',
      updateOutcome.updated.some((item) => item.name === 'demo-skill') &&
        updatedSkill?.version === '1.1.0',
      JSON.stringify({ updated: updateOutcome.updated, version: updatedSkill?.version })
    )
    check(
      '单条更新失败不影响其它条目',
      updateOutcome.failed.length === 1 &&
        updateOutcome.failed[0].id === 'missing-server' &&
        Boolean(updateOutcome.failed[0].reason),
      JSON.stringify(updateOutcome.failed)
    )

    // 数据桥与能力中心解耦：11 个数据工具在基础设置里断言
    byText('.w1-settabs button', '基础')?.click()
    await waitFor(() => all('.w1-caprow.builtin').length === 11, 3000)

    check(
      '基础设置数据桥展示 11 个数据工具',
      all('.w1-caprow.builtin').length === 11 &&
        (one('.w1-setpane')?.textContent ?? '').includes('tasks_list') &&
        (one('.w1-setpane')?.textContent ?? '').includes('notes_create'),
      String(all('.w1-caprow.builtin').length)
    )

    // 内置工具开关：关闭后桥不再列出该工具，重新打开恢复
    byText('.w1-caprow', 'notes_create')?.querySelector('.w1-setbtn')?.click()
    const toolOff = await waitFor(async () => {
      const list = await window.ws.capability.builtinTools()
      if (list.find((tool) => tool.name === 'notes_create')?.enabled !== false) return false
      // IPC 返回与 React 重渲染是两条路径，等行本身也变成关闭态再判定
      return (byText('.w1-caprow', 'notes_create')?.className ?? '').includes('off')
    }, 3000)
    check(
      '内置工具可单独关闭',
      toolOff,
      byText('.w1-caprow', 'notes_create')?.className ?? 'missing'
    )
    byText('.w1-caprow', 'notes_create')?.querySelector('.w1-setbtn')?.click()
    const toolOn = await waitFor(async () => {
      const list = await window.ws.capability.builtinTools()
      if (list.find((tool) => tool.name === 'notes_create')?.enabled !== true) return false
      return !(byText('.w1-caprow', 'notes_create')?.className ?? '').includes('off')
    }, 3000)
    check(
      '内置工具可重新启用',
      toolOn,
      byText('.w1-caprow', 'notes_create')?.className ?? 'missing'
    )

    // MCP 页反馈：未启用的 Server 点 ☆、跨首选组的 ↑↓ 都要有可见说明，不能静默无反应
    await window.ws.capability.mcp.add({
      name: '未启用 MCP',
      transport: 'http',
      url: 'http://127.0.0.1:9/mcp',
      auth: 'headers',
      headers: {}
    })
    // 能力中心读的是面板挂载时的快照；从基础切回来让它重新读库
    byText('.w1-settabs button', '能力中心')?.click()
    await waitFor(() => !!one('.w1-cap'), 3000)
    byText('.w1-capnav button', 'MCP')?.click()
    await waitFor(() => Boolean(byText('.w1-caprow', '未启用 MCP')), 3000)

    // 内置工具页：按 Agent 切换原生开关，落库后进入下一次会话的注入参数
    const surfaceInitial = await window.ws.capability.toolSurface()
    check(
      '工具面按 Agent 返回原生 / MCP / 技能 / 数据桥',
      surfaceInitial.claude.native.length >= 4 &&
        surfaceInitial.codex.native.some((tool) => tool.id === 'computer-use') &&
        surfaceInitial.claude.builtin.length === 11 &&
        surfaceInitial.claude.mcp.some((server) => server.name === 'HTTP MCP') &&
        surfaceInitial.claude.skills.some((skill) => skill.enabled),
      JSON.stringify({
        native: surfaceInitial.claude.native.length,
        mcp: surfaceInitial.claude.mcp.length,
        skills: surfaceInitial.claude.skills.length
      })
    )
    byText('.w1-capnav button', '内置工具')?.click()
    await waitFor(() => Boolean(byText('.w1-caprow', '访问网络')), 3000)
    // 环境自检要 spawn 六次 --version，机器繁忙时返回慢；等它落盘再断言，不要立刻读 DOM
    const envReady = await waitFor(() => all('.w1-capenvitem').length === 6, 15000)
    check(
      '内置工具页环境自检显示本机命令',
      envReady && (one('.w1-capenv')?.textContent ?? '').includes('node'),
      String(all('.w1-capenvitem').length) +
        ' · ' +
        (one('.w1-capenv')?.textContent?.slice(0, 80) ?? 'missing')
    )
    const nativeText = one('.w1-cap')?.textContent ?? ''
    check(
      'Claude 原生目录覆盖问答技能计划场景',
      nativeText.includes('交互问答') &&
        nativeText.includes('技能加载') &&
        nativeText.includes('计划模式'),
      nativeText.slice(0, 120)
    )
    const claudeWebRow = byText('.w1-caprow', '访问网络')
    claudeWebRow?.querySelector('.w1-setbtn')?.click()
    const claudeWebOff = await waitFor(async () => {
      const bundle = await window.ws.capability.toolSurface()
      return (
        bundle.claude.native.find((tool) => tool.id === 'web')?.enabled === false &&
        (byText('.w1-caprow', '访问网络')?.className ?? '').includes('off')
      )
    }, 3000)
    check(
      'Claude 原生工具可关闭并落库',
      claudeWebOff,
      byText('.w1-caprow', '访问网络')?.className ?? 'missing'
    )

    // 首选：MCP 页 ☆ → ★ 落库、置顶；注入预览在内置工具页
    byText('.w1-capnav button', 'MCP')?.click()
    await waitFor(() => Boolean(byText('.w1-caprow', 'HTTP MCP')), 3000)
    const httpRow = byText('.w1-caprow', 'HTTP MCP')
    httpRow?.querySelector('.w1-capprefbtn')?.click()
    const preferredSaved = await waitFor(async () => {
      const bundle = await window.ws.capability.toolSurface()
      const top = bundle.claude.mcp[0]
      return (
        bundle.claude.mcp.find((server) => server.name === 'HTTP MCP')?.preferred === true &&
        top?.name === 'HTTP MCP' &&
        (byText('.w1-caprow', 'HTTP MCP')?.querySelector('.w1-capprefbtn')?.textContent ?? '') ===
          '★'
      )
    }, 3000)
    byText('.w1-capnav button', '内置工具')?.click()
    const capPreviewReady = await waitFor(() => Boolean(one('.w1-capprompt')), 3000)
    const promptPreview = one('.w1-capprompt')?.textContent ?? ''
    check(
      '首选落库并置顶，注入文本单独成组',
      preferredSaved &&
        capPreviewReady &&
        promptPreview.includes('首选：HTTP MCP') &&
        promptPreview.includes('CLI 原生工具'),
      promptPreview.slice(0, 160)
    )

    // 用途说明：MCP 页首选行出现输入框，失焦保存后进入内置工具页的注入预览
    byText('.w1-capnav button', 'MCP')?.click()
    await sleep(250)
    const findNoteInput = () =>
      [...document.querySelectorAll('.w1-capnoteedit input')].find((input) =>
        (input.closest('.w1-caprow')?.textContent ?? '').includes('HTTP MCP')
      )
    const fillNote = async () => {
      const input = findNoteInput()
      if (!input) return ''
      input.focus()
      input.value = '需要窗口截图时先调用'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(60)
      const live = findNoteInput() ?? input
      live.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      return live.value
    }
    const noteReady = await waitFor(() => Boolean(findNoteInput()), 3000)
    // 首选刚触发过一次 surface 重渲染；等它提交完再输入，避免撞上节点替换
    if (noteReady) await sleep(250)
    let noteSaved = false
    let noteDraft = ''
    for (let attempt = 0; attempt < 2 && !noteSaved; attempt += 1) {
      noteDraft = await fillNote()
      noteSaved = await waitFor(async () => {
        const bundle = await window.ws.capability.toolSurface()
        const server = bundle.claude.mcp.find((item) => item.name === 'HTTP MCP')
        return server?.note === '需要窗口截图时先调用'
      }, 2500)
    }
    byText('.w1-capnav button', '内置工具')?.click()
    const notePreview = await waitFor(
      () => (one('.w1-capprompt')?.textContent ?? '').includes('用途：需要窗口截图时先调用'),
      3000
    )
    check(
      '首选用途说明落库并进入注入文本',
      noteReady && noteSaved && notePreview,
      String(noteReady) +
        '/' +
        String(noteDraft) +
        ' | ' +
        (one('.w1-capprompt')?.textContent ?? 'missing').slice(0, 180)
    )

    // 未启用：☆ 仍可点击，点击后说明原因（禁用按钮不会显示 title）
    byText('.w1-capnav button', 'MCP')?.click()
    await waitFor(() => Boolean(byText('.w1-caprow', '未启用 MCP')), 3000)
    const disabledRow = byText('.w1-caprow', '未启用 MCP')
    const disabledStar = disabledRow?.querySelector('.w1-capprefbtn')
    const starClickable =
      Boolean(disabledStar) &&
      disabledStar.disabled === false &&
      disabledStar.getAttribute('aria-disabled') === 'true'
    disabledStar?.click()
    const starBlocked = await waitFor(
      () => (one('.w1-toast')?.textContent ?? '').includes('先启用并信任'),
      2000
    )
    // 设置页开着时 toast 不能被遮罩盖住：用命中测试确认它真的在可见层
    const toastHit = (() => {
      const toast = one('.w1-toast')
      if (!toast) return false
      const rect = toast.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return Boolean(hit && (hit === toast || toast.contains(hit)))
    })()
    check(
      '未启用的 MCP 点 ☆ 会说明原因',
      starClickable && starBlocked && toastHit,
      String(starClickable) + ' / ' + (one('.w1-toast')?.textContent ?? 'missing') + ' / 可见 ' + toastHit
    )

    // 首选行与非首选行之间不能换位；↓ 仍可点击，点击后说明原因
    const preferredRow = byText('.w1-caprow', 'HTTP MCP')
    const blockedDown = [...(preferredRow?.querySelectorAll('.w1-capmini') ?? [])].find(
      (button) => button.textContent === '↓'
    )
    const orderBeforeBlocked = (await window.ws.capability.toolSurface()).claude.mcp.map(
      (server) => server.name
    )
    const downClickable = Boolean(blockedDown) && blockedDown.disabled === false
    blockedDown?.click()
    const moveBlocked = await waitFor(
      () => (one('.w1-toast')?.textContent ?? '').includes('首选分组固定置顶'),
      2000
    )
    const orderAfterBlocked = (await window.ws.capability.toolSurface()).claude.mcp.map(
      (server) => server.name
    )
    check(
      '跨首选组的 ↓ 不再静默禁用',
      downClickable && moveBlocked && orderAfterBlocked.join('|') === orderBeforeBlocked.join('|'),
      orderBeforeBlocked.join('|') + ' -> ' + orderAfterBlocked.join('|')
    )
    // 反馈用例的临时 Server 用完即删，后续「落库数量」断言仍按原基线
    const transientMcp = (await window.ws.capability.mcp.list()).find(
      (server) => server.name === '未启用 MCP'
    )
    if (transientMcp) await window.ws.capability.mcp.remove(transientMcp.id)
    // 面板快照还留着已删的 Server；重挂载刷新列表与工具面，再测 Codex 排序
    byText('.w1-settabs button', '基础')?.click()
    await sleep(150)
    byText('.w1-settabs button', '能力中心')?.click()
    await waitFor(() => !!one('.w1-cap'), 3000)
    byText('.w1-capnav button', 'MCP')?.click()
    await sleep(250)

    byText('.w1-capseg button', 'Codex')?.click()
    await sleep(300)
    const mcpOrderBefore = (await window.ws.capability.toolSurface()).codex.mcp.map(
      (server) => server.name
    )
    const codexSurfaceMcp = all('.w1-caprow').find((row) =>
      [...row.querySelectorAll('.w1-capmini')].some(
        (button) => button.textContent === '↓' && !button.disabled
      )
    )
    const downButton = [...(codexSurfaceMcp?.querySelectorAll('.w1-capmini') ?? [])].find(
      (button) => button.textContent === '↓'
    )
    downButton?.click()
    const mcpOrderChanged = await waitFor(async () => {
      const names = (await window.ws.capability.toolSurface()).codex.mcp.map(
        (server) => server.name
      )
      return names.join('|') !== mcpOrderBefore.join('|')
    }, 3000)
    const mcpOrderAfter = (await window.ws.capability.toolSurface()).codex.mcp.map(
      (server) => server.name
    )
    check(
      'MCP 页可调整 Codex 工具顺序',
      mcpOrderChanged && mcpOrderAfter.length === mcpOrderBefore.length,
      mcpOrderBefore.join('|') + ' -> ' + mcpOrderAfter.join('|')
    )

    byText('.w1-capnav button', '内置工具')?.click()
    await waitFor(() => Boolean(byText('.w1-caprow', 'Computer Use')), 2000)
    const alwaysOnRows = all('.w1-caprow.alwayson')
    check(
      'Codex 沙箱工具标常开且不给开关',
      alwaysOnRows.length === 3 &&
        alwaysOnRows.every((row) => !row.querySelector('.w1-setbtn')) &&
        (one('.w1-cap')?.textContent ?? '').includes('read_file'),
      String(alwaysOnRows.length)
    )
    byText('.w1-caprow', 'Computer Use')?.querySelector('.w1-setbtn')?.click()
    const codexComputerOff = await waitFor(async () => {
      const bundle = await window.ws.capability.toolSurface()
      if (bundle.codex.native.find((tool) => tool.id === 'computer-use')?.enabled !== false) {
        return false
      }
      // IPC 回包与 React 重渲染是两条路径，等行本身也变成关闭态
      return (byText('.w1-caprow', 'Computer Use')?.className ?? '').includes('off')
    }, 3000)
    check(
      'Codex 原生工具可关闭',
      codexComputerOff && (byText('.w1-caprow', 'Computer Use')?.className ?? '').includes('off'),
      byText('.w1-caprow', 'Computer Use')?.className ?? 'missing'
    )

    // Codex 也要能标首选，并进入它的 developerInstructions
    const codexFirst = (await window.ws.capability.toolSurface()).codex.mcp.find(
      (server) => server.enabled
    )
    const codexPreferredBundle = codexFirst
      ? await window.ws.capability.setPreferredTool('codex', codexFirst.id, true)
      : null
    if (codexFirst) {
      await window.ws.capability.setToolNote('codex', codexFirst.id, '窗口操作时')
    }
    check(
      'Codex MCP 可设为首选',
      Boolean(codexPreferredBundle) &&
        codexPreferredBundle.codex.mcp[0]?.preferred === true &&
        codexPreferredBundle.codex.mcp[0]?.name === codexFirst.name,
      codexFirst ? codexFirst.name : 'missing'
    )
    if (window.__WS_SMOKE_TOOLS_SHOT__) {
      // 第一张：MCP 页的首选 ★ 与用途说明；第二张：内置工具页的注入预览
      const previousToolsTheme = document.documentElement.dataset.theme
      const previousStoredToolsTheme = localStorage.getItem('workstation.theme')
      if (window.__WS_SMOKE_TOOLS_THEME__ === 'light') {
        document.documentElement.dataset.theme = 'light'
        localStorage.setItem('workstation.theme', 'light')
        await sleep(400)
      }
      byText('.w1-capnav button', 'MCP')?.click()
      byText('.w1-capseg button', 'Claude')?.click()
      await waitFor(() => Boolean(byText('.w1-caprow', 'HTTP MCP')), 3000)
      one('.w1-caphead .w1-capkicker')?.scrollIntoView({ block: 'start' })
      await sleep(500)
      console.log('SMOKE_TOOLS_SHOT')
      await sleep(1200)
      if (window.__WS_SMOKE_TOOLS_SHOT2__) {
        byText('.w1-capnav button', '内置工具')?.click()
        await waitFor(() => Boolean(one('.w1-capprompt')), 3000)
        one('.w1-capprompt')?.scrollIntoView({ block: 'center' })
        await sleep(500)
        console.log('SMOKE_TOOLS_SHOT2')
      }
      await sleep(5000)
      if (window.__WS_SMOKE_TOOLS_THEME__ === 'light') {
        if (previousToolsTheme) document.documentElement.dataset.theme = previousToolsTheme
        else document.documentElement.removeAttribute('data-theme')
        if (previousStoredToolsTheme === null) localStorage.removeItem('workstation.theme')
        else localStorage.setItem('workstation.theme', previousStoredToolsTheme)
        await sleep(300)
      }
    }
    if (window.__WS_SMOKE_REC_SHOT__) {
      const recPrevTheme = document.documentElement.dataset.theme
      const recPrevStored = localStorage.getItem('workstation.theme')
      if (window.__WS_SMOKE_TOOLS_THEME__ === 'light') {
        document.documentElement.dataset.theme = 'light'
        localStorage.setItem('workstation.theme', 'light')
        await sleep(400)
      }
      byText('.w1-capnav button', '推荐')?.click()
      await waitFor(() => all('.w1-caprow.mcp-rec').length === 3, 4000)
      const recPane = document.querySelector('.w1-setpane')
      if (recPane) recPane.scrollTop = 0
      await sleep(500)
      console.log('SMOKE_REC_SHOT')
      await sleep(900)
      if (window.__WS_SMOKE_TOOLS_THEME__ === 'light') {
        if (recPrevTheme) document.documentElement.dataset.theme = recPrevTheme
        else document.documentElement.removeAttribute('data-theme')
        if (recPrevStored === null) localStorage.removeItem('workstation.theme')
        else localStorage.setItem('workstation.theme', recPrevStored)
        await sleep(300)
      }
    }
    byText('.w1-capseg button', 'Claude')?.click()
    await sleep(200)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(() => !one('.w1-settings-sheet'), 2000)

    await navTo('Agent')
    byText('.w1-sess', '测一下多会话回复')?.click()
    await sleep(400)
    const capabilityInput = one('#composer-input')
    setValue(capabilityInput, '能力中心检查')
    await sleep(80)
    capabilityInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const capabilityReply = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('能力中心：插件'),
      3000
    )
    const capabilityText = one('.w1-thread')?.textContent ?? ''
    check(
      '私有插件与 MCP 注入 Claude 会话',
      capabilityReply &&
        capabilityText.includes('claude-plugins') &&
        capabilityText.includes('memory') &&
        capabilityText.includes('workstationforone=http') &&
        capabilityText.includes('http-mcp=http') &&
        capabilityText.includes('审批 mcp__workstationforone__approval_request') &&
        capabilityText.includes('严格 true'),
      capabilityText.slice(-180)
    )
    check(
      '工具面关闭项与优先级提示进入 Claude 会话',
      capabilityText.includes('禁用 ') &&
        capabilityText.includes('WebFetch') &&
        capabilityText.includes('WebSearch') &&
        capabilityText.includes('优先级 有') &&
        capabilityText.includes('首选 首选') &&
        capabilityText.includes('说明 有'),
      capabilityText.slice(-260)
    )

    one('.w1-aworkspacefiles')?.click()
    const workspaceSheet = await waitFor(() => !!one('.w1-wssheet'), 2000)
    const workspaceTree = one('.w1-wstree')?.textContent ?? ''
    check(
      'Agent 工作区文件树可打开',
      workspaceSheet && workspaceTree.includes('smoke-note.txt') && workspaceTree.includes('src'),
      workspaceTree.slice(0, 100)
    )
    byText('.w1-wsfile', 'smoke-note.txt')?.click()
    const workspacePreview = await waitFor(
      () => (one('.w1-wspreview pre')?.textContent ?? '').includes('workspace smoke preview'),
      3000
    )
    check(
      '工作区文件可只读预览',
      workspacePreview,
      one('.w1-wspreview')?.textContent?.slice(0, 100) ?? 'missing'
    )
    one('.w1-wssheet')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    await waitFor(() => !one('.w1-wssheet'), 2000)

    await navTo('Agent')
    byText('.w1-sess', '读一下入口')?.click()
    await sleep(350)
    check(
      'Codex Provider 激活后显示 app-server 审批模式',
      (one('.w1-term')?.textContent ?? '').includes('app-server') &&
        (one('.w1-perms')?.textContent ?? '').includes('写入 需审批'),
      one('.w1-term')?.textContent ?? ''
    )
    const providerLabelShown = await waitFor(
      () => (one('.w1-model')?.textContent ?? '').includes('Smoke Codex Provider'),
      3000
    )
    const providerLabelText = one('.w1-model')?.textContent ?? ''
    check(
      '输入栏显示当前 Provider 与模型',
      providerLabelShown && providerLabelText.includes('smoke-codex-model'),
      providerLabelText || 'missing'
    )
    const codexWriteInput = one('#composer-input')
    setValue(codexWriteInput, '写一个文件')
    await sleep(80)
    codexWriteInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const approvalShown = await waitFor(
      () =>
        (one('.w1-toolperm')?.textContent ?? '').includes('Shell') &&
        (one('.w1-toolperm')?.textContent ?? '').includes('Set-Content'),
      5000
    )
    check(
      'Codex 工作区审批卡出现',
      approvalShown,
      one('.w1-toolperm')?.textContent?.slice(0, 140) ?? 'missing'
    )
    check(
      'Codex 敏感工具卡没有此工作区允许',
      approvalShown && !(one('.w1-toolperm')?.textContent ?? '').includes('此工作区允许'),
      one('.w1-toolperm')?.textContent?.slice(0, 140) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '本会话允许')?.click()
    const codexWriteDone = await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('已允许写入。'),
      6000
    )
    check(
      'Codex 本会话允许后继续本轮',
      codexWriteDone &&
        (all('.w1-amsg').at(-1)?.textContent ?? '').includes('已允许写入。'),
      all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing'
    )

    const codexRepeatInput = one('#composer-input')
    const codexBefore = all('.w1-amsg').length
    await waitFor(() => !one('.w1-typing'), 6000)
    setValue(codexRepeatInput, '写一个文件')
    await sleep(80)
    codexRepeatInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const codexRepeatDone = await waitFor(
      () =>
        all('.w1-amsg').length > codexBefore &&
        (all('.w1-amsg').at(-1)?.textContent ?? '').includes('已允许写入。') &&
        !one('.w1-toolperm'),
      5000
    )
    check('Codex Shell 会话规则命中后无卡', codexRepeatDone, all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing')

    const codexPermInput = one('#composer-input')
    await waitFor(() => !one('.w1-typing'), 6000)
    setValue(codexPermInput, '额外权限')
    await sleep(80)
    codexPermInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const codexPermCard = await waitFor(
      () => (one('.w1-toolperm')?.textContent ?? '').includes('Permissions'),
      5000
    )
    check(
      'Codex Permissions 卡没有此工作区允许',
      codexPermCard && !(one('.w1-toolperm')?.textContent ?? '').includes('此工作区允许'),
      one('.w1-toolperm')?.textContent?.slice(0, 140) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '允许一次')?.click()
    await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('已授予额外权限'),
      5000
    )

    // Codex 的 request_user_input 走同一张问题卡，答案按问题 id 回写
    const codexQuestionInput = one('#composer-input')
    await waitFor(() => !one('.w1-typing'), 6000)
    setValue(codexQuestionInput, '提问检查')
    await sleep(80)
    codexQuestionInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const codexQuestionCard = await waitFor(
      () => (one('.w1-question')?.textContent ?? '').includes('你喜欢猫还是狗？'),
      5000
    )
    const codexQuestionOpt = all('.w1-question .w1-qopt').find((button) =>
      (button.textContent ?? '').includes('狗')
    )
    codexQuestionOpt?.click()
    await sleep(200)
    byText('.w1-question button', '提交回答')?.click()
    const codexQuestionDone = await waitFor(
      () => !one('.w1-question') && (one('.w1-thread')?.textContent ?? '').includes('提问答案：狗'),
      6000
    )
    check(
      'Codex 提问卡可作答并回写',
      codexQuestionCard && Boolean(codexQuestionOpt) && codexQuestionDone,
      one('.w1-thread')?.textContent?.slice(-140) ?? 'missing'
    )

    const codexMcpInput = one('#composer-input')
    await waitFor(() => !one('.w1-typing'), 6000)
    setValue(codexMcpInput, 'MCP 写入')
    await sleep(80)
    codexMcpInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const mcpApproval = await waitFor(
      () =>
        (one('.w1-toolperm')?.textContent ?? '').includes(
          'MCP · workstationforone/tasks_create'
        ),
      5000
    )
    check(
      'Codex MCP 工具进入审批卡',
      mcpApproval,
      one('.w1-toolperm')?.textContent?.slice(0, 180) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '此工作区允许')?.click()
    const mcpAllowed = await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('已允许 MCP 调用。'),
      6000
    )
    check(
      'Codex MCP 允许后继续',
      mcpAllowed,
      all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing'
    )

    const codexMcpRepeat = one('#composer-input')
    const codexMcpBefore = all('.w1-amsg').length
    await waitFor(() => !one('.w1-typing'), 6000)
    setValue(codexMcpRepeat, 'MCP 写入')
    await sleep(80)
    codexMcpRepeat.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const codexMcpRepeatDone = await waitFor(
      () =>
        all('.w1-amsg').length > codexMcpBefore &&
        (all('.w1-amsg').at(-1)?.textContent ?? '').includes('已允许 MCP 调用。') &&
        !one('.w1-toolperm'),
      5000
    )
    check(
      'Codex MCP 工作区规则命中后无卡',
      codexMcpRepeatDone,
      all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing'
    )

    // 工具面：原生关闭项变成 app-server 进程参数，优先级提示进入 developerInstructions
    const codexSurfaceInput = one('#composer-input')
    await waitFor(() => !one('.w1-typing'), 6000)
    setValue(codexSurfaceInput, '工具面检查')
    await sleep(80)
    codexSurfaceInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const codexSurfaceReply = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('工具面：') && !one('.w1-typing'),
      6000
    )
    await sleep(200)
    const codexSurfaceText = all('.w1-amsg').at(-1)?.textContent ?? ''
    check(
      'Codex 工具面关闭项进入进程参数与优先级提示',
      codexSurfaceReply &&
        codexSurfaceText.includes('features.computer_use=false') &&
        codexSurfaceText.includes('优先级 有') &&
        codexSurfaceText.includes('首选 有') &&
        codexSurfaceText.includes('说明 有'),
      codexSurfaceText.slice(-200)
    )

    one('.w1-settings')?.click()
    await waitFor(() => !!one('.w1-settings-sheet'), 2000)
    const codexRuleShown = await waitFor(
      () => (one('.w1-setrules')?.textContent ?? '').includes('MCP · workstationforone/tasks_create'),
      2000
    )
    check('Codex 审批规则出现在设置', codexRuleShown, one('.w1-setrules')?.textContent?.slice(0, 120) ?? 'missing')
    byText('.w1-setrule .w1-setbtn', '撤销')?.click()
    await waitFor(
      () => !(one('.w1-setrules')?.textContent ?? '').includes('MCP · workstationforone/tasks_create'),
      2000
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(() => !one('.w1-settings-sheet'), 2000)

    one('.w1-settings')?.click()
    await waitFor(() => !!one('.w1-settings-sheet'), 2000)
    byText('.w1-provseg button', 'Codex CLI')?.click()
    await sleep(200)
    byText('.w1-provseg button', '继承 Codex CLI')?.click()
    await sleep(400)
    check(
      'Codex Provider 可切回继承 CLI',
      one('[aria-label="Provider 模式"] button.on')?.textContent?.includes(
        '继承 Codex CLI'
      ) === true,
      one('[aria-label="Provider 模式"] button.on')?.textContent ?? ''
    )

    const themeBtnBefore = document.documentElement.dataset.theme
    const themeBtns = all('.w1-setbtn')
    themeBtns[0]?.click()
    await sleep(500)
    const themeBtnAfter = document.documentElement.dataset.theme
    check('设置里可切换主题', themeBtnBefore !== themeBtnAfter, themeBtnBefore + ' -> ' + themeBtnAfter)
    all('.w1-setbtn')[0]?.click()
    await sleep(500)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(() => !one('.w1-settings-sheet'), 2000)
    check('Esc 关闭设置面板', !one('.w1-settings-sheet'))
    await navTo('今日')

    const habitCard = all('.w1-card').find((card) => card.textContent?.includes('习惯打卡'))
    const habitBefore = habitCard?.querySelector('.w1-ct span')?.textContent ?? ''
    one('.w1-hdot.today:not(.on)')?.click()
    await sleep(250)
    const habitAfter = habitCard?.querySelector('.w1-ct span')?.textContent ?? ''
    const habitCount = (text) => Number.parseInt(text, 10)
    check(
      '今日习惯可打卡',
      habitCount(habitAfter) === habitCount(habitBefore) + 1,
      habitBefore + ' -> ' + habitAfter
    )
    const habitKey = new Date().toLocaleDateString('sv-SE')
    const storedHabits = await window.ws.habits.list()
    const habitStored = {
      total: storedHabits.length,
      checkedToday: storedHabits.filter((habit) => habit.checkins.includes(habitKey)).length
    }
    check(
      '习惯行显示连续天数',
      all('.w1-hstreak').length >= 1 &&
        all('.w1-hstreak').every((el) => /^[0-9]+$/.test(el.textContent?.trim() ?? '')),
      all('.w1-hstreak')
        .map((el) => el.textContent?.trim())
        .join(',')
    )
    check(
      '习惯打卡已落库',
      habitStored?.total > 0 && habitStored?.checkedToday >= 1,
      JSON.stringify(habitStored)
    )

    const todayDot = one('.w1-hdot.today')
    const todayDots = todayDot ? [...todayDot.parentElement.querySelectorAll('.w1-hdot')] : []
    const todayDotIndex = todayDot ? todayDots.indexOf(todayDot) : -1
    if (todayDotIndex > 0) {
      const previousKey = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE')
      const previousCount = async () =>
        (await window.ws.habits.list()).filter((habit) => habit.checkins.includes(previousKey))
          .length
      const beforeBackfill = await previousCount()
      todayDots[todayDotIndex - 1]?.click()
      const backfilled = await waitFor(async () => Math.abs((await previousCount()) - beforeBackfill) === 1, 2000)
      check('过去日期可补打卡', backfilled, String(beforeBackfill))
      const currentTodayDot = one('.w1-hdot.today')
      const rowDots = currentTodayDot
        ? [...currentTodayDot.closest('.w1-hrow').querySelectorAll('.w1-hdot')]
        : []
      rowDots[todayDotIndex - 1]?.click()
      const revertBackfill = await waitFor(async () => (await previousCount()) === beforeBackfill, 2000)
      check('补打卡可再次取消', revertBackfill, String(beforeBackfill))
    } else {
      check('过去日期可补打卡', true, '周一没有过去日期，跳过')
      check('补打卡可再次取消', true, '周一没有过去日期，跳过')
    }

    one('.w1-hmanage[aria-label="管理习惯"]')?.click()
    await waitFor(() => Boolean(one('.w1-habitmanage')), 2000)
    const habitAddInput = one('.w1-habitmanage-add input')
    setValue(habitAddInput, '冒烟习惯')
    await waitFor(() => one('.w1-habitmanage-addbtn')?.disabled === false, 1000)
    one('.w1-habitmanage-addbtn')?.click()
    const habitAdded = await waitFor(async () => {
      const habits = await window.ws.habits.list()
      return Boolean(habits.find((habit) => habit.name === '冒烟习惯'))
    }, 2500)
    check('习惯可新增并落库', habitAdded, '')
    const habitRow = all('.w1-habitmanage-row').find(
      (row) => row.querySelector('input')?.value === '冒烟习惯'
    )
    const habitNameInput = habitRow?.querySelector('input')
    if (!habitNameInput) throw new Error('习惯新增行未出现')
    setValue(habitNameInput, '冒烟习惯改名')
    await sleep(80)
    habitNameInput?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const habitRenamed = await waitFor(async () => {
      const habits = await window.ws.habits.list()
      return Boolean(habits.find((habit) => habit.name === '冒烟习惯改名'))
    }, 2500)
    check('习惯可改名并落库', habitRenamed, '')
    const renameRow = all('.w1-habitmanage-row').find(
      (row) => row.querySelector('input')?.value === '冒烟习惯改名'
    )
    renameRow?.querySelector('.w1-habitmanage-del')?.click()
    const deleteHabitArmed = await waitFor(
      () =>
        renameRow?.querySelector('.w1-habitmanage-del')?.textContent?.includes('确认删除') === true,
      1500
    )
    check('习惯删除需要二次确认', deleteHabitArmed, '')
    renameRow?.querySelector('.w1-habitmanage-del')?.click()
    const habitRemoved = await waitFor(async () => {
      const habits = await window.ws.habits.list()
      return !habits.some((habit) => habit.name === '冒烟习惯改名')
    }, 2500)
    check('习惯可删除并落库', habitRemoved, '')
    one('.w1-habitmanage .w1-modalx')?.click()
    await waitFor(() => !one('.w1-habitmanage'), 2000)
    check('习惯管理面板可关闭', !one('.w1-habitmanage'))

    one('.w1-hmanage[aria-label="习惯统计"]')?.click()
    const habitStatsOpen = await waitFor(() => Boolean(one('.w1-hstats')), 2000)
    const habitStatsFocused = await waitFor(
      () => document.activeElement === one('.w1-hstats'),
      1200
    )
    check(
      '习惯统计面板可打开',
      habitStatsOpen && habitStatsFocused,
      document.activeElement?.className ?? ''
    )
    const habitStatRows = all('.w1-hstatrow')
    const habitStatRow =
      habitStatRows.find((row) => row.textContent?.includes('早起 07:30')) ?? habitStatRows[0]
    const habitStatText = habitStatRow?.textContent ?? ''
    check(
      '习惯统计显示连续、完成率与 26 周网格',
      habitStatRows.length >= 1 &&
        habitStatRow?.querySelectorAll('.w1-hstatcell').length === 182 &&
        habitStatText.includes('当前') &&
        habitStatText.includes('近 30 天') &&
        habitStatText.includes('累计') &&
        habitStatRows.some((row) => row.querySelectorAll('.w1-hstatcell.on').length > 0),
      String(habitStatRows.length) + ' | ' + habitStatText.slice(0, 70)
    )
    if (window.__WS_SMOKE_HABIT_SHOT__) {
      const previousTheme = document.documentElement.dataset.theme
      const previousStoredTheme = localStorage.getItem('workstation.theme')
      if (window.__WS_SMOKE_HABIT_THEME__ === 'light') {
        document.documentElement.dataset.theme = 'light'
        localStorage.setItem('workstation.theme', 'light')
        await sleep(400)
      }
      console.log('SMOKE_HABIT_SHOT')
      await sleep(1200)
      if (window.__WS_SMOKE_HABIT_THEME__ === 'light') {
        if (previousTheme) document.documentElement.dataset.theme = previousTheme
        else document.documentElement.removeAttribute('data-theme')
        if (previousStoredTheme === null) localStorage.removeItem('workstation.theme')
        else localStorage.setItem('workstation.theme', previousStoredTheme)
        await sleep(300)
      }
    }
    one('.w1-hstats .w1-modalx')?.click()
    const habitStatsClosed = await waitFor(() => !one('.w1-hstats'), 2000)
    const habitStatsFocusBack = await waitFor(
      () => document.activeElement?.getAttribute('aria-label') === '习惯统计',
      2000
    )
    check(
      '习惯统计关闭后焦点回到入口',
      habitStatsClosed && habitStatsFocusBack,
      document.activeElement?.textContent ?? ''
    )
    one('.w1-hmanage[aria-label="习惯统计"]')?.click()
    await waitFor(() => Boolean(one('.w1-hstats')), 2000)
    one('.w1-hstats')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    const habitStatsEsc = await waitFor(() => !one('.w1-hstats'), 2000)
    check('习惯统计 Esc 可关闭', habitStatsEsc, String(habitStatsEsc))

    byText('.w1-btn', '快速笔记')?.click()
    await sleep(350)
    check('快速笔记弹窗', !!one('.w1-modal'))
    const textarea = one('.w1-noteinput')
    setValue(textarea, '来自自动化冒烟测试的笔记')
    await sleep(80)
    byText('.w1-modalacts .w1-pb', '保存笔记')?.click()
    await waitFor(() => !one('.w1-modal'), 2000)
    check('笔记弹窗关闭', !one('.w1-modal'))
    check('笔记写入列表', one('.w1-nlist')?.textContent?.includes('来自自动化冒烟测试的笔记'), one('.w1-nlist')?.textContent ?? '')

    byText('.w1-btn', '开始专注')?.click()
    await sleep(400)
    check('专注模式打开', !!one('.w1-focus'))
    one('.w1-focus .w1-pb.pri')?.click()
    await waitFor(() => !one('.w1-focus'), 2000)
    check('专注模式关闭', !one('.w1-focus'))

    byText('.w1-tlblk', '深度工作')?.click()
    await sleep(400)
    check(
      '时间块可开始专注',
      one('.w1-focus')?.textContent?.includes('深度工作 · 10:30'),
      one('.w1-focus')?.textContent?.slice(0, 60) ?? ''
    )
    one('.w1-focus .w1-pb.pri')?.click()
    await waitFor(() => !one('.w1-focus'), 2000)
    check('时间块专注可关闭', !one('.w1-focus'))

    one('.w1-motion')?.click()
    await sleep(150)
    check('动效可暂停', one('.w1')?.classList.contains('motion-off'))
    one('.w1-motion')?.click()
    await sleep(150)
    check('动效可恢复', !one('.w1')?.classList.contains('motion-off'))
    one('.w1-motion')?.focus()

    await openPalette()
    check('Ctrl K 打开命令面板', !!one('.w1-palette'))
    check(
      '命令面板输入自动聚焦',
      document.activeElement?.classList.contains('w1-paletteinput'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    const paletteInput = one('.w1-paletteinput')
    setValue(paletteInput, '多会话')
    await sleep(300)
    const selectedSession = one('.w1-paletteitem[data-selected="true"]')?.textContent ?? ''
    check(
      '搜索命中会话时优先会话',
      selectedSession.includes('测一下多会话回复') && !selectedSession.includes('发送给'),
      selectedSession
    )
    paletteInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () =>
        !one('.w1-palette') &&
        activeNav() === 'Agent' &&
        (one('.w1-tdiv')?.textContent ?? '').includes('测一下多会话回复'),
      2500
    )
    check(
      '命令面板跳转会话并切换视图',
      !one('.w1-palette') && activeNav() === 'Agent' && one('.w1-tdiv')?.textContent?.includes('测一下多会话回复'),
      activeNav() + ' · ' + (one('.w1-tdiv')?.textContent ?? '')
    )
    check(
      '命令面板关闭后焦点归位',
      document.activeElement?.classList.contains('w1-motion'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    await navTo('今日')
    one('.w1-motion')?.focus()
    await openPalette()
    const filterInput = one('.w1-paletteinput')
    setValue(filterInput, '待办')
    await sleep(300)
    const selectedFilter = one('.w1-paletteitem[data-selected="true"]')?.textContent ?? ''
    check(
      '搜索命中操作时优先操作',
      selectedFilter.includes('待办') && !selectedFilter.includes('发送给'),
      selectedFilter
    )
    filterInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(700)
    check(
      '命令面板可执行筛选',
      all('.w1-task').length > 0 && all('.w1-task').every((el) => !el.classList.contains('done')),
      String(all('.w1-task').length)
    )
    byText('.w1-filter', '全部')?.click()
    await sleep(250)
    check(
      '筛选恢复全部',
      all('.w1-task').some((el) => el.classList.contains('done')),
      String(all('.w1-task').length)
    )
    one('.w1-motion')?.focus()

    await openPalette()
    const viewInput = one('.w1-paletteinput')
    setValue(viewInput, '打开全部笔记')
    await sleep(300)
    viewInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () => !one('.w1-palette') && activeNav() === '笔记' && !!one('.w1-notesview'),
      2500
    )
    check(
      '命令面板可切换工作区',
      !one('.w1-palette') && activeNav() === '笔记' && !!one('.w1-notesview'),
      activeNav()
    )
    check('笔记页是独立工作区', !one('.w1-dock') && !one('.w1-main'))

    const noteSearch = one('.w1-nvinput')
    if (!noteSearch) {
      throw new Error(JSON.stringify({
        noteView: !!one('.w1-notesview'),
        noteInputs: all('.w1-nvsearch input').length,
        stage: one('.w1-stage')?.textContent?.slice(0, 200) ?? '',
        active: one('.w1-navitem.on')?.textContent ?? ''
      }))
    }
    setValue(noteSearch, '线代')
    await sleep(400)
    check('笔记页可搜索', one('.w1-nvlist')?.textContent?.includes('线代'), one('.w1-nvlist')?.textContent?.slice(0, 60) ?? '')
    noteSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(400)
    check(
      'Esc 清空搜索但不离开笔记页',
      noteSearch.value === '' && activeNav() === '笔记' && all('.w1-nvrow').length >= 4,
      noteSearch.value + '|' + activeNav()
    )
    setValue(noteSearch, '线代')
    await sleep(400)
    one('.w1-nvclear')?.click()
    await sleep(400)
    check('清空搜索恢复列表', all('.w1-nvrow').length >= 4, String(all('.w1-nvrow').length))
    const tagBarReady = await waitFor(() => all('.w1-nvfilter').length >= 2, 2500)
    check('笔记标签筛选条可见', tagBarReady, String(all('.w1-nvfilter').length))
    byText('.w1-nvfilter', '产品思考')?.click()
    const tagFiltered = await waitFor(() => all('.w1-nvrow').length === 1, 2500)
    check(
      '按标签筛选笔记',
      tagFiltered && (one('.w1-nvrow')?.textContent ?? '').includes('工作台'),
      one('.w1-nvrow')?.textContent?.slice(0, 60) ?? 'missing'
    )
    byText('.w1-nvfilter', '全部')?.click()
    const tagCleared = await waitFor(() => all('.w1-nvrow').length >= 4, 2500)
    check('清除标签筛选恢复列表', tagCleared, String(all('.w1-nvrow').length))

    const pinTarget = all('.w1-nvrow').find((row) => !row.querySelector('.w1-nvpin'))
    const pinText = pinTarget?.querySelector('.w1-nvtext')?.textContent ?? ''
    pinTarget?.querySelector('.w1-nvrowpin')?.click()
    const pinnedFirst = await waitFor(
      () =>
        Boolean(pinText) &&
        all('.w1-nvrow')[0]?.querySelector('.w1-nvtext')?.textContent === pinText &&
        all('.w1-nvrow')[0]?.querySelector('.w1-nvrowpin')?.getAttribute('aria-pressed') ===
          'true',
      3000
    )
    check('笔记可置顶并排到最前', pinnedFirst, pinText || 'missing')
    await waitFor(
      () => {
        const button = all('.w1-nvrow')[0]?.querySelector('.w1-nvrowpin')
        return Boolean(button) && button.disabled === false
      },
      3000
    )
    all('.w1-nvrow')[0]?.querySelector('.w1-nvrowpin')?.click()
    const noteUnpinned = await waitFor(
      () => {
        const row = all('.w1-nvrow').find(
          (item) => item.querySelector('.w1-nvtext')?.textContent === pinText
        )
        return row?.querySelector('.w1-nvrowpin')?.getAttribute('aria-pressed') === 'false'
      },
      3000
    )
    check('笔记可取消置顶', noteUnpinned, '')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(400)
    check('Esc 不关闭笔记工作区', activeNav() === '笔记' && !!one('.w1-notesview'), activeNav())

    await window.ws.notes.create('冒烟图谱目标', '冒烟标签')
    await window.ws.notes.create('冒烟图谱来源 [[冒烟图谱目标]]', '冒烟标签')
    one('.w1-nvgraphbtn')?.click()
    const graphReady = await waitFor(
      () => all('.w1-gnode').length >= 2 && all('.w1-gedge').length >= 1,
      3000
    )
    check(
      '笔记图谱显示节点与双链',
      graphReady &&
        (one('.w1-notegraphbar')?.textContent ?? '').includes('条双链'),
      (one('.w1-notegraphbar')?.textContent ?? 'missing').slice(0, 80)
    )
    const taggedGraphNode = all('.w1-gnode').find((node) =>
      node.textContent?.includes('冒烟图谱目标')
    )
    check(
      '笔记图谱按标签着色',
      /w1-gtone-[1-6]/.test(taggedGraphNode?.getAttribute('class') ?? '') &&
        (one('.w1-gtags')?.textContent ?? '').includes('冒烟标签'),
      taggedGraphNode?.getAttribute('class') ?? 'missing'
    )
    one('[aria-label="放大图谱"]')?.click()
    await sleep(120)
    check(
      '笔记图谱可放大',
      (one('.w1-gzoom')?.textContent ?? '') === '120%' &&
        (one('.w1-gview')?.getAttribute('transform') ?? '').includes('scale(1.2)'),
      one('.w1-gzoom')?.textContent ?? 'missing'
    )
    one('.w1-notegraphcanvas')?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true
      })
    )
    await sleep(120)
    check(
      '笔记图谱滚轮缩放',
      (one('.w1-gzoom')?.textContent ?? '') === '144%',
      one('.w1-gzoom')?.textContent ?? 'missing'
    )
    const graphSvg = one('.w1-notegraphcanvas svg')
    const panBefore = one('.w1-gview')?.getAttribute('transform') ?? ''
    const parsePanX = (value) => {
      const start = value.indexOf('translate(')
      if (start < 0) return NaN
      const rest = value.slice(start + 'translate('.length)
      const end = rest.indexOf(' ')
      return Number(rest.slice(0, end))
    }
    const panXBefore = parsePanX(panBefore)
    graphSvg?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 300,
        pointerId: 7,
        button: 0,
        pointerType: 'mouse'
      })
    )
    await sleep(60)
    graphSvg?.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: 380,
        clientY: 330,
        pointerId: 7,
        button: 0,
        pointerType: 'mouse'
      })
    )
    await sleep(60)
    graphSvg?.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: 380,
        clientY: 330,
        pointerId: 7,
        button: 0,
        pointerType: 'mouse'
      })
    )
    await sleep(60)
    const panAfter = one('.w1-gview')?.getAttribute('transform') ?? ''
    const panXAfter = parsePanX(panAfter)
    check(
      '笔记图谱可拖拽平移',
      panAfter !== panBefore && Number.isFinite(panXBefore) && panXAfter > panXBefore,
      panAfter || 'missing'
    )
    const nodePanBefore = one('.w1-gview')?.getAttribute('transform') ?? ''
    const nodePanXBefore = parsePanX(nodePanBefore)
    const nodeRect = taggedGraphNode?.getBoundingClientRect()
    const nodeX = nodeRect ? nodeRect.left + nodeRect.width / 2 : 400
    const nodeY = nodeRect ? nodeRect.top + nodeRect.height / 2 : 400
    taggedGraphNode?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: nodeX,
        clientY: nodeY,
        pointerId: 8,
        button: 0,
        pointerType: 'mouse'
      })
    )
    await sleep(60)
    graphSvg?.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: nodeX + 70,
        clientY: nodeY + 20,
        pointerId: 8,
        button: 0,
        pointerType: 'mouse'
      })
    )
    await sleep(60)
    graphSvg?.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: nodeX + 70,
        clientY: nodeY + 20,
        pointerId: 8,
        button: 0,
        pointerType: 'mouse'
      })
    )
    await sleep(60)
    const nodePanAfter = one('.w1-gview')?.getAttribute('transform') ?? ''
    check(
      '笔记图谱从节点拖拽也能平移',
      parsePanX(nodePanAfter) > nodePanXBefore,
      String(nodePanXBefore) + ' -> ' + String(parsePanX(nodePanAfter))
    )
    one('.w1-gzoom')?.click()
    await sleep(120)
    check(
      '笔记图谱可复位视图',
      (one('.w1-gview')?.getAttribute('transform') ?? '') === 'translate(0 0) scale(1)',
      one('.w1-gview')?.getAttribute('transform') ?? 'missing'
    )
    const fullGraphNodes = all('.w1-gnode').length
    one('.w1-gtoggle')?.click()
    await sleep(200)
    const filteredGraphNodes = all('.w1-gnode').length
    check(
      '笔记图谱可只看相连',
      filteredGraphNodes > 0 &&
        filteredGraphNodes < fullGraphNodes &&
        one('.w1-gtoggle')?.getAttribute('aria-pressed') === 'true',
      String(fullGraphNodes) + '→' + String(filteredGraphNodes)
    )
    one('.w1-gtoggle')?.click()
    await sleep(200)
    check(
      '笔记图谱可恢复孤立节点',
      all('.w1-gnode').length === fullGraphNodes,
      String(all('.w1-gnode').length)
    )
    const graphNode = all('.w1-gnode').find((node) =>
      node.textContent?.includes('冒烟图谱目标')
    )
    graphNode?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const graphOpened = await waitFor(
      () =>
        Boolean(one('.w1-notedetail')) &&
        (one('.w1-notedetail-text')?.value ?? '').includes('冒烟图谱目标'),
      3000
    )
    check('笔记图谱节点可打开详情', graphOpened, one('.w1-notedetail-text')?.value ?? 'missing')
    one('.w1-notedetail .w1-modalx')?.click()
    await waitFor(() => !one('.w1-notedetail'), 2000)

    // 笔记详情：编辑正文、改标签、删除
    const noteRow = all('.w1-nvrowbtn')[0]
    noteRow?.click()
    await sleep(400)
    const detail = one('.w1-notedetail')
    check('笔记行可打开详情', Boolean(detail) && !!one('.w1-notedetail-text'))
    const detailText = one('.w1-notedetail-text')
    const originalText = detailText?.value ?? ''
    setValue(detailText, originalText + '［冒烟改写］')
    await sleep(150)
    byText('.w1-notedetail .w1-pb.pri', '保存修改')?.click()
    await sleep(600)
    check(
      '笔记编辑后列表同步',
      !one('.w1-notedetail') && (one('.w1-nvlist')?.textContent ?? '').includes('冒烟改写'),
      (one('.w1-nvrow')?.textContent ?? '').slice(0, 40)
    )

    // 删除：详情里连点两次确认，删掉刚才那条
    all('.w1-nvrowbtn')[0]?.click()
    await sleep(400)
    byText('.w1-notedetail-del', '删除')?.click()
    await sleep(150)
    byText('.w1-notedetail-del', '再次点击确认删除')?.click()
    await sleep(600)
    check(
      '笔记删除后从列表消失',
      !one('.w1-notedetail') && !(one('.w1-nvlist')?.textContent ?? '').includes('冒烟改写'),
      String(all('.w1-nvrow').length)
    )

    // 笔记转卡：详情里点「变成卡片」应跳到学习视图并留下这张卡
    all('.w1-nvrowbtn')[0]?.click()
    await sleep(400)
    const noteTitle = (one('.w1-notedetail-text')?.value ?? '').slice(0, 12)
    byText('.w1-notedetail-card', '变成卡片')?.click()
    await sleep(800)
    check(
      '笔记可转成学习卡',
      activeNav() === '学习' &&
        all('.w1-litem').some((el) => el.textContent?.includes(noteTitle)),
      activeNav() + '|' + noteTitle
    )
    await navTo('笔记')
    await sleep(400)

    // 笔记双链：建两篇，来源引用目标，详情里能来回跳
    const createNote = async (value) => {
      one('.w1-nvnew:not(.w1-nvgraphbtn)')?.click()
      await sleep(300)
      setValue(one('.w1-modal .w1-noteinput'), value)
      byText('.w1-modalacts .w1-pb.pri', '保存笔记')?.click()
      await sleep(600)
    }
    await createNote('冒烟目标笔记\\n这是被引用的目标')
    await createNote('冒烟来源\\n先看 [[冒烟目标笔记]]')
    all('.w1-nvrowbtn')[0]?.click()
    await sleep(500)
    const linkChip = one('.w1-nlchip')
    check(
      '笔记出链可见',
      Boolean(linkChip) && (linkChip?.textContent ?? '').includes('冒烟目标笔记'),
      linkChip?.textContent ?? ''
    )
    linkChip?.click()
    await sleep(400)
    check(
      '链接跳到目标并显示反向链接',
      (one('.w1-notedetail-text')?.value ?? '').startsWith('冒烟目标笔记') &&
        (one('.w1-nlback')?.textContent ?? '').includes('冒烟来源'),
      (one('.w1-notedetail-text')?.value ?? '').slice(0, 20)
    )
    const detailBox = one('.w1-notedetail')?.getBoundingClientRect()
    check(
      '笔记详情在视口内',
      Boolean(detailBox) && detailBox.top >= 0 && detailBox.bottom <= innerHeight,
      detailBox
        ? Math.round(detailBox.top) + '–' + Math.round(detailBox.bottom) + ' / ' + innerHeight
        : '无详情'
    )
    one('.w1-modalx')?.click()
    await sleep(300)

    // 笔记预览：复用 Markdown 渲染，双链可点，缺失链接只提示
    const sourceRow = all('.w1-nvrowbtn').find((row) =>
      (row.textContent ?? '').includes('冒烟来源')
    )
    sourceRow?.click()
    await sleep(400)
    const previewInput = one('.w1-notedetail-text')
    setValue(
      previewInput,
      (previewInput?.value ?? '') +
        '\\n\\n**加粗重点**\\n\\n- 列表甲\\n- 列表乙\\n\\n另见 [[冒烟目标笔记]] 与 [[缺失笔记]]'
    )
    await sleep(150)
    byText('.w1-nlpreviewbtn', '预览')?.click()
    const previewReady = await waitFor(() => Boolean(one('.w1-npreview .w1-md')), 2000)
    const previewStrong = one('.w1-npreview strong')?.textContent ?? ''
    const previewItems = all('.w1-npreview li').length
    const previewLink = all('.w1-nlink').find(
      (node) => (node.textContent ?? '') === '冒烟目标笔记'
    )
    const previewMissing = one('.w1-nlink.missing')
    check(
      '笔记预览渲染 Markdown 与双链',
      previewReady && previewStrong === '加粗重点' && previewItems === 2 && Boolean(previewLink),
      previewStrong + '|' + previewItems + '|' + Boolean(previewLink)
    )
    check(
      '笔记预览标注缺失双链',
      (previewMissing?.textContent ?? '') === '缺失笔记' &&
        (previewMissing?.getAttribute('title') ?? '').includes('找不到'),
      previewMissing?.getAttribute('title') ?? 'missing'
    )
    byText('.w1-nlpreviewbtn', '编辑')?.click()
    const backToEdit = await waitFor(
      () =>
        Boolean(one('.w1-notedetail-text')) &&
        (one('.w1-notedetail-text')?.value ?? '').includes('加粗重点'),
      2000
    )
    check(
      '笔记预览可切回编辑且保留草稿',
      backToEdit,
      one('.w1-notedetail-text')?.value?.slice(-20) ?? 'missing'
    )
    byText('.w1-nlpreviewbtn', '预览')?.click()
    await waitFor(() => Boolean(one('.w1-npreview')), 2000)
    all('.w1-nlink')
      .find((node) => (node.textContent ?? '') === '冒烟目标笔记')
      ?.click()
    const previewJumped = await waitFor(
      () => (one('.w1-notedetail-text')?.value ?? '').startsWith('冒烟目标笔记'),
      2500
    )
    check(
      '预览里的双链可打开目标笔记',
      previewJumped,
      one('.w1-notedetail-text')?.value?.slice(0, 20) ?? 'missing'
    )
    one('.w1-modalx')?.click()
    await sleep(300)

    // ---------- 学习域 ----------
    await navTo('学习')
    check('导航切换到学习', activeNav() === '学习' && !!one('.w1-learn'), activeNav())
    check(
      '学习与其他视图互斥',
      !one('.w1-main') && !one('.w1-todos') && !one('.w1-agent') && !one('.w1-notesview'),
      activeNav()
    )
    check('学习左栏列出科目', all('.w1-learnrail .w1-todorow').length >= 3, String(all('.w1-learnrail .w1-todorow').length))
    check(
      '学习科目按卡片数降序（全部/英语二/管综…/…/已停用）',
      (() => {
        const labels = all('.w1-learnrail .w1-todolabel').map((node) => node.textContent)
        if (labels[0] !== '全部' || labels.at(-1) !== '已停用') return false
        // 中间是科目：数量必须单调不增（前面刚把一条笔记转成了卡，可能多出一个科目）
        const counts = all('.w1-learnrail .w1-todocount')
          .slice(1, -1)
          .map((node) => Number(node.textContent))
        return counts.every((value, index) => index === 0 || counts[index - 1] >= value)
      })(),
      all('.w1-learnrail .w1-todolabel').map((node) => node.textContent).join('/')
    )
    check(
      '学习默认列出全部卡片',
      all('.w1-litem').length >= 20,
      String(all('.w1-litem').length)
    )
    check(
      '学习顶部显示到期数与时长',
      one('.w1-learnmain .w1-todosub')?.textContent?.includes('分钟') ?? false,
      one('.w1-learnmain .w1-todosub')?.textContent ?? ''
    )
    check(
      '学习页有每日新卡上限',
      one('.w1-lnewlimit select')?.value === '20',
      one('.w1-lnewlimit select')?.value ?? 'missing'
    )

    byText('.w1-lfilebtn', '统计')?.click()
    await sleep(350)
    check(
      '学习统计弹层显示 7 天预测',
      !!one('.w1-lstats') && all('.w1-lstatday').length === 7,
      String(all('.w1-lstatday').length)
    )
    check(
      '学习统计显示保持率与掌握分布',
      (one('.w1-lstatgrid')?.textContent ?? '').includes('记忆保持率') &&
        all('.w1-lstatlegend span').length === 3,
      one('.w1-lstatgrid')?.textContent ?? ''
    )
    check(
      '学习统计无限额时显示今天到期',
      (one('.w1-lstatgrid')?.textContent ?? '').includes('今天到期'),
      one('.w1-lstatgrid')?.textContent ?? ''
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(300)
    check('Esc 关闭学习统计', !one('.w1-lstats'))

    const learnSearch = one('.w1-learnmain .w1-todosearch input')
    setValue(learnSearch, 'analyze')
    await sleep(350)
    check(
      '卡片搜索命中正面',
      all('.w1-litem').length === 1 && one('.w1-ltitle')?.textContent === 'analyze',
      String(all('.w1-litem').length)
    )
    learnSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(300)
    check('卡片搜索 Esc 清空', learnSearch.value === '' && all('.w1-litem').length >= 20, learnSearch.value)

    // CSV 导入：用 File + DataTransfer 驱动隐藏 input，覆盖预览与提交
    const importInput = one('#learn-import-file')
    check(
      '学习视图有 CSV 导入导出入口',
      Boolean(importInput) && !!byText('.w1-lfilebtn', '导入') && !!byText('.w1-lfilebtn', '导出')
    )
    const csv = '科目,正面,背面,来源,类型,挖空原文\\n管综逻辑,冒烟导入卡,导入测试,,基础,\\n'
    const file = new File([csv], 'smoke.csv', { type: 'text/csv' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    importInput.files = transfer.files
    importInput.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(500)
    check(
      'CSV 导入弹出预览',
      !!one('.w1-limport') && (one('.w1-limportstats')?.textContent ?? '').includes('1'),
      one('.w1-limportstats')?.textContent ?? ''
    )
    byText('.w1-limport .w1-pb.pri', '导入 1 张')?.click()
    await sleep(700)
    check(
      'CSV 导入写入卡片',
      !one('.w1-limport') && all('.w1-litem').some((el) => el.textContent?.includes('冒烟导入卡')),
      one('.w1-lnotice')?.textContent ?? ''
    )

    byText('.w1-learnrail .w1-todorow', '管综数学')?.click()
    await sleep(350)
    check(
      '按科目收窄卡片',
      all('.w1-litem').length === 3,
      String(all('.w1-litem').length)
    )
    byText('.w1-learnrail .w1-todorow', '全部')?.click()
    await sleep(350)

    byText('.w1-learnrail button', '新建')?.click()
    await sleep(300)
    check('新建卡片表单内联展开', !!one('.w1-lnew'))
    setValue(one('#learn-new-subject'), '管综逻辑')
    setValue(one('#learn-new-title'), '幂等键')
    setValue(one('#learn-new-notes'), '用于支付类接口去重')
    byText('.w1-lnew button', '保存卡片')?.click()
    await sleep(600)
    check(
      '新建卡片出现在列表',
      all('.w1-litem').some((el) => el.textContent?.includes('幂等键')) && !one('.w1-lnew'),
      String(all('.w1-litem').length)
    )

    // 挖空卡：切到挖空卡型，用 {{c1::}} 标记建一张
    byText('.w1-learnrail button', '新建')?.click()
    await sleep(300)
    byText('.w1-lkindtabs button', '挖空')?.click()
    await sleep(250)
    const clozeField = one('#learn-new-cloze')
    check('挖空卡型切出原文输入框', Boolean(clozeField))
    setValue(one('#learn-new-subject'), '管综逻辑')
    setValue(clozeField, '冒烟：{{c1::TCP}} 是面向连接的')
    await sleep(250)
    check(
      '挖空正面预览隐藏答案',
      (one('.w1-lclozehint')?.textContent ?? '').includes('[1] 是面向连接的'),
      one('.w1-lclozehint')?.textContent ?? ''
    )
    byText('.w1-lnew button', '保存卡片')?.click()
    await sleep(600)
    const clozeRow = all('.w1-litem').find((el) => el.textContent?.includes('[1] 是面向连接的'))
    check(
      '挖空卡进入卡片库并带标记',
      Boolean(clozeRow) && clozeRow?.textContent?.includes('挖空'),
      clozeRow?.textContent?.slice(0, 40) ?? ''
    )

    byText('.w1-learnrail button', '新建')?.click()
    await waitFor(() => Boolean(one('#learn-new-title')), 2000)
    byText('.w1-lkindtabs button', '基础')?.click()
    setValue(one('#learn-new-subject'), '管综逻辑')
    setValue(one('#learn-new-title'), '限额补卡')
    byText('.w1-lnew button', '保存卡片')?.click()
    const limitFixture = await waitFor(
      () => Number(one('.w1-learnmain .w1-todosub b')?.textContent) === 11,
      2500
    )
    check('限额用例补一张新卡', limitFixture, one('.w1-learnmain .w1-todosub')?.textContent ?? '')
    const dueBeforeCap = Number(one('.w1-learnmain .w1-todosub b')?.textContent ?? -1)
    const limitSelect = one('.w1-lnewlimit select')
    if (limitSelect) setValue(limitSelect, '10')
    const cappedCount = await waitFor(
      () => Number(one('.w1-learnmain .w1-todosub b')?.textContent) === 10,
      2500
    )
    check(
      '每日新卡上限立即收窄队列',
      cappedCount && dueBeforeCap > 10,
      dueBeforeCap + ' -> ' + (one('.w1-learnmain .w1-todosub b')?.textContent ?? 'missing')
    )
    const deferredHint = one('.w1-lnewdefer')?.textContent ?? ''
    check(
      '超出上限的新卡提示留到明天',
      cappedCount && deferredHint.includes('留到明天'),
      deferredHint || 'missing'
    )
    const learningNavMeta =
      all('.w1-navitem')
        .find((el) => el.querySelector('.w1-navtext b')?.textContent?.trim() === '学习')
        ?.querySelector('small')?.textContent ?? ''
    check(
      '导航同步新卡上限后的到期数',
      learningNavMeta.includes('10 张到期'),
      learningNavMeta || 'missing'
    )
    byText('.w1-lfilebtn', '统计')?.click()
    const limitStats = await waitFor(() => Boolean(one('.w1-lstatlimit')), 2000)
    check(
      '学习统计显示限额后的今日队列',
      limitStats &&
        (one('.w1-lstatgrid')?.textContent ?? '').includes('今日队列') &&
        (one('.w1-lstatlimit')?.textContent ?? '').includes('留到明天'),
      one('.w1-lstatlimit')?.textContent ?? 'missing'
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    const limitStatsClosed = await waitFor(() => !one('.w1-lstats'), 1500)
    check('学习统计关闭后回到卡片库', limitStatsClosed, String(limitStatsClosed))
    const restoreLimit = one('.w1-lnewlimit select')
    if (restoreLimit) setValue(restoreLimit, '20')
    const restoredCount = await waitFor(
      () => Number(one('.w1-learnmain .w1-todosub b')?.textContent) === dueBeforeCap,
      2500
    )
    check('恢复新卡上限后队列恢复', restoredCount, String(restoredCount))
    const dueBefore = Number(one('.w1-learnmain .w1-todosub b')?.textContent ?? -1)
    const reviewBtn = one('.w1-lrevbtn')
    check('卡片库有开始复习入口', Boolean(reviewBtn))
    reviewBtn?.click()
    await sleep(600)
    check('进入复习态', !!one('.w1-lreview') && !!one('.w1-lcard'))
    check(
      '复习卡默认显示正面',
      one('.w1-lfront')?.textContent?.includes('正面') ?? false,
      one('.w1-lfront')?.textContent?.slice(0, 40) ?? ''
    )
    check(
      '复习进度显示当前张数',
      /\\d+\\s*\\/\\s*\\d+/.test(one('.w1-lrevcount')?.textContent ?? ''),
      one('.w1-lrevcount')?.textContent ?? ''
    )
    check(
      '未翻面时评分禁用',
      all('.w1-lrate').every((el) => el.disabled),
      String(all('.w1-lrate').filter((el) => el.disabled).length)
    )

    one('.w1-lcard')?.click()
    await waitFor(
      () => one('.w1-lcard')?.classList.contains('flipped') && !!one('.w1-lcardnotes'),
      2000
    )
    const flippedTransform = one('.w1-lcardinner')
      ? getComputedStyle(one('.w1-lcardinner')).transform
      : 'none'
    check(
      '点击翻面显示背面',
      one('.w1-lcard')?.classList.contains('flipped') &&
        !!one('.w1-lcardnotes') &&
        flippedTransform !== 'none',
      flippedTransform
    )
    check(
      '翻面后评分可用并显示间隔',
      all('.w1-lrate').every((el) => !el.disabled) &&
        all('.w1-lrate span').every((el) => /\\d+\\s*天|今天/.test(el.textContent ?? '')),
      all('.w1-lrate span').map((el) => el.textContent).join('/')
    )

    const queueSizeBefore = all('.w1-lrate').length
    byText('.w1-lrate', '良好')?.click()
    await sleep(700)
    const advanced = one('.w1-lrevcount')?.textContent ?? ''
    check('评分后进入下一张', queueSizeBefore === 4 && advanced.length > 0, advanced)
    const limitTodayKey = (() => {
      const d = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    })()
    const introducedToday = await window.ws.learning.newIntroduced(limitTodayKey)
    check('今日首次复习计数落库', introducedToday === 1, String(introducedToday))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(500)
    check(
      'Esc 退出复习回到卡片库',
      !one('.w1-lreview') && !!one('.w1-learn') && activeNav() === '学习',
      activeNav()
    )

    let dueAfter = Number(one('.w1-learnmain .w1-todosub b')?.textContent ?? -1)
    check('评分后到期数减少', dueAfter === dueBefore - 1, dueBefore + ' -> ' + dueAfter)

    byText('.w1-lfilebtn', '统计')?.click()
    await sleep(500)
    check(
      '统计显示 14 天复习历史',
      all('.w1-lreviewday').length === 14 &&
        (one('.w1-lreviewchart')?.textContent ?? '').includes('1'),
      String(all('.w1-lreviewday').length)
    )
    check(
      '统计显示评分分布',
      all('.w1-lratestack i').length === 4 &&
        (one('.w1-lstats')?.textContent ?? '').includes('良好 1'),
      one('.w1-lstats')?.textContent?.slice(0, 80) ?? ''
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(300)

    const deleteCardRow = all('.w1-litem').find((el) => el.textContent?.includes('幂等键'))
    deleteCardRow?.querySelector('.w1-lbody')?.click()
    const deleteCardEntry = await waitFor(
      () =>
        [...(one('.w1-litem.open .w1-todoactions')?.querySelectorAll('button') ?? [])].some(
          (el) => el.textContent?.trim() === '删除卡片'
        ),
      2000
    )
    check('学习卡编辑区有删除入口', deleteCardEntry, deleteCardEntry ? 'ready' : 'missing')
    const deleteCardActions = one('.w1-litem.open .w1-todoactions')
    const deleteCardButton = deleteCardActions
      ? [...deleteCardActions.querySelectorAll('button')].find(
          (el) => el.textContent?.trim() === '删除卡片'
        )
      : undefined
    deleteCardButton?.click()
    const deleteArmed = await waitFor(
      () => byText('.w1-litem.open .w1-tododelete', '再次点击确认删除') !== undefined,
      1500
    )
    check('学习卡删除需要二次确认', deleteArmed, '')
    byText('.w1-litem.open .w1-tododelete', '再次点击确认删除')?.click()
    const cardGone = await waitFor(
      () => !all('.w1-litem').some((el) => el.textContent?.includes('幂等键')),
      2500
    )
    const cardDbGone = await waitFor(async () => {
      const cards = await window.ws.learning.list()
      return !cards.some((card) => card.title === '幂等键')
    }, 2500)
    check(
      '学习卡删除后从列表与数据库消失',
      cardGone && cardDbGone,
      cardGone + ' / ' + cardDbGone
    )
    dueAfter = Number(one('.w1-learnmain .w1-todosub b')?.textContent ?? -1)

    await navTo('今日')
    check(
      '今日学习卡显示真实到期数',
      one('.w1-review .w1-big')?.textContent === String(dueAfter),
      (one('.w1-review .w1-big')?.textContent ?? '') + ' vs ' + dueAfter
    )
    one('.w1-review .w1-rbtn')?.click()
    await sleep(600)
    check('今日卡可开始复习', !!one('.w1-lreview') && activeNav() === '学习', activeNav())
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(450)
    await navTo('今日')

    one('.w1-motion')?.focus()
    await openPalette()
    const sendInput = one('.w1-paletteinput')
    setValue(sendInput, '帮我拟一条周报提醒')
    await waitFor(
      () => (one('.w1-paletteitem[data-selected="true"]')?.textContent ?? '').includes('发送给 Claude'),
      1500
    )
    const selectedSend = one('.w1-paletteitem[data-selected="true"]')?.textContent ?? ''
    check(
      '无匹配命令时回退为发送',
      selectedSend.includes('发送给 Claude') && !selectedSend.includes('测一下多会话'),
      selectedSend
    )
    sendInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () =>
        activeNav() === 'Agent' &&
        (one('.w1-thread')?.textContent ?? '').includes('帮我拟一条周报提醒') &&
        !!one('.w1-typing'),
      1500
    )
    check(
      '命令面板发送后切到 Agent',
      activeNav() === 'Agent' && one('.w1-thread')?.textContent?.includes('帮我拟一条周报提醒') && !!one('.w1-typing'),
      activeNav()
    )
    await waitFor(() => !one('.w1-palette'), 1500)

    await openPalette(150)
    const busyInput = one('.w1-paletteinput')
    setValue(busyInput, '再发一条')
    await waitFor(() => byText('.w1-paletteitem', '发送给') !== undefined, 1000)
    const sendItem = byText('.w1-paletteitem', '发送给')
    check(
      '等待回复时禁用发送',
      !!sendItem && sendItem.getAttribute('data-disabled') === 'true',
      sendItem?.getAttribute('data-disabled') ?? 'missing'
    )
    busyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(() => !one('.w1-palette'), 1500)
    await openPalette()
    const backupInput = one('.w1-paletteinput')
    setValue(backupInput, '立即备份数据')
    await sleep(300)
    backupInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await sleep(1200)
    check(
      '命令面板可立即备份',
      one('.w1-toast')?.textContent?.includes('已备份') === true,
      one('.w1-toast')?.textContent ?? 'no toast'
    )

    const paletteClosed = await waitFor(() => !one('.w1-palette'), 2000)
    const paletteFocusReturned = await waitFor(
      () => document.activeElement?.classList.contains('w1-motion') === true,
      2000
    )
    check('Esc 关闭命令面板', paletteClosed)
    check(
      'Esc 后焦点归位',
      paletteFocusReturned,
      document.activeElement?.className?.toString?.() ?? ''
    )
    await sleep(1000)
    check('命令面板发送后收到回复', !one('.w1-typing'), one('.w1-typing') ? '等待动画未结束' : '')

    // 键盘速查表：输入框内不抢问号，非输入场景打开
    await navTo('任务')
    const shortcutProbe = one('.w1-todoinput')
    shortcutProbe?.focus()
    shortcutProbe?.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true })
    )
    await sleep(300)
    check('输入框内的问号不打开速查表', !one('.w1-shortcuts'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true }))
    await sleep(500)
    check(
      '问号打开键盘速查表',
      !!one('.w1-shortcuts') &&
        all('.w1-sheetgroup').length === 5 &&
        all('.w1-sheetrow').length >= 15,
      String(all('.w1-sheetgroup').length) + ' 组 / ' + String(all('.w1-sheetrow').length) + ' 条'
    )
    check(
      '速查表列出主键位',
      ['Ctrl', 'Shift', 'Space', 'Esc'].every((key) =>
        one('.w1-shortcuts')?.textContent?.includes(key)
      ),
      one('.w1-schead')?.textContent ?? ''
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(() => !one('.w1-shortcuts'), 2000)
    check('Esc 关闭速查表', !one('.w1-shortcuts'))
    check('状态栏有速查入口', !!one('.w1-st-shortcuts'))

    await navTo('今日')
    one('.w1-motion')?.focus()
    await openPalette()
    const noteCommand = one('.w1-paletteinput')
    setValue(noteCommand, '新建快速笔记')
    await sleep(300)
    noteCommand.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(500)
    check('命令面板可打开快速笔记', !!one('.w1-modal'))
    check(
      '快速笔记接管焦点',
      document.activeElement?.classList.contains('w1-noteinput'),
      document.activeElement?.className?.toString?.() ?? ''
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(
      () => !one('.w1-modal') && document.activeElement?.classList.contains('w1-motion'),
      2000
    )
    check(
      '快速笔记关闭后焦点归位',
      !one('.w1-modal') && document.activeElement?.classList.contains('w1-motion'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    await navTo('今日')
    one('.w1-nall')?.click()
    await sleep(600)
    check('全部笔记入口切换工作区', activeNav() === '笔记' && !!one('.w1-notesview'))

    await navTo('今日')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
    await sleep(350)
    check('Ctrl+N 打开笔记', !!one('.w1-modal'))
    one('.w1-modalx')?.click()
    await waitFor(() => !one('.w1-modal'), 2000)
    check('弹窗可关闭', !one('.w1-modal'))

    // 会话失败时展示可读文案与办法，而不是把原始报错甩给用户
    await navTo('Agent')
    byText('.w1-sess', '测一下多会话回复')?.click()
    await sleep(300)
    // 前面的并发用例可能刚收尾；等目标会话空闲再发，避免撞上运行锁
    await waitFor(async () => {
      const bundle = await window.ws.agent.sessions()
      const target = bundle.sessions.find((item) => item.title === '测一下多会话回复')
      return Boolean(target) && target.status === 'idle'
    }, 6000)
    await waitFor(() => one('#composer-input')?.disabled === false, 3000)
    const loginFailInput = one('#composer-input')
    if (loginFailInput) {
      setValue(loginFailInput, '触发登录失败')
      await sleep(80)
      loginFailInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      )
      const failShown = await waitFor(
        () => (one('.w1-thread')?.textContent ?? '').includes('claude login'),
        6000
      )
      const failText = one('.w1-thread')?.textContent ?? ''
      check('会话失败时给出可读原因与办法', failShown, failText.slice(-120))
      check(
        '不把原始字段直接丢给用户',
        !failText.includes('error_during_execution'),
        failText.slice(-80)
      )

      const providerCases = [
        ['模型不存在', '模型不可用', '拉取模型', 'Model Not Exist'],
        ['上下文超长', '对话超出模型上下文', '新开一个会话', 'maximum context length'],
        ['余额不足', '账户额度不足', '余额', 'Insufficient Balance'],
        ['协议错配', '接口地址或协议不匹配', 'OpenAI Responses', 'url:']
      ]
      let detailChecked = false
      for (const [promptText, title, hint, raw] of providerCases) {
        const input = one('#composer-input')
        setValue(input, promptText)
        await sleep(80)
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
        )
        const readable = await waitFor(
          () =>
            (
              all('.w1-amsg').at(-1)?.querySelector('.w1-atext.error')?.textContent ?? ''
            ).includes(title),
          6000
        )
        const errorText =
          all('.w1-amsg').at(-1)?.querySelector('.w1-atext.error')?.textContent ?? ''
        check(
          promptText + '：显示可读原因',
          readable && errorText.includes(hint),
          errorText.slice(0, 140)
        )
        if (!detailChecked) {
          const lastMsg = all('.w1-amsg').at(-1)
          const rawVisible = (one('.w1-thread')?.textContent ?? '').includes(raw)
          const button = lastMsg?.querySelector('.w1-errdetailbtn')
          check(
            '错误详情默认收起',
            Boolean(button) && !rawVisible,
            button?.textContent ?? 'missing'
          )
          if (window.__WS_SMOKE_ERROR_SHOT__) {
            console.log('SMOKE_ERROR_SHOT')
            await sleep(3500)
          }
          button?.click()
          await sleep(120)
          const expanded = lastMsg?.querySelector('.w1-errdetail pre')?.textContent ?? ''
          check('错误详情可展开查看原文', expanded.includes(raw), expanded.slice(0, 100))
          button?.click()
          detailChecked = true
        }
        await waitFor(() => !one('.w1-typing'), 3000)
      }
    } else {
      check('会话失败时给出可读原因与办法', false, '找不到输入框')
    }

    // v0.64.0 交互与样式特效：真实 DOM 上验证聚光坐标、状态流光、波纹与动效总闸
    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await waitFor(() => Boolean(one('.w1-aworkspacegate')), 2000)
    one('.w1-aworkspacegate .w1-pb')?.click()
    const effectsComposerReady = await waitFor(
      () => one('#composer-input')?.disabled === false,
      3000
    )
    check('特效用例新会话就绪', effectsComposerReady, '')
    const composer = one('#composer-input')
    if (composer) {
      setValue(composer, '运行流光')
      await sleep(80)
      composer.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      )
      const runningBeam = await waitFor(
        () => Boolean(one('.w1-sess.run .w1-beamlayer')),
        5000
      )
      check('运行中会话显示流光层', runningBeam, one('.w1-sess.run')?.className ?? 'missing')
      await waitFor(() => !one('.w1-sess.run'), 8000)
      await waitFor(() => one('#composer-input')?.disabled === false, 3000)

      setValue(one('#composer-input'), '需要审批')
      await sleep(80)
      one('#composer-input')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      )
      const approvalBeam = await waitFor(
        () => Boolean(one('.w1-perm .w1-beamlayer')),
        6000
      )
      check('审批卡显示流光层', approvalBeam, one('.w1-perm')?.className ?? 'missing')
      const approvalLayer = one('.w1-perm .w1-beamlayer')
      const shell = one('.w1')
      if (approvalLayer && shell) {
        shell.classList.add('motion-off')
        const beamHidden = getComputedStyle(approvalLayer).display === 'none'
        shell.classList.remove('motion-off')
        check('动效总闸关闭流光', beamHidden, getComputedStyle(approvalLayer).display)
      } else {
        check('动效总闸关闭流光', false, '找不到审批流光层')
      }
      const denyButton = [...(one('.w1-perm')?.querySelectorAll('button') ?? [])].find((button) =>
        (button.textContent ?? '').includes('拒绝')
      )
      denyButton?.click()
      await waitFor(() => !one('.w1-perm'), 3000)

      const fleetText = one('.w1-st-fleet')?.textContent ?? ''
      check('舰队计数由滚动数字渲染', /^舰队\\s*\\d+$/.test(fleetText.trim()), fleetText)

      const goToView = (label) =>
        [...document.querySelectorAll('.w1-navitem')]
          .find((node) => node.querySelector('.w1-navtext b')?.textContent?.trim() === label)
          ?.click()
      goToView('今日')
      await sleep(400)
      const spotHost = one('[data-spotlight]')
      const spotLayer = spotHost?.querySelector('.w1-spot')
      const spotBox = spotHost?.getBoundingClientRect()
      spotHost?.dispatchEvent(
        new PointerEvent('pointerover', {
          bubbles: true,
          clientX: (spotBox?.left ?? 0) + 40,
          clientY: (spotBox?.top ?? 0) + 30
        })
      )
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: (spotBox?.left ?? 0) + 52,
          clientY: (spotBox?.top ?? 0) + 44
        })
      )
      const spotMoved = await waitFor(
        () => (spotHost?.style.getPropertyValue('--spot-x') ?? '').endsWith('px'),
        1500
      )
      check(
        '卡片聚光写入指针坐标',
        spotMoved && Boolean(spotLayer),
        spotHost?.style.getPropertyValue('--spot-x') ?? 'missing'
      )
      const spotWidth = spotLayer?.getBoundingClientRect().width ?? 0
      check(
        '聚光层与卡片同尺寸',
        Math.abs(spotWidth - (spotBox?.width ?? 0)) <= 2,
        String(Math.round(spotWidth)) + '/' + String(Math.round(spotBox?.width ?? 0))
      )

      navTo('任务')
      await sleep(400)
      const quickInput = one('.w1-todoinput')
      if (quickInput) {
        setValue(quickInput, '波纹冒烟')
        await waitFor(() => one('.w1-todoadd')?.disabled === false, 1500)
        const addButton = one('.w1-todoadd')
        const addRect = addButton?.getBoundingClientRect()
        addButton?.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            clientX: (addRect?.left ?? 0) + 8,
            clientY: (addRect?.top ?? 0) + 8
          })
        )
        const rippleShown = await waitFor(
          () => Boolean(one('.w1-todoadd .w1-ripple')),
          1200
        )
        check(
          '主按钮按下生成水波纹',
          rippleShown && getComputedStyle(addButton).overflow === 'hidden',
          addButton ? getComputedStyle(addButton).overflow : 'missing'
        )
        setValue(quickInput, '')
      }
    }

    // 今日收尾：真实打开面板、顺延一条任务并生成复盘笔记
    await navTo('任务')
    await waitFor(() => Boolean(one('.w1-todoinput')), 3000)
    const reviewSearch = one('.w1-todosearch input')
    if (reviewSearch?.value) setValue(reviewSearch, '')
    await taskScopeTo('全部任务')
    const reviewSeedInput = one('.w1-todoinput')
    setValue(reviewSeedInput, '今天 收尾冒烟任务')
    await waitFor(() => one('.w1-todoadd')?.disabled === false, 1500)
    reviewSeedInput?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await waitFor(() => taskRow('收尾冒烟任务') !== undefined, 3000)
    await navTo('今日')
    await waitFor(() => Boolean(byText('.w1-acts .w1-btn', '今日收尾')), 2500)
    const reviewButton = byText('.w1-acts .w1-btn', '今日收尾')
    reviewButton?.click()
    const reviewOpened = await waitFor(() => Boolean(one('.w1-dreview')), 2500)
    check('今日收尾面板可打开', reviewOpened, reviewOpened ? 'ok' : 'missing')
    const reviewFocused = await waitFor(() => document.activeElement === one('.w1-dreview'), 1200)
    check('收尾面板打开后焦点在对话框', reviewFocused, document.activeElement?.className ?? '')
    if (window.__WS_SMOKE_REVIEW_SHOT__) {
      if (window.__WS_SMOKE_REVIEW_THEME__ === 'light') {
        document.documentElement.dataset.theme = 'light'
        localStorage.setItem('workstation.theme', 'light')
        await sleep(400)
      }
      console.log('SMOKE_REVIEW_SHOT')
      await sleep(1200)
    }
    const reviewRows = all('.w1-dreviewopen')
    const reviewTaskRow = reviewRows.find((row) => row.textContent?.includes('收尾冒烟任务'))
    const openStat = all('.w1-dreviewstat').find(
      (el) => el.querySelector('span')?.textContent?.trim() === '未完成'
    )
    check(
      '收尾未完成统计与列表一致',
      Boolean(openStat) &&
        Number(openStat.querySelector('b')?.textContent) === reviewRows.length &&
        Boolean(reviewTaskRow),
      String(reviewRows.length) + ' | ' + (openStat?.textContent ?? '')
    )
    check(
      '收尾显示原因、习惯与学习',
      reviewTaskRow?.querySelector('.w1-dreviewbadge')?.textContent?.trim() === '今天到期' &&
        all('.w1-dreviewhabit').length > 0 &&
        (one('.w1-dreviewbody')?.textContent?.includes('学习') ?? false),
      reviewTaskRow?.querySelector('.w1-dreviewbadge')?.textContent ?? 'missing'
    )
    for (const row of reviewRows) {
      if (row === reviewTaskRow) continue
      const box = row.querySelector('input[type="checkbox"]')
      if (box?.checked) box.click()
    }
    await waitFor(
      () => Boolean(byText('.w1-dreviewactions .w1-btn', '顺延 1 项到明天')),
      1200
    )
    byText('.w1-dreviewactions .w1-btn', '顺延 1 项到明天')?.click()
    await waitFor(
      () => (byText('.w1-dreviewopen', '收尾冒烟任务')?.textContent ?? '').includes('已顺延'),
      2000
    )
    const tomorrowKey = (() => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      const pad = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    })()
    const carriedTask = await (async () => {
      let target = null
      await waitFor(async () => {
        target = (await window.ws.tasks.list()).find(
          (task) => task.title === '收尾冒烟任务'
        )
        return target?.dueDate === tomorrowKey && target?.plannedFor === tomorrowKey
      }, 3000)
      return target
    })()
    check(
      '收尾顺延写入明天的计划与截止',
      carriedTask?.dueDate === tomorrowKey && carriedTask?.plannedFor === tomorrowKey,
      String(carriedTask?.dueDate) + ' | ' + String(carriedTask?.plannedFor)
    )
    byText('.w1-dreviewactions .w1-btn', '存为复盘笔记')?.click()
    const reviewClosed = await waitFor(() => !one('.w1-dreview'), 2500)
    const reviewNoteSaved = await waitFor(async () => {
      const page = await window.ws.notes.page(0, 50, '复盘')
      return page.items.some((note) => note.text.includes('收尾冒烟任务'))
    }, 3000)
    const reviewNote = reviewNoteSaved
      ? (await window.ws.notes.page(0, 50, '复盘')).items.find((note) =>
          note.text.includes('收尾冒烟任务')
        )
      : undefined
    check(
      '复盘笔记落库并带顺延标记',
      reviewClosed &&
        Boolean(reviewNote) &&
        reviewNote.tag === '复盘' &&
        reviewNote.text.includes('收尾冒烟任务（今天到期 · 顺延到明天）'),
      reviewNote ? reviewNote.text.split('\\n')[0] : 'missing'
    )
    const focusBack = await waitFor(() => document.activeElement === reviewButton, 2500)
    check('收尾关闭后焦点回到入口', focusBack, document.activeElement?.textContent ?? '')
    reviewButton?.click()
    await waitFor(() => Boolean(one('.w1-dreview')), 2000)
    one('.w1-dreview')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    const reviewEscClosed = await waitFor(() => !one('.w1-dreview'), 2000)
    check('收尾面板 Esc 可关闭', reviewEscClosed, String(reviewEscClosed))

    await navTo('任务')
    await waitFor(() => Boolean(one('.w1-todoinput')), 3000)
    const weekSeedSearch = one('.w1-todosearch input')
    if (weekSeedSearch?.value) setValue(weekSeedSearch, '')
    await taskScopeTo('全部任务')
    const weekSeedInput = one('.w1-todoinput')
    setValue(weekSeedInput, '今天 周回顾顺延任务')
    await waitFor(() => one('.w1-todoadd')?.disabled === false, 1500)
    weekSeedInput?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await waitFor(() => taskRow('周回顾顺延任务') !== undefined, 3000)
    await navTo('今日')
    await waitFor(() => Boolean(byText('.w1-acts .w1-btn', '本周')), 2500)

    const weekButton = one('.w1-acts button[aria-label="打开本周回顾"]')
    check('今日页有本周回顾入口', Boolean(weekButton))
    weekButton?.click()
    const weeklyOpened = await waitFor(() => Boolean(one('.w1-wreview')), 2500)
    check('本周回顾面板可打开', weeklyOpened, weeklyOpened ? 'ok' : 'missing')
    const weeklyFocused = await waitFor(() => document.activeElement === one('.w1-wreview'), 1200)
    check('本周回顾焦点在对话框', weeklyFocused, document.activeElement?.className ?? '')
    const weekRange = () => one('.w1-wreview .w1-dreviewintro h2')?.textContent ?? ''
    const weekRangeBefore = weekRange()
    const weekRangeParts = weekRangeBefore.split(' – ')
    const rangeLeft = weekRangeParts[0]?.split('.') ?? []
    const rangeRight = weekRangeParts[1]?.split('.') ?? []
    const validWeekRange =
      weekRangeParts.length === 2 &&
      rangeLeft.length === 3 &&
      rangeRight.length === 2 &&
      rangeLeft[0]?.length === 4 &&
      rangeLeft[1]?.length === 2 &&
      rangeLeft[2]?.length === 2 &&
      rangeRight[0]?.length === 2 &&
      rangeRight[1]?.length === 2 &&
      [...rangeLeft, ...rangeRight].every((part) => Number.isInteger(Number(part)))
    check('本周回顾显示周区间', validWeekRange, weekRangeBefore || 'missing')
    const weeklyReady = await waitFor(
      () => one('.w1-wreview .w1-btn.pri')?.disabled === false,
      3500
    )
    check('本周回顾数据就绪', weeklyReady, one('.w1-wreview .w1-btn.pri')?.textContent ?? '')
    check(
      '本周回顾有每日、习惯、学习与 Agent',
      all('.w1-wreviewday').length === 7 &&
        (one('.w1-wreview')?.textContent ?? '').includes('每日完成') &&
        (one('.w1-wreview')?.textContent ?? '').includes('学习') &&
        (one('.w1-wreview')?.textContent ?? '').includes('Agent'),
      String(all('.w1-wreviewday').length)
    )
    if (window.__WS_SMOKE_WEEKLY_SHOT__) {
      const previousTheme = document.documentElement.dataset.theme
      const previousStoredTheme = localStorage.getItem('workstation.theme')
      if (window.__WS_SMOKE_WEEKLY_THEME__ === 'light') {
        document.documentElement.dataset.theme = 'light'
        localStorage.setItem('workstation.theme', 'light')
        await sleep(400)
      }
      const weeklyBody = one('.w1-wreview .w1-dreviewbody')
      if (weeklyBody) weeklyBody.scrollTop = 0
      const weeklyOpenSection = all('.w1-wreview .w1-dreviewsection').find(
        (section) =>
          section.querySelector('.w1-dreviewsechead b')?.textContent?.trim() === '未完成'
      )
      weeklyOpenSection?.scrollIntoView({ block: 'center' })
      await sleep(200)
      console.log('SMOKE_WEEKLY_SHOT')
      await sleep(1200)
      if (window.__WS_SMOKE_WEEKLY_THEME__ === 'light') {
        if (previousTheme) document.documentElement.dataset.theme = previousTheme
        else document.documentElement.removeAttribute('data-theme')
        if (previousStoredTheme === null) localStorage.removeItem('workstation.theme')
        else localStorage.setItem('workstation.theme', previousStoredTheme)
        await sleep(300)
      }
    }
    const weeklyRows = all('.w1-wreview .w1-dreviewopen')
    const weeklyCarryRow = weeklyRows.find((row) => row.textContent?.includes('周回顾顺延任务'))
    check(
      '本周回顾未完成项可勾选',
      Boolean(weeklyCarryRow) &&
        Boolean(weeklyCarryRow?.querySelector('input[type="checkbox"]')),
      String(weeklyRows.length) + ' | ' + (weeklyCarryRow?.textContent ?? 'missing')
    )
    for (const row of weeklyRows) {
      if (row === weeklyCarryRow) continue
      const box = row.querySelector('input[type="checkbox"]')
      if (box?.checked) box.click()
    }
    const carryButtonShown = await waitFor(
      () => Boolean(byText('.w1-wreview .w1-dreviewactions .w1-btn', '顺延 1 项到下周')),
      1500
    )
    byText('.w1-wreview .w1-dreviewactions .w1-btn', '顺延 1 项到下周')?.click()
    const weeklyCarriedMark = await waitFor(
      () => (byText('.w1-wreview .w1-dreviewopen', '周回顾顺延任务')?.textContent ?? '').includes('已顺延'),
      2000
    )
    check(
      '本周回顾顺延后显示已顺延',
      carryButtonShown && weeklyCarriedMark,
      String(carryButtonShown) + ' | ' + String(weeklyCarriedMark)
    )
    const nextWeekMondayKey = (() => {
      const d = new Date()
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7)
      const pad = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    })()
    const weeklyCarriedTask = await (async () => {
      let target = null
      await waitFor(async () => {
        target = (await window.ws.tasks.list()).find(
          (task) => task.title === '周回顾顺延任务'
        )
        return target?.dueDate === nextWeekMondayKey && target?.plannedFor === nextWeekMondayKey
      }, 3000)
      return target
    })()
    check(
      '本周回顾顺延写入下周一',
      weeklyCarriedTask?.dueDate === nextWeekMondayKey &&
        weeklyCarriedTask?.plannedFor === nextWeekMondayKey,
      String(weeklyCarriedTask?.dueDate) + ' | ' + String(weeklyCarriedTask?.plannedFor)
    )
    byText('.w1-wreviewnav button', '上一周')?.click()
    const previousWeekOpen = await waitFor(
      () => byText('.w1-wreviewnav button', '回到本周') !== undefined,
      1500
    )
    const previousWeekReadonly = await waitFor(
      () =>
        all('.w1-wreview .w1-dreviewopen').length === 0 &&
        byText('.w1-wreview .w1-dreviewactions .w1-btn', '顺延') === undefined,
      1500
    )
    const weekRangePrevious = weekRange()
    check(
      '本周回顾可切到上一周',
      previousWeekOpen && weekRangePrevious !== weekRangeBefore,
      weekRangeBefore + ' -> ' + weekRangePrevious
    )
    check(
      '上一周未完成只读不可顺延',
      previousWeekReadonly,
      String(all('.w1-wreview .w1-dreviewopen').length)
    )
    byText('.w1-wreviewnav button', '回到本周')?.click()
    const weekBack = await waitFor(() => weekRange() === weekRangeBefore, 1500)
    check('本周回顾可回到本周', weekBack, weekRange())
    byText('.w1-wreview .w1-btn.pri', '存为本周复盘')?.click()
    const weeklyClosed = await waitFor(() => !one('.w1-wreview'), 2500)
    const weeklyNoteSaved = await waitFor(async () => {
      const page = await window.ws.notes.page(0, 50, '复盘')
      return page.items.some((note) => note.text.includes('本周回顾'))
    }, 3000)
    const weeklyNote = weeklyNoteSaved
      ? (await window.ws.notes.page(0, 50, '复盘')).items.find((note) =>
          note.text.includes('本周回顾')
        )
      : undefined
    check(
      '本周复盘笔记落库',
      weeklyClosed &&
        Boolean(weeklyNote) &&
        weeklyNote.tag === '复盘' &&
        weeklyNote.text.includes('每日完成') &&
        weeklyNote.text.includes('周回顾顺延任务（本周到期 · 顺延到下周）'),
      weeklyNote ? weeklyNote.text.split('\\n')[0] : 'missing'
    )
    const weekFocusBack = await waitFor(() => document.activeElement === weekButton, 2500)
    check('本周回顾关闭后焦点回到入口', weekFocusBack, document.activeElement?.textContent ?? '')
    weekButton?.click()
    await waitFor(() => Boolean(one('.w1-wreview')), 2000)
    one('.w1-wreview')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    const weekEscClosed = await waitFor(() => !one('.w1-wreview'), 2000)
    check('本周回顾 Esc 可关闭', weekEscClosed, String(weekEscClosed))

    await navTo('任务')
    byText('.w1-todorow', '收集箱')?.click()
    await waitFor(() => (one('.w1-todorow.on')?.textContent ?? '').includes('收集箱'), 2000)
    const addInboxFixture = async (title) => {
      const input = one('.w1-todoinput')
      setValue(input, title)
      await sleep(80)
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      )
      return waitFor(
        async () => (await window.ws.tasks.list()).some((task) => task.title === title),
        2500
      )
    }
    const saveFixture = await addInboxFixture('整理保存任务')
    const deleteFixture = await addInboxFixture('整理删除任务')
    const triageEntryReady = await waitFor(() => Boolean(one('.w1-todointriage')), 2000)
    const triageEntry = one('.w1-todointriage')
    check('收集箱有整理入口', triageEntryReady, Boolean(saveFixture && deleteFixture))
    triageEntry?.click()
    const triageOpen = await waitFor(() => Boolean(one('.w1-triage')), 2500)
    check('收件箱整理面板可打开', triageOpen)
    const triageFocused = await waitFor(() => document.activeElement === one('.w1-triage'), 1200)
    check('整理面板焦点在对话框', triageFocused, document.activeElement?.className ?? '')
    check(
      '整理队列从最新收集任务开始',
      one('.w1-triagetitle')?.textContent === '整理删除任务',
      one('.w1-triagetitle')?.textContent ?? 'missing'
    )
    check(
      '整理显示进度',
      (one('.w1-triageprogress')?.textContent ?? '').includes('第') &&
        /1\\s*\\/\\s*\\d+/.test(one('.w1-triageprogress')?.textContent ?? ''),
      one('.w1-triageprogress')?.textContent ?? ''
    )
    one('.w1-triageactions .w1-tododelete')?.click()
    await sleep(100)
    check(
      '整理删除需要二次确认',
      (one('.w1-triageactions .w1-tododelete')?.textContent ?? '').includes('再次点击确认删除'),
      one('.w1-triageactions .w1-tododelete')?.textContent ?? ''
    )
    one('.w1-triageactions .w1-tododelete')?.click()
    const triageDeleted = await waitFor(async () => {
      const list = await window.ws.tasks.list()
      return !list.some((task) => task.title === '整理删除任务')
    }, 3000)
    check('整理删除任务落库', triageDeleted)
    const triageNext = await waitFor(
      () => one('.w1-triagetitle')?.textContent === '整理保存任务',
      2000
    )
    check('整理删除后进入下一条', triageNext, one('.w1-triagetitle')?.textContent ?? 'missing')
    setValue(one('#triage-list'), '工作')
    byText('.w1-triagecard .w1-tododatequick button', '明天')?.click()
    byText('.w1-triagecard .w1-todopriopt', '高')?.click()
    const triageTomorrow = (() => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      const pad = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    })()
    const triageSaveReady = await waitFor(
      () => byText('.w1-triageactions .w1-pb.pri', '保存并下一条') !== undefined,
      1500
    )
    check('整理字段改动可保存', triageSaveReady)
    one('#triage-list')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    const triageComboClosed = await waitFor(() => !one('.w1-pop'), 1200)
    check('整理清单下拉 Esc 可关闭', triageComboClosed)
    if (window.__WS_SMOKE_TRIAGE_SHOT__) {
      const previousTheme = document.documentElement.dataset.theme
      const previousStoredTheme = localStorage.getItem('workstation.theme')
      if (window.__WS_SMOKE_TRIAGE_THEME__ === 'light') {
        document.documentElement.dataset.theme = 'light'
        localStorage.setItem('workstation.theme', 'light')
        await sleep(400)
      }
      console.log('SMOKE_TRIAGE_SHOT')
      await sleep(1200)
      if (window.__WS_SMOKE_TRIAGE_THEME__ === 'light') {
        if (previousTheme) document.documentElement.dataset.theme = previousTheme
        else document.documentElement.removeAttribute('data-theme')
        if (previousStoredTheme === null) localStorage.removeItem('workstation.theme')
        else localStorage.setItem('workstation.theme', previousStoredTheme)
        await sleep(300)
      }
    }
    byText('.w1-triageactions .w1-pb.pri', '保存并下一条')?.click()
    const triageSaved = await waitFor(async () => {
      const task = (await window.ws.tasks.list()).find((item) => item.title === '整理保存任务')
      return task?.list === '工作' && task?.dueDate === triageTomorrow && task?.priority === 1
    }, 3000)
    check(
      '整理保存清单 / 日期 / 优先级',
      triageSaved,
      triageTomorrow
    )
    let triageSkips = 0
    while (triageSkips < 12 && one('.w1-triage') && !one('.w1-triagefinish')) {
      const skip = byText('.w1-triageactions .w1-pb', '留到以后')
      if (!skip) break
      skip.click()
      triageSkips += 1
      await sleep(100)
    }
    const triageFinished = await waitFor(() => Boolean(one('.w1-triagefinish')), 2000)
    check(
      '整理完成显示汇总',
      triageFinished && (one('.w1-triagefinish')?.textContent ?? '').includes('整理完成'),
      one('.w1-triagefinish')?.textContent?.slice(0, 80) ?? 'missing'
    )
    byText('.w1-triagefinish .w1-pb', '完成')?.click()
    const triageClosed = await waitFor(() => !one('.w1-triage'), 2000)
    check('整理关闭后回到收集箱', triageClosed)
    const triageFocusBack = await waitFor(
      () => document.activeElement?.classList.contains('w1-todointriage'),
      2000
    )
    check('整理关闭后焦点回到入口', triageFocusBack, document.activeElement?.textContent ?? '')

    return { checks, title: document.title, size: [innerWidth, innerHeight], activeView: activeNav() }
  })()`)
  } catch (error) {
    console.error(`[smoke] renderer script failed: ${error}`)
    const snapshot = await win.webContents
      .executeJavaScript(
        '({ progress: window.__smokeProgress ?? [], root: document.getElementById("root")?.textContent?.slice(0, 120) ?? null, scripts: [...document.scripts].map((s) => s.src) })'
      )
      .catch((snapshotError) => String(snapshotError))
    console.error(JSON.stringify({ consoleErrors, snapshot }, null, 2))
    fail()
    return
  }

  results.checks.push(...(await runCaptureChecks(win)))
  results.checks.push({
    name: 'HTTP 外部 MCP 请求头解密后透传',
    ok: mcpHttpRequests.some(
      (item) => item.method === 'tools/list' && item.session === 'smoke-http-session'
    ),
    detail: JSON.stringify(mcpHttpRequests.slice(0, 8))
  })

  // 主进程侧的证据：这一轮 UI 操作必须真的落进 SQLite。
  const dbFile = join(dataDir, 'db', 'workstation.db')
  let dbStats = null
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbFile, { readOnly: true })
    const count = (sql) => Number(db.prepare(sql).get().n)
    dbStats = {
      tasks: count('SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL'),
      notes: count('SELECT COUNT(*) AS n FROM notes'),
      learning: count('SELECT COUNT(*) AS n FROM learning_items'),
      reviews: count('SELECT COUNT(*) AS n FROM learning_reviews'),
      links: count('SELECT COUNT(*) AS n FROM note_links'),
      fsrs: count('SELECT COUNT(*) AS n FROM learning_items WHERE stability IS NOT NULL'),
      agentSessions: count('SELECT COUNT(*) AS n FROM agent_sessions'),
      agentMessages: count('SELECT COUNT(*) AS n FROM agent_messages'),
      importedMessages: count("SELECT COUNT(*) AS n FROM agent_messages WHERE origin = 'import'"),
      importedTools: count(
        "SELECT COUNT(*) AS n FROM agent_messages WHERE origin = 'import' AND tools_json IS NOT NULL"
      ),
      agentResume: count('SELECT COUNT(*) AS n FROM agent_sessions WHERE resume_id IS NOT NULL'),
      codexSessions: count("SELECT COUNT(*) AS n FROM agent_sessions WHERE agent = 'codex'"),
      codexResume: count(
        "SELECT COUNT(*) AS n FROM agent_sessions WHERE agent = 'codex' AND resume_id IS NOT NULL"
      ),
      agentWorkspaces: count("SELECT COUNT(*) AS n FROM agent_sessions WHERE workspace <> ''"),
      agentRuns: count('SELECT COUNT(*) AS n FROM agent_runs'),
      toolCallsObserved: count(
        "SELECT COUNT(*) AS n FROM agent_tool_calls WHERE decision = 'observed'"
      ),
      toolCallsApproval: count(
        "SELECT COUNT(*) AS n FROM agent_tool_calls WHERE kind = 'approval'"
      ),
      contextDigests: count("SELECT COUNT(*) AS n FROM agent_sessions WHERE context_digest <> ''"),
      plugins: count('SELECT COUNT(*) AS n FROM agent_plugins'),
      mcpServers: count('SELECT COUNT(*) AS n FROM mcp_servers'),
      mcpHttp: count("SELECT COUNT(*) AS n FROM mcp_servers WHERE transport = 'http'"),
      mcpHttpTools: count(
        "SELECT COUNT(*) AS n FROM mcp_server_tools WHERE server_id IN (SELECT id FROM mcp_servers WHERE transport = 'http')"
      ),
      mcpAudit: count("SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp'"),
      mcpWrites: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND action = 'write'"
      ),
      mcpPolicy: count('SELECT COUNT(*) AS n FROM mcp_domain_modes'),
      mcpTask: count(
        "SELECT COUNT(*) AS n FROM tasks WHERE title = 'MCP 写入测试' AND deleted_at IS NULL"
      ),
      mcpApprovalTask: count(
        "SELECT COUNT(*) AS n FROM tasks WHERE title = 'MCP 审批写入' AND deleted_at IS NULL"
      ),
      mcpApproveAudit: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND action = 'approve'"
      ),
      mcpAutoTask: count(
        "SELECT COUNT(*) AS n FROM tasks WHERE title = 'MCP 自动写入' AND deleted_at IS NULL"
      ),
      approvalRules: count('SELECT COUNT(*) AS n FROM approval_rules'),
      approvalRuleAudit: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'system' AND detail LIKE 'approval-rule:%'"
      ),
      approvalRuleRevokeAudit: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'system' AND action = 'settings' AND detail LIKE 'approval-rule:revoke%'"
      ),
      autoApproveAudit: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND action = 'approve' AND detail = 'auto:workspace'"
      ),
      claudeAutoApproveAudit: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND action = 'approve' AND detail = 'auto:workspace' AND title LIKE 'mcp__%'"
      ),
      codexAutoApproveAudit: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND action = 'approve' AND detail = 'auto:workspace' AND title LIKE 'MCP · %'"
      ),
      mcpAuditLeak: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND (detail LIKE '%Bearer%' OR detail LIKE '%token%')"
      ),
      providers: count('SELECT COUNT(*) AS n FROM provider_profiles'),
      providerTokens: count(
        'SELECT COUNT(*) AS n FROM provider_profiles WHERE token_encrypted IS NOT NULL'
      ),
      providerActive: count('SELECT COUNT(*) AS n FROM provider_profiles WHERE active = 1')
    }
    db.close()
  } catch (error) {
    console.error(`[smoke] 读取临时数据库失败：${error}`)
  }
  const dbReady = Boolean(
    dbStats && dbStats.tasks > 0 && dbStats.notes > 0 && dbStats.learning > 0 && dbStats.reviews > 0
  )
  results.checks.push({
    name: '笔记双链已落库',
    ok: Boolean(dbStats && dbStats.links > 0),
    detail: dbStats ? String(dbStats.links) : '无数据'
  })
  results.checks.push({
    name: 'FSRS 状态已落库',
    ok: Boolean(dbStats && dbStats.fsrs > 0),
    detail: dbStats ? String(dbStats.fsrs) : '无数据'
  })
  results.checks.push({
    name: '智能体会话与消息已落库',
    ok: Boolean(dbStats && dbStats.agentSessions >= 2 && dbStats.agentMessages >= 10),
    detail: dbStats ? `${dbStats.agentSessions} 会话 / ${dbStats.agentMessages} 条` : '无数据'
  })
  results.checks.push({
    name: 'Claude 与 Codex 的 resume id 已保存',
    ok: Boolean(dbStats && dbStats.agentResume >= 2),
    detail: dbStats ? String(dbStats.agentResume) : '无数据'
  })
  results.checks.push({
    name: 'Codex 会话与 resume id 已落库',
    ok: Boolean(dbStats && dbStats.codexSessions === 1 && dbStats.codexResume === 1),
    detail: dbStats ? `${dbStats.codexSessions} 会话 / resume ${dbStats.codexResume}` : '无数据'
  })
  results.checks.push({
    name: 'Agent 会话工作区已落库',
    ok: Boolean(dbStats && dbStats.agentWorkspaces >= 2),
    detail: dbStats ? String(dbStats.agentWorkspaces) : '无数据'
  })
  results.checks.push({
    name: '导入历史消息已落库',
    ok: Boolean(dbStats && dbStats.importedMessages > 0 && dbStats.importedTools > 0),
    detail: dbStats ? `${dbStats.importedMessages} 条 / 工具卡 ${dbStats.importedTools}` : '无数据'
  })
  results.checks.push({
    name: 'Agent 运行用量已落库',
    ok: Boolean(dbStats && dbStats.agentRuns > 0),
    detail: dbStats ? String(dbStats.agentRuns) : '无数据'
  })
  results.checks.push({
    name: '评估落痕记录工具调用与审批决策',
    ok: Boolean(dbStats && dbStats.toolCallsObserved > 0 && dbStats.toolCallsApproval > 0),
    detail: dbStats
      ? `observed ${dbStats.toolCallsObserved} / approval ${dbStats.toolCallsApproval}`
      : '无数据'
  })
  results.checks.push({
    name: '长会话回合后写入滚动摘要',
    ok: Boolean(dbStats && dbStats.contextDigests > 0),
    detail: dbStats ? String(dbStats.contextDigests) : '无数据'
  })
  results.checks.push({
    name: '能力中心插件与 MCP 已落库',
    ok: Boolean(
      dbStats &&
        dbStats.plugins === 1 &&
        dbStats.mcpServers === 2 &&
        dbStats.mcpHttp === 1 &&
        dbStats.mcpHttpTools === 2
    ),
    detail: dbStats
      ? `${dbStats.plugins} 插件 / ${dbStats.mcpServers} MCP / HTTP 工具 ${dbStats.mcpHttpTools}`
      : '无数据'
  })
  let codexConfig = ''
  try {
    codexConfig = readFileSync(join(dataDir, 'db', 'codex-home', 'config.toml'), 'utf8')
  } catch {
    // 没有 Codex Provider 运行过就没有配置文件，下面按失败断言
  }
  const codexExternalReady =
    codexConfig.includes('[mcp_servers.workstationforone]') &&
    codexConfig.includes('[mcp_servers.memory]') &&
    codexConfig.includes('default_tools_approval_mode = "prompt"') &&
    !codexConfig.includes('sk-smoke-codex-secret')
  results.checks.push({
    name: 'Codex Provider 配置下发外部 MCP 且不含密钥值',
    ok: codexExternalReady,
    detail: codexExternalReady
      ? 'memory + workstationforone'
      : codexConfig.slice(0, 160) || '无配置'
  })
  results.checks.push({
    name: 'MCP 调用已写审计',
    ok: Boolean(dbStats && dbStats.mcpAudit > 0),
    detail: dbStats ? String(dbStats.mcpAudit) : '无数据'
  })
  results.checks.push({
    name: 'MCP 写入任务与审计已落库',
    ok: Boolean(dbStats && dbStats.mcpTask === 1 && dbStats.mcpWrites > 0),
    detail: dbStats ? `task ${dbStats.mcpTask} / write ${dbStats.mcpWrites}` : '无数据'
  })
  results.checks.push({
    name: 'MCP 审批写入与决定已落库',
    ok: Boolean(dbStats && dbStats.mcpApprovalTask === 1 && dbStats.mcpApproveAudit > 0),
    detail: dbStats
      ? `task ${dbStats.mcpApprovalTask} / approve ${dbStats.mcpApproveAudit}`
      : '无数据'
  })
  results.checks.push({
    name: '工作区规则自动写入已落库',
    ok: Boolean(dbStats && dbStats.mcpAutoTask === 1 && dbStats.autoApproveAudit > 0),
    detail: dbStats ? `task ${dbStats.mcpAutoTask} / auto ${dbStats.autoApproveAudit}` : '无数据'
  })
  results.checks.push({
    name: '审批规则已撤销且审计留痕',
    ok: Boolean(
      dbStats &&
        dbStats.approvalRules === 0 &&
        dbStats.approvalRuleAudit > 0 &&
        dbStats.approvalRuleRevokeAudit >= 2
    ),
    detail: dbStats
      ? `rules ${dbStats.approvalRules} / audit ${dbStats.approvalRuleAudit} / revoke ${dbStats.approvalRuleRevokeAudit}`
      : '无数据'
  })
  results.checks.push({
    name: 'Claude 桥工作区自动批准已审计',
    ok: Boolean(dbStats && dbStats.claudeAutoApproveAudit > 0),
    detail: dbStats ? String(dbStats.claudeAutoApproveAudit) : '无数据'
  })
  results.checks.push({
    name: 'Codex MCP 规则自动批准已审计',
    ok: Boolean(dbStats && dbStats.codexAutoApproveAudit > 0),
    detail: dbStats ? String(dbStats.codexAutoApproveAudit) : '无数据'
  })
  results.checks.push({
    name: 'MCP 域权限默认值已落库',
    ok: Boolean(dbStats && dbStats.mcpPolicy === 4),
    detail: dbStats ? String(dbStats.mcpPolicy) : '无数据'
  })
  results.checks.push({
    name: 'MCP 审计不含 token',
    ok: Boolean(dbStats && dbStats.mcpAuditLeak === 0),
    detail: dbStats ? String(dbStats.mcpAuditLeak) : '无数据'
  })
  results.checks.push({
    name: 'Provider 配置与加密 Key 已落库',
    ok: Boolean(
      dbStats && dbStats.providers > 0 && dbStats.providerTokens > 0 && dbStats.providerActive === 0
    ),
    detail: dbStats
      ? `${dbStats.providers} 条 / token ${dbStats.providerTokens} / active ${dbStats.providerActive}`
      : '无数据'
  })
  // 审计：UI 操作必须留下记录（这里读库，不依赖渲染层）
  // 按动作查而不是只取最近 N 条：后续新增审计类型会把早期记录挤出窗口，
  // 那样失败反映的是窗口大小，不是功能回归。
  let auditRows = []
  try {
    const { DatabaseSync } = require('node:sqlite')
    const auditDb = new DatabaseSync(dbFile, { readOnly: true })
    auditRows = auditDb
      .prepare(
        `SELECT domain, action, title FROM audit_log
         WHERE (domain = 'task' AND action IN ('create', 'complete'))
            OR (domain = 'note' AND action = 'create')
            OR (domain = 'habit' AND action = 'checkin')
         ORDER BY id DESC`
      )
      .all()
    const total = auditDb.prepare('SELECT COUNT(*) AS n FROM audit_log').get()
    auditRows.total = total?.n ?? 0
    auditDb.close()
  } catch (error) {
    console.error(`[smoke] 读取审计失败：${error}`)
  }
  const auditHas = (domain, action) =>
    auditRows.some((row) => row.domain === domain && row.action === action)
  results.checks.push({
    name: '审计记录任务新增与完成',
    ok: auditHas('task', 'create') && auditHas('task', 'complete'),
    detail: `匹配 ${auditRows.length} 条 / 全库 ${auditRows.total ?? 0} 条`
  })
  results.checks.push({
    name: '审计记录笔记与习惯写入',
    ok: auditHas('note', 'create') && auditHas('habit', 'checkin'),
    detail: auditRows
      .slice(0, 6)
      .map((row) => `${row.domain}:${row.action}`)
      .join(', ')
  })

  let reminderLines = []
  try {
    const { readFileSync } = require('node:fs')
    reminderLines = readFileSync(reminderLog, 'utf8')
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    reminderLines = []
  }
  results.checks.push({
    name: '到点提醒真的触发并落日志',
    ok: reminderLines.some((line) => line.includes('提醒测试')),
    detail: reminderLines.join(' / ') || 'empty'
  })

  let attentionLines = []
  try {
    const { readFileSync } = require('node:fs')
    attentionLines = readFileSync(attentionLog, 'utf8')
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    attentionLines = []
  }
  results.checks.push({
    name: '后台审批与问答通知已触发',
    ok:
      attentionLines.some((line) => line.startsWith('permission ')) &&
      attentionLines.some((line) => line.startsWith('question ')) &&
      attentionLines.some((line) => line.includes('tasks_create')),
    detail: attentionLines.slice(0, 4).join(' / ') || 'empty'
  })

  let backupFiles = []
  try {
    const { readdirSync } = require('node:fs')
    backupFiles = readdirSync(join(dataDir, 'db', 'backups')).filter((name) => name.endsWith('.db'))
  } catch (error) {
    console.error(`[smoke] 读取备份目录失败：${error}`)
  }
  // 长会话窗口：写入 80 条消息后重载，确认只挂最近 60 条，滚到顶部自动补上更早一批。
  try {
    await win.webContents.executeJavaScript(`(async () => {
      const session = await window.ws.agent.createSession({
        id: 's-smoke-long',
        agent: 'claude',
        title: '长会话验证'
      })
      const now = Date.now()
      for (let index = 0; index < 80; index += 1) {
        await window.ws.agent.saveMessage({
          id: 'smoke-long-' + index,
          sessionId: session.id,
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: '长会话消息 ' + index,
          timeLabel: '刚刚',
          createdAt: now + index
        })
      }
      return true
    })()`)
    const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve))
    win.webContents.reload()
    await reloaded
    await sleep(2600)
    const longThread = await win.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const all = (selector) => [...document.querySelectorAll(selector)]
      const byText = (selector, text) => all(selector).find((el) => el.textContent.includes(text))
      const waitFor = async (fn, timeout = 5000) => {
        const started = Date.now()
        while (Date.now() - started < timeout) {
          if (await fn()) return true
          await sleep(100)
        }
        return false
      }
      const nav = all('.w1-navitem').find(
        (el) => el.querySelector('.w1-navtext b')?.textContent?.trim() === 'Agent'
      )
      nav?.click()
      await waitFor(() => Boolean(byText('.w1-sess', '长会话验证')))
      byText('.w1-sess', '长会话验证')?.click()
      await sleep(1500)
      const countMessages = () => all('.w1-umsg, .w1-amsg').length
      const before = countMessages()
      const more = byText('.w1-threadmore', '还有')
      const moreText = more?.textContent ?? ''
      ${threadShot ? "console.log('SMOKE_THREAD_SHOT'); await sleep(5000)" : ''}
      const thread = document.querySelector('.w1-thread')
      if (thread) thread.scrollTop = 0
      thread?.dispatchEvent(new Event('scroll', { bubbles: true }))
      await sleep(250)
      const loaderAfterScroll = all('.w1-threadmore').length > 0
      const loadedMore = await waitFor(() => countMessages() === 80)
      // 回复收进笔记 / 任务：按钮在助手消息的 meta 行
      const agentTagCount = async () => {
        const tags = await window.ws.notes.tags()
        return tags.tags.find((row) => row.tag === 'Agent')?.count ?? 0
      }
      const noteBefore = await agentTagCount()
      const tasksBefore = await window.ws.tasks.list()
      const beforeTaskIds = new Set(tasksBefore.map((task) => task.id))
      const noteButton = all('.w1-amsg .w1-capture').find((button) =>
        (button.textContent ?? '').includes('存为笔记')
      )
      noteButton?.click()
      const noteSaved = await waitFor(async () => (await agentTagCount()) === noteBefore + 1, 3000)
      const noteToast = document.querySelector('.w1-toast')?.textContent ?? ''
      const taskButton = all('.w1-amsg .w1-capture').find((button) =>
        (button.textContent ?? '').includes('建任务')
      )
      taskButton?.click()
      const taskSaved = await waitFor(
        async () => (await window.ws.tasks.list()).length === tasksBefore.length + 1,
        3000
      )
      const capturedTask = (await window.ws.tasks.list()).find((task) => !beforeTaskIds.has(task.id))
      // 任务 / 笔记交给 Agent：只预填输入栏，不自动发送
      const taskNav = all('.w1-navitem').find(
        (el) => el.querySelector('.w1-navtext b')?.textContent?.trim() === '任务'
      )
      taskNav?.click()
      await waitFor(() => all('.w1-todorowwrap').length > 0, 3000)
      // 懒加载的 Agent 视图可能还在退场；等它卸载后再读任务行，避免把手交接到旧 Composer。
      await waitFor(() => !document.querySelector('#composer-input'), 3000)
      const firstTaskRow = all('.w1-todorowwrap')[0]
      const firstTaskTitle =
        firstTaskRow?.querySelector('.w1-todotitletext')?.textContent?.trim() ?? ''
      firstTaskRow?.querySelector('.w1-todobody')?.click()
      await waitFor(() => Boolean(document.querySelector('.w1-todohand')), 2500)
      document.querySelector('.w1-todohand')?.click()
      const taskHandoff = await waitFor(() => {
        const input = document.querySelector('#composer-input')
        return Boolean(input) && (input.value ?? '').includes('标题：' + firstTaskTitle)
      }, 3000)
      const agentViewAfterTask = await waitFor(
        () =>
          document.querySelector('.w1-navitem.on .w1-navtext b')?.textContent?.trim() === 'Agent',
        3000
      )
      // 选工作区会让 Composer 重挂载；提示词要能重新填回来
      const workspaceGate = document.querySelector('.w1-aworkspacegate .w1-pb')
      if (workspaceGate) workspaceGate.click()
      await waitFor(() => document.querySelector('#composer-input')?.disabled === false, 5000)
      const taskHandoffKept = await waitFor(() => {
        const input = document.querySelector('#composer-input')
        return Boolean(input) && (input.value ?? '').includes('标题：' + firstTaskTitle)
      }, 3000)
      const notesNav = all('.w1-navitem').find(
        (el) => el.querySelector('.w1-navtext b')?.textContent?.trim() === '笔记'
      )
      notesNav?.click()
      await waitFor(() => all('.w1-nvrowbtn').length > 0, 4000)
      all('.w1-nvrowbtn')[0]?.click()
      await waitFor(() => Boolean(document.querySelector('.w1-notedetail')), 2500)
      const handoffButton = [...document.querySelectorAll('.w1-notedetail .w1-pb')].find((b) =>
        (b.textContent ?? '').includes('交给 Agent')
      )
      handoffButton?.click()
      await waitFor(() => Boolean(byText('.w1-nlhandoff .w1-pb', '总结')), 1500)
      byText('.w1-nlhandoff .w1-pb', '总结')?.click()
      const noteHandoff = await waitFor(() => {
        const input = document.querySelector('#composer-input')
        return Boolean(input) && (input.value ?? '').includes('请总结下面这篇笔记')
      }, 3000)
      return {
        checks: [
          { name: '长会话只渲染最近窗口', ok: before === 60, detail: String(before) },
          {
            name: '顶部显示更早消息入口',
            ok: Boolean(more) && moreText.includes('还有 20 条'),
            detail: moreText
          },
          {
            name: '滚到顶部自动加载更早消息',
            ok: loadedMore,
            detail:
              String(countMessages()) +
              ' | top=' +
              String(thread?.scrollTop) +
              ' sh=' +
              String(thread?.scrollHeight) +
              ' ch=' +
              String(thread?.clientHeight) +
              ' loader=' +
              String(loaderAfterScroll)
          },
          {
            name: '回复可存为笔记',
            ok: noteSaved && noteToast.includes('已存为笔记'),
            detail: noteToast
          },
          {
            name: '回复可建任务',
            ok:
              taskSaved &&
              Boolean(capturedTask) &&
              capturedTask.title.length > 0 &&
              capturedTask.notes.length > 0,
            detail: capturedTask ? capturedTask.title.slice(0, 40) : 'missing'
          },
          {
            name: '任务可交给 Agent（只预填）',
            ok: taskHandoff && agentViewAfterTask && taskHandoffKept,
            detail: firstTaskTitle + ' | ' + agentViewAfterTask + ' | 保留 ' + taskHandoffKept
          },
          {
            name: '笔记可交给 Agent（总结）',
            ok: noteHandoff,
            detail: noteHandoff ? '预填成功' : 'missing'
          }
        ]
      }
    })()`)
    results.checks.push(...longThread.checks)
  } catch (error) {
    results.checks.push({ name: '长会话窗口验证', ok: false, detail: String(error) })
  }

  // Provider 错误驱动降级：两个 claude 配置时，错误卡提供「换备用重试」，点击切换激活并重试。
  try {
    const routing = await win.webContents.executeJavaScript(`(async () => {
      const WS = ${JSON.stringify(agentWorkspace)};
      const checks = []
      const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const byText = (sel, text) =>
        [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(text))
      const waitFor = async (fn, timeout = 4000) => {
        const started = Date.now()
        while (Date.now() - started < timeout) {
          try { if (await fn()) return true } catch {}
          await sleep(120)
        }
        return false
      }
      const list0 = await window.ws.provider.list()
      const claude0 = list0.filter((p) => p.target === 'claude')
      const second = await window.ws.provider.save({
        name: '备用冒烟', target: 'claude', wireApi: 'responses',
        baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', priority: 5
      })
      await window.ws.provider.setActive('claude', claude0[0]?.id ?? null)
      const fb = await window.ws.provider.fallbackFor('claude')
      check('fallbackFor 返回非激活备用', !!fb && fb.id === second.id, fb ? fb.name : 'null')
      const list1 = await window.ws.provider.list()
      const savedSecond = list1.find((p) => p.id === second.id)
      check('备用优先级落库', savedSecond?.priority === 5, String(savedSecond?.priority))
      await window.ws.provider.setActive('claude', null)
      return { checks }
    })()`)
    results.checks.push(...routing.checks)
  } catch (error) {
    results.checks.push({ name: 'Provider 降级验证', ok: false, detail: String(error) })
  }

  // 多智能体编排地基：建团队（负责人 + worker）共享 teamId，黑板读写落库。
  try {
    const team = await win.webContents.executeJavaScript(`(async () => {
      const checks = []
      const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
      const WS = ${JSON.stringify(agentWorkspace)}
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const all = (sel) => [...document.querySelectorAll(sel)]
      const one = (sel) => document.querySelector(sel)
      const byText = (sel, text) => all(sel).find((el) => el.textContent.includes(text))
      const waitFor = async (fn, timeout = 3000) => {
        const started = Date.now()
        while (Date.now() - started < timeout) {
          try { if (await fn()) return true } catch {}
          await sleep(120)
        }
        return false
      }
      const created = await window.ws.agent.createTeam({
        name: '冒烟小队',
        workspace: WS,
        workers: [
          { title: '冒烟 worker A', persona: '你是 A' },
          { title: '冒烟 worker B' }
        ]
      })
      check('建团队得到负责人与 worker', created.sessions.length === 3, String(created.sessions.length))
      const teams = await window.ws.agent.listTeams()
      const found = teams.find((t) => t.teamId === created.teamId)
      check(
        '团队会话共享 teamId 与工作区',
        !!found &&
          found.sessions.length === 3 &&
          found.sessions.every((s) => s.teamId === created.teamId && s.workspace === WS),
        String(found?.sessions.length ?? 0)
      )
      const leader = created.sessions[0]
      await window.ws.agent.postTeamNote(created.teamId, leader.id, 'user', '黑板第一条')
      await window.ws.agent.postTeamNote(created.teamId, created.sessions[1].id, 'assistant', '黑板第二条')
      const notes = await window.ws.agent.teamNotes(created.teamId)
      check(
        '团队黑板按时间读写',
        notes.length === 2 && notes[0].text === '黑板第一条' && notes[1].role === 'assistant',
        String(notes.length)
      )
      const lm0 = await window.ws.agent.getLocalModel()
      check('本地模型默认关闭', lm0.enabled === false && lm0.baseUrl === '', JSON.stringify(lm0))
      let rejected = false
      try {
        await window.ws.agent.setLocalModel({
          baseUrl: 'https://api.example.com',
          model: 'm',
          enabled: true
        })
      } catch {
        rejected = true
      }
      check('本地模型拒绝非回环地址', rejected, String(rejected))
      const lm1 = await window.ws.agent.setLocalModel({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen2.5:7b',
        enabled: true
      })
      check(
        '本地模型配置落库',
        lm1.enabled === true && lm1.model === 'qwen2.5:7b',
        JSON.stringify(lm1)
      )
      await window.ws.agent.setLocalModel({
        baseUrl: lm1.baseUrl,
        model: lm1.model,
        enabled: false
      })
      const threads = await window.ws.agent.threads()
      let source = null
      for (const session of threads.sessions) {
        const messages = await window.ws.agent.thread(session.id)
        const hit = messages.find(
          (m) => m.role === 'assistant' && !m.error && (m.tools?.length ?? 0) > 0
        )
        if (hit) {
          source = { sessionId: session.id, messageId: hit.id }
          break
        }
      }
      const evolved = source
        ? await window.ws.agent.evolveExpert(source.sessionId, source.messageId)
        : null
      const expertList = await window.ws.experts.list()
      check(
        '成功回合可提炼为专家',
        !!evolved && expertList.some((e) => e.id === evolved.id && !e.builtin),
        evolved ? evolved.name : 'missing'
      )
      // 舰队「团队」面板：列表 + 打开黑板
      one('.w1-st-fleet')?.click()
      await waitFor(() => !!one('.w1-fleetsheet'), 2000)
      byText('.w1-fleetheadmeta .w1-capmini', '团队')?.click()
      const teamRow = await waitFor(
        () => all('.w1-teamrow').some((row) => row.textContent.includes('冒烟小队')),
        3000
      )
      check(
        '团队面板列出团队',
        teamRow,
        String(all('.w1-teamrow').length) + ' 行'
      )
      all('.w1-teamrow')
        .find((row) => row.textContent.includes('冒烟小队'))
        ?.click()
      const boardReady = await waitFor(
        () => !!one('.w1-teamboard') && (one('.w1-teamboard')?.textContent ?? '').includes('黑板'),
        2000
      )
      check(
        '团队黑板面板可打开',
        boardReady && (one('.w1-teammember')?.textContent ?? '').includes('负责人'),
        boardReady ? 'ok' : 'missing'
      )
      one('.w1-fleetclose')?.click()
      await waitFor(() => !one('.w1-fleetsheet'), 2000)
      return { checks }
    })()`)
    results.checks.push(...team.checks)
  } catch (error) {
    results.checks.push({ name: '多智能体编排验证', ok: false, detail: String(error) })
  }

  // 专家与轻量市场：放在所有会话 / 用量 / dbStats 断言之后，新增会话不干扰前面计数。
  try {
    const experts = await win.webContents.executeJavaScript(`(async () => {
      const EXPERT_SRC = ${JSON.stringify(expertSourceDir)};
      const checks = []
      const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const all = (sel) => [...document.querySelectorAll(sel)]
      const one = (sel) => document.querySelector(sel)
      const byText = (sel, text) => all(sel).find((el) => el.textContent.includes(text))
      const setValue = (el, value) => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const waitFor = async (fn, timeout = 3000) => {
        const started = Date.now()
        while (Date.now() - started < timeout) {
          try { if (await fn()) return true } catch {}
          await sleep(120)
        }
        return false
      }
      one('.w1-st-fleet')?.click()
      await waitFor(() => !!one('.w1-fleetsheet'), 2000)
      byText('.w1-fleetheadmeta .w1-capmini', '专家')?.click()
      const expertsReady = await waitFor(() => all('.w1-explist .w1-exprow').length >= 4, 3000)
      check(
        '专家区渲染内置专家',
        expertsReady &&
          (one('.w1-experts')?.textContent ?? '').includes('前端专家') &&
          (one('.w1-experts')?.textContent ?? '').includes('Go/Rust 后端专家'),
        String(all('.w1-explist .w1-exprow').length) + ' 行'
      )
      byText('.w1-experts .w1-capmini', '新建专家')?.click()
      const formReady = await waitFor(() => !!one('.w1-expform'), 2000)
      setValue(one('.w1-expform .w1-expfield input'), '冒烟专家')
      setValue(one('.w1-expform textarea'), '你是冒烟测试专家。')
      byText('.w1-expformops .w1-capmini', '保存专家')?.click()
      const saved = await waitFor(
        () => all('.w1-explist .w1-exprow').some((r) => r.textContent?.includes('冒烟专家')),
        3000
      )
      const persisted = (await window.ws.experts.list()).find((e) => e.name === '冒烟专家')
      check(
        '自定义专家新建并落库',
        formReady && saved && !!persisted && persisted.builtin === false,
        persisted ? persisted.id : 'missing'
      )
      byText('.w1-experts .w1-capmini', '市场')?.click()
      const marketReady = await waitFor(() => !!one('.w1-expmarket'), 2000)
      await waitFor(() => {
        const btn = byText('.w1-expsrcform .w1-capmini', '添加源')
        return !!btn && !btn.disabled
      }, 3000)
      const srcInputs = all('.w1-expsrcform input')
      setValue(srcInputs[0], 'smoke-src')
      setValue(srcInputs[1], EXPERT_SRC)
      byText('.w1-expsrcform .w1-capmini', '添加源')?.click()
      const listed = await waitFor(
        () => all('.w1-expentrylist .w1-exprow').some((r) => r.textContent?.includes('smoke-reviewer')),
        4000
      )
      check(
        '市场源添加并扫描出条目（跳过非专家 md）',
        marketReady && listed && all('.w1-expentrylist .w1-exprow').length === 1,
        String(all('.w1-expentrylist .w1-exprow').length) +
          ' 条目 / ' +
          String(all('.w1-expsrcrow').length) +
          ' 源 / global=' +
          String(EXPERT_SRC) +
          ' / url=' +
          (all('.w1-expsrcform input')[1]?.value ?? '') +
          ' / name=' +
          (all('.w1-expsrcform input')[0]?.value ?? '')
      )
      all('.w1-expentrylist .w1-exprow')
        .find((r) => r.textContent?.includes('smoke-reviewer'))
        ?.querySelector('.w1-fleetopen')?.click()
      const imported = await waitFor(
        async () => (await window.ws.experts.list()).some((e) => e.id === 'smoke-reviewer'),
        3000
      )
      check('市场专家一键导入落库', imported, String(imported))
      all('.w1-explist .w1-exprow')
        .find((r) => r.textContent?.includes('冒烟专家'))
        ?.querySelector('.w1-expops .w1-fleetopen')?.click()
      const personaSession = await waitFor(
        async () =>
          (await window.ws.agent.sessions()).sessions.some((s) => s.persona === '你是冒烟测试专家。'),
        3000
      )
      check('专家新建会话携带人设快照', personaSession, String(personaSession))
      // 等舰队退出动画结束再重开，避免复用旧实例把「专家」开关反向关掉
      await waitFor(() => !one('.w1-fleetsheet'), 2000)
      one('.w1-st-fleet')?.click()
      await waitFor(() => !!one('.w1-fleetsheet'), 2000)
      byText('.w1-fleetheadmeta .w1-capmini', '专家')?.click()
      await waitFor(() => all('.w1-explist .w1-exprow').length >= 4, 2000)
      all('.w1-explist .w1-exprow')
        .find((r) => r.textContent?.includes('冒烟专家'))
        ?.querySelector('.w1-fleetarchive')?.click()
      await waitFor(
        () =>
          all('.w1-explist .w1-exprow')
            .find((r) => r.textContent?.includes('冒烟专家'))
            ?.querySelector('.w1-fleetarchive')
            ?.textContent?.includes('确认删除'),
        2000
      )
      all('.w1-explist .w1-exprow')
        .find((r) => r.textContent?.includes('冒烟专家'))
        ?.querySelector('.w1-fleetarchive')?.click()
      const removed = await waitFor(
        async () => !(await window.ws.experts.list()).some((e) => e.name === '冒烟专家'),
        3000
      )
      const delNames = (await window.ws.experts.list()).map((e) => e.name).join(',')
      check(
        '自定义专家两段确认删除',
        removed,
        String(removed) +
          ' / db=' +
          delNames +
          ' / panel=' +
          all('.w1-explist .w1-exprow')
            .map((r) => (r.textContent ?? '').slice(0, 10))
            .join('|')
      )
      one('.w1-fleetclose')?.click()
      return { checks }
    })()`)
    results.checks.push(...experts.checks)
  } catch (error) {
    results.checks.push({ name: '专家与市场验证', ok: false, detail: String(error) })
  }

  const failed = results.checks.filter((check) => !check.ok)
  const failures = failed.length + (dbReady ? 0 : 1) + (backupFiles.length > 0 ? 0 : 1)
  console.log(
    JSON.stringify(
      {
        ...results,
        database: { file: dbFile, ...dbStats, ready: dbReady },
        backups: backupFiles,
        consoleErrors,
        failures
      },
      null,
      2
    )
  )
  if (failures > 0 || consoleErrors.length > 0) {
    console.error(`[smoke] ${failures} failed check(s), ${consoleErrors.length} console error(s)`)
    fail()
    return
  }
  app.quit()
}

async function runCaptureChecks(mainWin) {
  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
  const inboxCount = () =>
    mainWin.webContents.executeJavaScript(`(() => {
      const row = [...document.querySelectorAll('.w1-todorow')].find(
        (el) => el.querySelector('.w1-todolabel')?.textContent?.trim() === '收集箱'
      )
      return Number(row?.querySelector('.w1-todocount')?.textContent ?? -1)
    })()`)

  await mainWin.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('.w1-navitem')].find(
      (node) => node.querySelector('.w1-navtext b')?.textContent?.trim() === '任务'
    )
    item?.click()
  })()`)
  await sleep(500)

  const before = await inboxCount()
  await mainWin.webContents.executeJavaScript('window.ws.capture.open()')
  await sleep(900)

  const captureWin = BrowserWindow.getAllWindows().find((window) =>
    window.webContents.getURL().includes('#capture')
  )
  check('捕获窗打开', Boolean(captureWin))

  if (captureWin) {
    await captureWin.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('.cap-input')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '冒烟捕获任务')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return true
    })()`)
    await sleep(900)
    check('捕获后窗口隐藏', !captureWin.isVisible())
    captureWin.destroy()
  }

  const after = await inboxCount()
  check('捕获任务出现在主窗口', after === before + 1, `${before} -> ${after}`)
  return checks
}

function cleanup() {
  try {
    providerProbe.close()
  } catch {
    // 探针已关闭
  }
  try {
    mcpHttpProbe.close()
  } catch {
    // 探针已关闭
  }
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // 临时目录清理失败不影响冒烟结论。
  }
}

function fail(code = 1) {
  // app.exit 不触发 before-quit / will-quit：先手动关库（主进程的 before-quit 处理器），
  // 再清临时目录，否则 Windows 上文件仍被占用、目录会残留在 %TEMP%。
  try {
    app.emit('before-quit', { preventDefault() {} })
  } catch {
    // 退出路径不再抛错
  }
  cleanup()
  app.exit(code)
}

app
  .whenReady()
  .then(run)
  .catch((error) => {
    console.error(error)
    fail()
  })

app.on('will-quit', cleanup)
