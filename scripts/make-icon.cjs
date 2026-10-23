const { app, BrowserWindow } = require('electron')
const { mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})

const root = resolve(__dirname, '..')
const svgPath = join(root, 'resources/icon.svg')
const smallSvgPath = join(root, 'resources/icon-small.svg')
const pngPath = join(root, 'resources/icon.png')
const icoPath = join(root, 'resources/icon.ico')
const sizes = [256, 128, 64, 48, 32, 24, 16]
const SMALL_MAX = 48

function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + images.length * 16

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

async function render(svg, size, dir) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    x: -4000,
    y: -4000,
    show: true,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`
  const file = join(dir, `icon-${size}.html`)
  await writeFile(file, html, 'utf8')
  await win.loadURL(pathToFileURL(file).href)
  await new Promise((done) => setTimeout(done, 350))
  const shot = await win.webContents.capturePage()
  win.destroy()
  const actual = shot.getSize()
  return actual.width === size && actual.height === size
    ? shot
    : shot.resize({ width: size, height: size, quality: 'best' })
}

async function run() {
  const svg = await readFile(svgPath, 'utf8')
  const smallSvg = await readFile(smallSvgPath, 'utf8')
  const dir = join(root, 'out', 'icon-tmp')
  await mkdir(dir, { recursive: true })

  const master = await render(svg, 1024, dir)
  const smallMaster = await render(smallSvg, 256, dir)
  await rm(dir, { recursive: true, force: true })

  const images = []
  for (const size of sizes) {
    const source = size <= SMALL_MAX ? smallMaster : master
    images.push({ size, png: source.resize({ width: size, height: size, quality: 'best' }).toPNG() })
  }

  await writeFile(pngPath, master.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  await writeFile(icoPath, buildIco(images))
  console.log(`[icon] wrote ${pngPath} (512) and ${icoPath} (${sizes.join(', ')})`)
  app.quit()
}

app.whenReady().then(run).catch((error) => {
  console.error(error)
  app.exit(1)
})
