import { spawn } from 'node:child_process'
import type { EnvironmentCheckRecord } from '../../shared/ipc'
import { resolveCommand } from '../agent/cli'

const TIMEOUT = 4000
const CACHE_TTL = 30_000

const CHECKS: { id: EnvironmentCheckRecord['id']; label: string; command: string }[] = [
  { id: 'node', label: 'Node.js', command: 'node' },
  { id: 'npx', label: 'npx', command: 'npx' },
  { id: 'uvx', label: 'uvx', command: 'uvx' },
  { id: 'git', label: 'Git', command: 'git' },
  { id: 'claude', label: 'Claude CLI', command: 'claude' },
  { id: 'codex', label: 'Codex CLI', command: 'codex' }
]

let cached: { at: number; value: EnvironmentCheckRecord[] } | null = null

function readVersion(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    })
    let output = ''
    let settled = false
    const finish = (value: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish('')
    }, TIMEOUT)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (output.length < 400) output += chunk.slice(0, 400 - output.length)
    })
    child.stderr.on('data', (chunk: string) => {
      if (!output && output.length < 400) output += chunk.slice(0, 400 - output.length)
    })
    child.on('error', () => finish(''))
    child.on('close', () => {
      const line = output.trim().split(/\r?\n/)[0] ?? ''
      finish(line.slice(0, 120))
    })
  })
}

async function checkOne(entry: (typeof CHECKS)[number]): Promise<EnvironmentCheckRecord> {
  const resolved = resolveCommand(entry.command)
  if (!resolved) {
    return {
      id: entry.id,
      label: entry.label,
      command: entry.command,
      available: false,
      version: '',
      path: ''
    }
  }
  const version = await readVersion(resolved.bin, [...resolved.prefixArgs, '--version'])
  const path = resolved.viaNode ? (resolved.prefixArgs[0] ?? resolved.bin) : resolved.bin
  return {
    id: entry.id,
    label: entry.label,
    command: entry.command,
    available: Boolean(version),
    version,
    path
  }
}

/** 能力中心环境自检：只读版本与路径，不安装任何系统工具。 */
export async function checkEnvironment(force = false): Promise<EnvironmentCheckRecord[]> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL) return cached.value
  const value = await Promise.all(CHECKS.map(checkOne))
  cached = { at: Date.now(), value }
  return value
}
