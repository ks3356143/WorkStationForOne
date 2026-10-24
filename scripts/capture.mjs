import { resolve } from 'node:path'
import { runElectron } from './lib/electron.mjs'

const [target = '.screenshots/shell.png', width = '1440', height = '900', ...extras] = process.argv.slice(2)
const isTheme = (value) => value === 'dark' || value === 'light'
const isView = (value) => value === 'today' || value === 'tasks' || value === 'agent' || value === 'notes'
const audit = extras.find((value) => !isTheme(value) && !isView(value))

const args = [resolve('scripts/capture.cjs'), resolve(target), width, height]
if (audit) args.push(resolve(audit))
args.push(extras.find(isTheme) ?? 'dark', extras.find(isView) ?? 'today')

runElectron(args)
