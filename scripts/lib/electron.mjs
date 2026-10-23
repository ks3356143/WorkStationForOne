import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

export function withoutElectronRunAsNode(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE')
  )
}

const env = withoutElectronRunAsNode()

function resolveElectronViteBin() {
  return join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js')
}

function forward(child) {
  child.on('error', (error) => {
    console.error(error)
    process.exit(1)
  })
  child.on('exit', (code) => process.exit(code ?? 1))
}

export function runElectronVite(command) {
  forward(spawn(process.execPath, [resolveElectronViteBin(), command], { env, stdio: 'inherit' }))
}

export function runElectron(args) {
  forward(spawn(require('electron'), args, { env, stdio: 'inherit' }))
}
