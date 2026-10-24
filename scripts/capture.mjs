import { resolve } from 'node:path'
import { runElectron } from './lib/electron.mjs'

const [target = '.screenshots/shell.png', width = '1440', height = '900', fourth, fifth] = process.argv.slice(2)
const isTheme = (value) => value === 'dark' || value === 'light'
const audit = isTheme(fourth) ? undefined : fourth
const theme = isTheme(fourth) ? fourth : fifth

const args = [resolve('scripts/capture.cjs'), resolve(target), width, height]
if (audit) args.push(resolve(audit))
args.push(isTheme(theme) ? theme : 'dark')

runElectron(args)
