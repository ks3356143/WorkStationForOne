import { resolve } from 'node:path'
import { runElectron } from './lib/electron.mjs'

runElectron([resolve('scripts/make-icon.cjs')])
