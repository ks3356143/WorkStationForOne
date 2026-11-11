// 推荐页真链路探针：真实网络 + 真实 UI + 临时数据目录，不 stub MCP / 插件源 / Claude CLI。
// 用法：npm run build && node scripts/probe-recommend.mjs
// 覆盖：MCP 推荐一键添加（DeepWiki/Context7/Notion）→ 信任/启用 → 真实连接测试；
// 技能库推荐加源（真实 clone anthropics/skills）→ 去市场 → 真实安装 docx → 技能页启用。
// 不消耗模型额度；不写真实用户库与 ~/.claude / ~/.codex。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as sleep } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')

const rootDir = mkdtempSync(join(tmpdir(), 'ws-probe-rec-'))
// WS_DATA_DIR 是 data 目录，布局根是它的父级；给它一个独占父目录，避免跨轮共享 plugin-sources。
const dataDir = join(rootDir, 'data')
mkdirSync(dataDir, { recursive: true })
const profileDir = join(rootDir, 'profile')
mkdirSync(profileDir, { recursive: true })
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE')
  ),
  WS_DATA_DIR: dataDir,
  WS_DISABLE_CAPTURE_SHORTCUT: '1'
}

const isolationTargets = [
  join(homedir(), '.claude', 'plugins', 'known_marketplaces.json'),
  join(homedir(), '.claude', 'plugins', 'installed_plugins.json'),
  join(homedir(), '.claude', 'settings.json'),
  join(homedir(), '.codex', 'config.toml')
]
function hashFile(file) {
  if (!existsSync(file)) return null
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
const isolationBefore = isolationTargets.map(hashFile)

const PAGE_PORT = 9345
const MAIN_PORT = 9346
const checks = []
const consoleErrors = []
function record(name, ok, detail = '') {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
  checks.push({ name, ok: Boolean(ok), detail: text })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${text ? ` · ${text}` : ''}`)
}

async function waitFor(fn, { timeout = 20000, interval = 200, label = 'condition' } = {}) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeout) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(interval)
  }
  throw new Error(`timeout: ${label}${lastError ? ` · ${lastError.message}` : ''}`)
}

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return response.json()
}

function connect(url, label) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    let sequence = 0
    const pending = new Map()
    const api = {
      call(method, params = {}) {
        const id = ++sequence
        return new Promise((res, rej) => {
          pending.set(id, { res, rej })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      close() {
        try {
          socket.close()
        } catch {
          /* already closed */
        }
      }
    }
    socket.onopen = () => resolve(api)
    socket.onerror = () => reject(new Error(`${label} websocket error`))
    socket.onclose = () => {
      for (const [id, request] of pending) {
        pending.delete(id)
        request.rej(new Error(`${label} websocket closed`))
      }
    }
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id)
        if (message.error) request.rej(new Error(`${label} ${message.error.message}`))
        else request.res(message.result ?? {})
        return
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        consoleErrors.push(
          (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')
        )
      }
      if (message.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(message.params?.exceptionDetails?.exception?.description || 'exception')
      }
    }
  })
}

async function evaluate(target, expression, label = 'evaluate', timeout = 30000) {
  let timer = null
  const call = target.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })
  const result = await Promise.race([
    call,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), timeout)
    })
  ]).finally(() => clearTimeout(timer))
  if (result.exceptionDetails) {
    throw new Error(
      `${label}: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`
    )
  }
  return result.result?.value
}

let child = null
let page = null
let main = null

async function launch() {
  child = spawn(
    electronExecutable,
    [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${PAGE_PORT}`,
      `--inspect=${MAIN_PORT}`,
      '--remote-allow-origins=*',
      '.'
    ],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.on('exit', () => {
    if (output.trim()) console.log('[app output tail]\n' + output.slice(-3000))
  })
  const pageTarget = await waitFor(
    async () =>
      (await getJson(`http://127.0.0.1:${PAGE_PORT}/json/list`)).find(
        (target) => target.type === 'page' && target.webSocketDebuggerUrl
      ),
    { timeout: 30000, label: 'renderer target' }
  )
  const mainTarget = await waitFor(
    async () =>
      (await getJson(`http://127.0.0.1:${MAIN_PORT}/json/list`)).find(
        (target) => target.webSocketDebuggerUrl
      ),
    { timeout: 30000, label: 'main target' }
  )
  page = await connect(pageTarget.webSocketDebuggerUrl, 'renderer')
  main = await connect(mainTarget.webSocketDebuggerUrl, 'main')
  await Promise.all([page.call('Runtime.enable'), main.call('Runtime.enable')])
  await evaluate(
    main,
    `(() => {
      let req
      try { req = require } catch { req = process.mainModule && process.mainModule.require.bind(process.mainModule) }
      if (!req) return false
      const { BrowserWindow } = req('electron')
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return false
      win.setSkipTaskbar(true)
      win.setOpacity(0)
      win.showInactive()
      return true
    })()`,
    'show window inactive'
  )
  await waitFor(() => evaluate(page, `Boolean(document.querySelector('.w1.is-booted'))`), {
    timeout: 20000,
    label: 'shell booted'
  })
  await evaluate(
    page,
    `window.__h = {
      one: (s) => document.querySelector(s),
      all: (s) => Array.from(document.querySelectorAll(s)),
      byText: (s, t) => Array.from(document.querySelectorAll(s)).find((e) => (e.textContent || '').includes(t)),
      click: (s, t) => { const el = t ? window.__h.byText(s, t) : window.__h.one(s); if (el) { el.click(); return true } return false },
      setVal: (el, v) => {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
        desc.set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }`
  )
}

