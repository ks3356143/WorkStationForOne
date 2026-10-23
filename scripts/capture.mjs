import { resolve } from 'node:path'
import { runElectron } from './lib/electron.mjs'

const [target = '.screenshots/shell.png', width = '1440', height = '900', audit] = process.argv.slice(2)
const args = [resolve('scripts/capture.cjs'), resolve(target), width, height]
if (audit) args.push(resolve(audit))

runElectron(args)
