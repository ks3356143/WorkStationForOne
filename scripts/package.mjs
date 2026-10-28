import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * 便携版打包：electron-vite 已经把主进程与渲染层打成自包含产物，
 * 主进程不 require 任何第三方包（渲染层的 react/motion 等由 Vite 内联），
 * 所以只需要「Electron 运行时 + resources/app」即可运行，不必引入打包器。
 */
const root = process.cwd()
const outDir = join(root, 'dist', 'WorkStationForOne')
const electronDist = join(root, 'node_modules', 'electron', 'dist')
const appDir = join(outDir, 'resources', 'app')

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

console.log('[package] 构建')
run('node', ['node_modules/electron-vite/bin/electron-vite.js', 'build'])

if (!existsSync(electronDist)) throw new Error('找不到 electron 运行时，先 npm install')

console.log('[package] 复制 Electron 运行时')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
cpSync(electronDist, outDir, { recursive: true })

console.log('[package] 写入应用文件')
mkdirSync(appDir, { recursive: true })
cpSync(join(root, 'out'), join(appDir, 'out'), { recursive: true })
mkdirSync(join(appDir, 'resources'), { recursive: true })
cpSync(join(root, 'resources', 'icon.ico'), join(appDir, 'resources', 'icon.ico'))

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
writeFileSync(
  join(appDir, 'package.json'),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      main: 'out/main/index.js',
      // 运行时不依赖 node_modules：渲染层依赖已在构建时内联
      dependencies: {}
    },
    null,
    2
  )}\n`
)

const exe = join(outDir, 'electron.exe')
if (existsSync(exe)) renameSync(exe, join(outDir, 'WorkStationForOne.exe'))
rmSync(join(outDir, 'resources', 'default_app.asar'), { force: true })

console.log(`[package] 完成：${resolve(outDir)}`)