const H = 'window.__h'
async function click(selector, text) {
  const ok = await evaluate(
    page,
    text
      ? `${H}.click(${JSON.stringify(selector)}, ${JSON.stringify(text)})`
      : `${H}.click(${JSON.stringify(selector)})`
  )
  if (!ok) throw new Error(`click target missing: ${selector} ${text ?? ''}`)
}
async function mcpList() {
  return evaluate(page, `window.ws.capability.mcp.list()`)
}
async function trustEnable(name) {
  await waitFor(
    () => evaluate(page, `Boolean(${H}.byText('.w1-caprow', ${JSON.stringify(name)}))`),
    { timeout: 10000, label: `row ${name}` }
  )
  await evaluate(
    page,
    `${H}.byText('.w1-caprow', ${JSON.stringify(name)}).querySelector('.w1-setbtn').click()`
  )
  await waitFor(
    () =>
      evaluate(
        page,
        `(${H}.byText('.w1-caprow', ${JSON.stringify(name)})?.querySelector('.w1-setbtn')?.textContent || '') === '确认信任并启用'`
      ),
    { timeout: 5000, label: `confirm ${name}` }
  )
  await evaluate(
    page,
    `${H}.byText('.w1-caprow', ${JSON.stringify(name)}).querySelector('.w1-setbtn').click()`
  )
  await waitFor(
    () =>
      evaluate(
        page,
        `(${H}.byText('.w1-caprow', ${JSON.stringify(name)})?.querySelector('.w1-setbtn')?.textContent || '') === '已启用'`
      ),
    { timeout: 10000, label: `enabled ${name}` }
  )
}
async function testServer(name) {
  await evaluate(
    page,
    `(() => {
      const row = ${H}.byText('.w1-caprow', ${JSON.stringify(name)})
      const btn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === '测试' || b.textContent === '重测')
      if (btn) { btn.click(); return true }
      return false
    })()`
  )
}

