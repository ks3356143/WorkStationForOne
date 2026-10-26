const { app, BrowserWindow } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { dirname, join, resolve } = require('node:path')

const target = resolve(process.argv[2] ?? '.screenshots/shell.png')
const width = Number(process.argv[3]) || 1440
const height = Number(process.argv[4]) || 900
const extras = process.argv.slice(5)
const isTheme = (value) => value === 'dark' || value === 'light'
const isView = (value) => value === 'today' || value === 'tasks' || value === 'agent' || value === 'notes'
const isSkin = (value) => value === 'prism' || value === 'classic'
const theme = extras.filter(isTheme).at(-1) ?? 'dark'
const view = extras.filter(isView).at(-1) ?? 'today'
const skin = extras.filter(isSkin).at(-1) ?? 'prism'
const auditArg = extras.find((value) => !isTheme(value) && !isView(value) && !isSkin(value))
const auditPath = auditArg ? resolve(auditArg) : null
const VIEW_LABELS = { today: '今日', tasks: '任务', agent: 'Agent', notes: '笔记' }

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function run() {
  const consoleErrors = []
  const win = new BrowserWindow({
    width,
    height,
    show: true,
    backgroundColor: '#070812',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message)
  })

  await win.loadFile(join(__dirname, '../out/renderer/index.html'))
  await win.webContents.executeJavaScript(
    `localStorage.setItem('workstation.theme', '${theme}'); localStorage.setItem('workstation.skin', '${skin}')`
  )
  const reloaded = new Promise((done) => win.webContents.once('did-finish-load', done))
  win.webContents.reload()
  await reloaded
  win.setAlwaysOnTop(true, 'screen-saver')
  win.show()
  win.focus()
  await sleep(2600)

  if (view !== 'today') {
    const switched = await win.webContents.executeJavaScript(`(() => {
      const target = ${JSON.stringify(VIEW_LABELS[view])}
      const item = [...document.querySelectorAll('.w1-navitem')].find(
        (node) => node.querySelector('.w1-navtext b')?.textContent?.trim() === target
      )
      item?.click()
      return Boolean(item)
    })()`)
    if (!switched) throw new Error(`找不到导航项：${VIEW_LABELS[view]}`)
    await sleep(650)
  }

  await mkdir(dirname(target), { recursive: true })
  const image = await win.webContents.capturePage()
  await writeFile(target, image.toPNG())

  if (auditPath) {
    const metrics = await win.webContents.executeJavaScript(`(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), sw: el.scrollWidth, sh: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight }
      }
      const name = (el) => [el.tagName.toLowerCase(), el.className?.toString?.().trim().slice(0, 80)].filter(Boolean).join('.')
      const outsideViewport = [...document.querySelectorAll('.w1 *')].filter((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 &&
          (r.right > innerWidth + 1 || r.left < -1)
      }).slice(0, 20).map((el) => {
        const r = el.getBoundingClientRect()
        return { el: name(el), left: +r.left.toFixed(1), right: +r.right.toFixed(1) }
      })
      const overflowX = [...document.querySelectorAll('.w1 *')].filter((el) => {
        const s = getComputedStyle(el)
        return el.scrollWidth > el.clientWidth + 1 && s.overflowX !== 'visible' && el.clientWidth > 0
      }).slice(0, 20).map((el) => ({ el: name(el), sw: el.scrollWidth, cw: el.clientWidth }))
      const scrollables = ['.w1-nav', '.w1-main', '.w1-rail', '.w1-railscroll', '.w1-thread', '.w1-nvlist'].map((selector) => {
        const el = document.querySelector(selector)
        if (!el) return null
        return { selector, top: el.scrollTop, sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }
      }).filter(Boolean)
      return {
        view: ${JSON.stringify(view)},
        theme: document.documentElement.dataset.theme,
        skin: document.documentElement.dataset.skin,
        palette: {
          bg: getComputedStyle(document.querySelector('.w1')).backgroundColor,
          fg: getComputedStyle(document.querySelector('.w1')).color,
          muted: getComputedStyle(document.querySelector('.w1-sub') ?? document.querySelector('.w1')).color
        },
        inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
        doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        nav: [...document.querySelectorAll('.w1-navitem')].map((el) => ({
          label: el.querySelector('.w1-navtext b')?.textContent?.trim() ?? '',
          active: el.classList.contains('on')
        })),
        headings: [...document.querySelectorAll('h1, h2, h3')].map((el) => el.textContent.trim().slice(0, 40)),
        rects: Object.fromEntries(['.w1', '.w1-bar', '.w1-body', '.w1-nav', '.w1-navitem.on', '.w1-stage', '.w1-view', '.w1-main', '.w1-workspace', '.w1-agent', '.w1-rail', '.w1-railscroll', '.w1-dock', '.w1-thread', '.w1-compose', '.w1-notesview', '.w1-nvbox', '.w1-nvlist', '.w1-nvrow', '.w1-bento', '.w1-tasks', '.w1-todos', '.w1-todorail', '.w1-todomain', '.w1-todoscroll', '.w1-card.w1-note', '.w1-status', '.w1-rbtn', '.w1-nlist'].map((selector) => [selector, rect(selector)])),
        noteItems: [...document.querySelectorAll('.w1-nitem')].map((el) => ({ text: el.textContent.slice(0, 24), display: getComputedStyle(el).display })),
        outsideViewport,
        overflowX,
        scrollables
      }
    })()`)
    await mkdir(dirname(auditPath), { recursive: true })
    await writeFile(auditPath, JSON.stringify(metrics, null, 2))
  }

  if (consoleErrors.length) {
    console.error(`[capture] ${consoleErrors.length} renderer error(s):\n${consoleErrors.join('\n')}`)
    app.exit(1)
    return
  }
  app.quit()
}

app.whenReady().then(run).catch((error) => {
  console.error(error)
  app.exit(1)
})
