const { app, BrowserWindow } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { dirname, join, resolve } = require('node:path')

const target = resolve(process.argv[2] ?? '.screenshots/shell.png')
const width = Number(process.argv[3]) || 1440
const height = Number(process.argv[4]) || 900
const auditPath = process.argv[5] ? resolve(process.argv[5]) : null

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
  win.setAlwaysOnTop(true, 'screen-saver')
  win.show()
  win.focus()
  await sleep(2600)

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
      const overflows = [...document.querySelectorAll('*')].filter((el) => {
        const s = getComputedStyle(el)
        return el.scrollWidth > el.clientWidth + 1 && s.overflowX !== 'visible' && el.clientWidth > 0
      }).slice(0, 20).map((el) => ({ cls: el.className?.toString().slice(0, 90), sw: el.scrollWidth, cw: el.clientWidth }))
      const verticalOverflows = [...document.querySelectorAll('.w1-card, .w1-card *')].filter((el) => {
        const s = getComputedStyle(el)
        return el.scrollHeight > el.clientHeight + 1 && s.overflowY !== 'visible' && el.clientHeight > 0
      }).slice(0, 20).map((el) => ({ cls: el.className?.toString().slice(0, 90), sh: el.scrollHeight, ch: el.clientHeight }))
      return {
        inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
        doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        rects: Object.fromEntries(['.w1', '.w1-bar', '.w1-body', '.w1-rail', '.w1-main', '.w1-dock', '.w1-bento', '.w1-tasks', '.w1-card.w1-tasks', '.w1-bento > .w1-card:nth-child(2)', '.w1-bento > .w1-card:nth-child(3)', '.w1-card.w1-note', '.w1-thread', '.w1-compose', '.w1-status', '.w1-nfoot', '.w1-heat', '.w1-rbtn', '.w1-nlist'].map((s) => [s, rect(s)])),
        noteItems: [...document.querySelectorAll('.w1-nitem')].map((el) => ({ text: el.textContent.slice(0, 24), display: getComputedStyle(el).display })),
        overflows,
        verticalOverflows
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