async function run() {
  await launch()
  record('外壳启动且桥可用', await evaluate(page, `Boolean(window.ws?.capability)`))

  await click('.w1-settings')
  await waitFor(() => evaluate(page, `Boolean(${H}.one('.w1-settings-sheet'))`), {
    label: 'settings'
  })
  await click('.w1-settabs button', '能力中心')
  await waitFor(() => evaluate(page, `Boolean(${H}.one('.w1-capnav'))`), { label: 'capability' })
  await click('.w1-capnav button', '推荐')
  await waitFor(() => evaluate(page, `${H}.all('.w1-caprow.mcp-rec').length === 3`), {
    label: 'mcp rec rows'
  })
  record(
    '推荐页 MCP 三行与技能库一行',
    await evaluate(page, `${H}.all('.w1-caprow.skill-rec').length === 1`)
  )

  // —— MCP 推荐一键添加（真实 mcp.add，默认停用未信任）——
  for (const [name, auth] of [
    ['DeepWiki', 'headers'],
    ['Context7', 'headers'],
    ['Notion', 'oauth']
  ]) {
    await click(`.w1-caprow.mcp-rec .w1-capmini[aria-label="添加 ${name}"]`)
    const server = await waitFor(async () => (await mcpList()).find((item) => item.name === name), {
      timeout: 10000,
      label: `add ${name}`
    })
    record(
      `${name} 一键添加默认停用未信任`,
      server.enabled === false && server.trusted === false && server.auth === auth,
      JSON.stringify({ enabled: server.enabled, trusted: server.trusted, auth: server.auth })
    )
  }
  record(
    '添加后推荐行显示已添加',
    await waitFor(
      () => evaluate(page, `${H}.all('.w1-caprow.mcp-rec .w1-capbadge').length === 3`),
      {
        timeout: 5000,
        label: 'added badges'
      }
    )
  )

  // —— 技能库推荐：真实 clone anthropics/skills 并注册为插件源 ——
  // GitHub 克隆可能因网络抖动失败；失败后按钮会恢复，再点一次走「清理残留 + 重试」路径。
  let sourceAdded = false
  for (let attempt = 1; attempt <= 2 && !sourceAdded; attempt++) {
    await click('.w1-caprow.skill-rec .w1-capmini[aria-label*="添加插件源"]')
    await sleep(400)
    const outcome = await waitFor(
      async () => {
        const state = await evaluate(
          page,
          `(() => {
            const row = ${H}.one('.w1-caprow.skill-rec')
            const labels = Array.from(row?.querySelectorAll('button') ?? []).map((b) => b.textContent || '')
            if (labels.includes('去市场')) return { ok: true }
            if (labels.includes('添加为插件源')) return { ok: false }
            return null
          })()`
        )
        return state
      },
      { timeout: 420000, interval: 300, label: `add source attempt ${attempt}` }
    )
    if (outcome.ok) {
      sourceAdded = true
      break
    }
    const toast = await evaluate(page, `(${H}.one('.w1-toast')?.textContent || 'no toast')`)
    console.log(`[probe] add attempt ${attempt} failed: ${toast}`)
    record(`加源第 ${attempt} 次失败可见错误`, toast !== 'no toast', toast.slice(0, 160))
    await sleep(800)
  }
  if (!sourceAdded) throw new Error('技能库加源两次均失败')
  const source = await waitFor(
    async () =>
      (await evaluate(page, `window.ws.capability.pluginSources()`)).find(
        (item) => item.url === 'https://github.com/anthropics/skills'
      ),
    { timeout: 10000, label: 'source record' }
  )
  record(
    '技能库加源真实 clone 并数到插件',
    source.pluginCount > 0,
    `pluginCount=${source.pluginCount}`
  )
  const manifest = JSON.parse(
    readFileSync(join(source.root, '.claude-plugin', 'marketplace.json'), 'utf8')
  )
  const manifestName = String(manifest.name)
  record(
    '源清单 document-skills 打包 docx',
    (manifest.plugins ?? []).some(
      (plugin) =>
        plugin.name === 'document-skills' && (plugin.skills ?? []).includes('./skills/docx')
    ),
    `marketplace=${manifestName}`
  )
  const cliMarkets = await evaluate(
    main,
    `(() => {
      const req = process.mainModule && process.mainModule.require.bind(process.mainModule)
      if (!req) return { error: 'no require' }
      const fs = req('node:fs')
      const path = req('node:path')
      const dir = path.join(${JSON.stringify(rootDir)}, 'agent', 'claude-plugins', 'config', 'plugins', 'marketplaces')
      let entries = []
      try { entries = fs.readdirSync(dir) } catch (error) { entries = ['<missing:' + error.code + '>'] }
      return { entries }
    })()`,
    'cli marketplaces'
  )
  record(
    'Claude CLI 已注册新市场',
    (cliMarkets?.entries ?? []).includes('anthropic-agent-skills'),
    JSON.stringify(cliMarkets)
  )

  // —— 去市场：跳插件 tab 市场视图，真实 CLI 列清单 ——
  await click('.w1-caprow.skill-rec button', '去市场')
  await waitFor(() => evaluate(page, `Boolean(${H}.one('.w1-capmarket'))`), {
    label: 'market view'
  })
  record(
    '去市场跳到插件 tab 市场视图',
    await evaluate(
      page,
      `${H}.all('.w1-capnav button').findIndex((b) => b.textContent === '插件') >= 0 && Boolean(${H}.one('.w1-capmarket'))`
    )
  )
  await waitFor(
    () =>
      evaluate(
        page,
        `${H}.all('.w1-capcard').length > 0 || Boolean(${H}.byText('.w1-capemptycard', '没有匹配'))`
      ),
    { timeout: 300000, interval: 500, label: 'market entries (real CLI)' }
  )
  await evaluate(page, `${H}.setVal(${H}.one('.w1-capmarket .w1-capsearch'), 'document-skills')`)
  const marketSnap = await evaluate(page, `window.ws.capability.skills.market(false)`)
  const attributed = (marketSnap?.entries ?? []).find(
    (entry) => entry.name === 'document-skills' && entry.marketplace === manifestName
  )
  record(
    '市场清单 document-skills 归属新插件源',
    Boolean(attributed),
    attributed?.pluginId ?? 'missing'
  )
  const docxCard = await waitFor(
    () =>
      evaluate(
        page,
        `Boolean(${H}.all('.w1-capcard').find((card) => card.querySelector('b')?.textContent === 'document-skills' && (card.querySelector('.w1-capkicker')?.textContent || '').includes(${JSON.stringify(manifestName)})))`
      ),
    { timeout: 30000, label: 'document-skills card' }
  )
  record('市场卡片显示新源 document-skills', docxCard)
  await evaluate(
    page,
    `${H}.all('.w1-capcard').find((card) => card.querySelector('b')?.textContent === 'document-skills' && (card.querySelector('.w1-capkicker')?.textContent || '').includes(${JSON.stringify(manifestName)})).querySelector('.w1-capmini.pri').click()`
  )
  await waitFor(
    () =>
      evaluate(
        page,
        `(${H}.all('.w1-capcard').find((card) => card.querySelector('b')?.textContent === 'document-skills' && (card.querySelector('.w1-capkicker')?.textContent || '').includes(${JSON.stringify(manifestName)}))?.textContent || '').includes('已安装')`
      ),
    { timeout: 180000, interval: 500, label: 'real claude plugin install document-skills' }
  )
  const installDb = new DatabaseSync(join(dataDir, 'workstation.db'), { readOnly: true })
  const installRow = installDb
    .prepare("SELECT install_path FROM agent_plugins WHERE id LIKE 'document-skills%'")
    .get()
  installDb.close()
  const installPath = String(installRow?.install_path ?? '')
  record(
    'document-skills 真实安装到应用私有目录',
    installPath !== '' && installPath.startsWith(join(rootDir, 'agent')),
    installPath
  )

  // —— 技能页启用（唯一入口）——
  await click('.w1-capnav button', '技能')
  await waitFor(() => evaluate(page, `Boolean(${H}.byText('.w1-caprow', 'document-skills'))`), {
    label: 'skill row'
  })
  await evaluate(
    page,
    `${H}.byText('.w1-caprow', 'document-skills').querySelector('.w1-setbtn').click()`
  )
  await waitFor(
    () =>
      evaluate(
        page,
        `['已启用', '确认信任并启用'].includes(${H}.byText('.w1-caprow', 'document-skills')?.querySelector('.w1-setbtn')?.textContent || '')`
      ),
    { timeout: 5000, label: 'document-skills enable state' }
  )
  const maybeConfirm = await evaluate(
    page,
    `(${H}.byText('.w1-caprow', 'document-skills')?.querySelector('.w1-setbtn')?.textContent || '')`
  )
  if (maybeConfirm === '确认信任并启用') {
    await evaluate(
      page,
      `${H}.byText('.w1-caprow', 'document-skills').querySelector('.w1-setbtn').click()`
    )
  }
  await waitFor(
    () =>
      evaluate(
        page,
        `(${H}.byText('.w1-caprow', 'document-skills')?.textContent || '').includes('已启用')`
      ),
    { timeout: 10000, label: 'document-skills enabled' }
  )
  const skillState = await evaluate(page, `window.ws.capability.skills.list()`)
  record(
    'document-skills 技能页启用并落库',
    skillState.some((item) => item.name === 'document-skills' && item.enabled === true),
    JSON.stringify(skillState.map((item) => [item.name, item.enabled]))
  )

  // —— MCP 页：DeepWiki 信任+启用+真实测试 ——
  await click('.w1-capnav button', 'MCP')
  await trustEnable('DeepWiki')
  await testServer('DeepWiki')
  const deepwiki = await waitFor(
    async () => {
      const server = (await mcpList()).find((item) => item.name === 'DeepWiki')
      return server?.lastTestAt && server.tools.length > 0 ? server : null
    },
    { timeout: 60000, interval: 500, label: 'deepwiki real tools/list' }
  )
  record(
    'DeepWiki 真实连接测试返回工具',
    deepwiki.tools.some((tool) => tool.name.includes('wiki') || tool.name.includes('ask')),
    deepwiki.tools.map((tool) => tool.name).join(', ')
  )

  // —— Context7：无 Key 也能 initialize/tools/list（调用工具才需要 Key）——
  await trustEnable('Context7')
  await testServer('Context7')
  const context7 = await waitFor(
    async () => {
      const server = (await mcpList()).find((item) => item.name === 'Context7')
      return server?.lastTestAt && server.tools.length > 0 ? server : null
    },
    { timeout: 60000, interval: 500, label: 'context7 tools/list' }
  )
  record(
    'Context7 连接测试列出工具（调用才需 Key）',
    context7.tools.some((tool) => tool.name === 'resolve-library-id' || tool.name === 'query-docs'),
    context7.tools.map((tool) => tool.name).join(', ')
  )

  // —— Notion：OAuth 未登录态与登录入口 ——
  const notionUi = await evaluate(
    page,
    `(() => {
      const row = ${H}.byText('.w1-caprow', 'Notion')
      if (!row) return null
      return {
        badge: (row.textContent || '').includes('未登录'),
        login: Array.from(row.querySelectorAll('button')).some((b) => (b.textContent || '').includes('登录'))
      }
    })()`
  )
  record(
    'Notion 添加后为 OAuth 未登录且有登录入口',
    Boolean(notionUi?.badge && notionUi?.login),
    JSON.stringify(notionUi)
  )

  // —— 直接读临时库证明落库 ——
  const db = new DatabaseSync(join(dataDir, 'workstation.db'), { readOnly: true })
  const servers = db.prepare('SELECT name, enabled, trusted, auth FROM mcp_servers').all()
  const toolCount = db
    .prepare(
      "SELECT COUNT(*) AS n FROM mcp_server_tools t JOIN mcp_servers s ON s.id = t.server_id WHERE s.name = 'DeepWiki'"
    )
    .get()
  const sources = db.prepare('SELECT url FROM plugin_sources').all()
  const plugins = db.prepare('SELECT id, enabled FROM agent_plugins').all()
  db.close()
  record(
    '临时库落库：三服务/工具/源/插件',
    servers.length === 3 &&
      Number(toolCount.n) > 0 &&
      sources.some((row) => row.url === 'https://github.com/anthropics/skills') &&
      plugins.some((row) => row.id.includes('document-skills') && row.enabled === 1),
    JSON.stringify({ servers, toolCount: toolCount.n, plugins })
  )

  record('渲染进程无控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))
  const isolationAfter = isolationTargets.map(hashFile)
  record(
    '~/.claude 与 ~/.codex 全程未写',
    isolationBefore.every((hash, index) => hash === isolationAfter[index]),
    JSON.stringify(
      isolationTargets.map((file, index) => [
        file,
        isolationBefore[index] === isolationAfter[index]
      ])
    )
  )
}

let failed = false
try {
  await run()
} catch (error) {
  failed = true
  record('探针执行', false, error instanceof Error ? error.message : String(error))
} finally {
  try {
    page?.close()
    main?.close()
  } catch {
    /* ignore */
  }
  if (child) {
    child.kill()
    await waitFor(() => child.exitCode !== null, { timeout: 10000, label: 'app exit' }).catch(
      () => {
        child?.kill('SIGKILL')
      }
    )
  }
  const hadFailure = failed || checks.some((check) => !check.ok)
  if (hadFailure || process.env.WS_PROBE_KEEP === '1') {
    console.log(`[probe] kept temp root for inspection: ${rootDir}`)
  } else {
    try {
      rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      /* cleanup best effort */
    }
  }
}
const failures = checks.filter((check) => !check.ok).length
console.log(`\n${checks.length - failures}/${checks.length} passed, ${failures} failed`)
process.exit(failed || failures > 0 ? 1 : 0)
