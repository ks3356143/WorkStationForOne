import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type {
  ExpertMarketEntry,
  ExpertRecord,
  ExpertSourceInput,
  ExpertSourceRecord
} from '../../shared/ipc'
import { parseExpertMarkdown } from '../../shared/expert-format'
import type { ExpertRepository } from '../db/experts'
import {
  assertSourceName,
  cloneSource,
  isLocalPath,
  refreshSource,
  resolvePluginSource,
  sourceSlug,
  validateSourceUrl
} from './plugins/sources'

const MAX_ENTRIES = 400
const MAX_DEPTH = 4
const MAX_FILE_BYTES = 256 * 1024
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist'])

export interface ScannedExpert {
  relPath: string
  id: string
  name: string
  description: string
  tools: string[]
}

/** 递归扫描源目录里的子代理 Markdown；限深限量限单文件大小，解析失败跳过并计数。 */
export function scanExpertDir(
  root: string,
  maxEntries = MAX_ENTRIES,
  maxDepth = MAX_DEPTH,
  maxFileBytes = MAX_FILE_BYTES
): { entries: ScannedExpert[]; skipped: number } {
  const entries: ScannedExpert[] = []
  let skipped = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || entries.length >= maxEntries) return
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (entries.length >= maxEntries) return
      const full = join(dir, item.name)
      if (item.isDirectory()) {
        if (!SKIP_DIRS.has(item.name)) walk(full, depth + 1)
        continue
      }
      if (!item.isFile() || !item.name.endsWith('.md')) continue
      let parsed = null
      try {
        if (statSync(full).size > maxFileBytes) throw new Error('oversize')
        parsed = parseExpertMarkdown(readFileSync(full, 'utf8'))
      } catch {
        parsed = null
      }
      if (!parsed) {
        skipped += 1
        continue
      }
      entries.push({
        relPath: relative(root, full).replace(/\\/g, '/'),
        id: parsed.id,
        name: parsed.name,
        description: parsed.description,
        tools: parsed.tools
      })
    }
  }
  walk(root, 0)
  return { entries, skipped }
}

export interface ExpertMarketDeps {
  repository: ExpertRepository
  appDataDir: string
  importMarkdown: (text: string) => ExpertRecord
}

/** 轻量专家市场：Git 源克隆 / 刷新 + 本地扫描 + 一键导入；只落数据不执行。 */
export class ExpertMarketService {
  private readonly sourceRoot: string
  private readonly cache = new Map<string, ExpertMarketEntry[]>()

  constructor(private readonly deps: ExpertMarketDeps) {
    this.sourceRoot = join(deps.appDataDir, 'agent', 'expert-sources')
    mkdirSync(this.sourceRoot, { recursive: true })
  }

  sources(): ExpertSourceRecord[] {
    return this.deps.repository.listSources()
  }

  async addSource(input: ExpertSourceInput): Promise<ExpertSourceRecord> {
    const name = assertSourceName(input.name)
    const invalid = validateSourceUrl(input.url)
    if (invalid) throw new Error(invalid)
    const ref = (input.ref ?? '').trim()
    const url = input.url.trim()
    const local = isLocalPath(url)
    const root = local ? url : join(this.sourceRoot, sourceSlug(name))
    if (local) {
      if (!existsSync(url)) throw new Error('本地源目录不存在')
    } else if (existsSync(root)) {
      throw new Error('源目录已存在，请更换名称或先移除旧源')
    }
    const record = this.deps.repository.saveSource({
      id: `exsrc-${sourceSlug(name)}-${Date.now().toString(36)}`,
      name,
      url,
      ref,
      root
    })
    try {
      if (!local) await cloneSource(url, root, ref)
      this.rescan(record)
      return this.deps.repository.findSource(record.id) ?? record
    } catch (error) {
      if (!local) {
        try {
          rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        } catch {
          // 残留目录留给下次添加前处理
        }
      }
      this.deps.repository.removeSource(record.id)
      throw error
    }
  }

  async refresh(id: string): Promise<ExpertSourceRecord> {
    const source = this.deps.repository.findSource(id)
    if (!source) throw new Error('专家源不存在')
    try {
      if (!isLocalPath(source.url)) await refreshSource(source.root, source.ref)
      this.rescan(source)
      return this.deps.repository.findSource(id) ?? source
    } catch (error) {
      const message = error instanceof Error ? error.message : '刷新失败'
      this.deps.repository.updateSourceSync(id, { lastSyncedAt: Date.now(), lastError: message })
      throw new Error(message)
    }
  }

  removeSource(id: string): void {
    const source = this.deps.repository.findSource(id)
    if (!source) return
    // 本地目录源只解除引用，不删用户目录
    if (!isLocalPath(source.url)) {
      try {
        rmSync(source.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        // 删不掉也解除引用
      }
    }
    this.cache.delete(id)
    this.deps.repository.removeSource(id)
  }

  list(): ExpertMarketEntry[] {
    return this.deps.repository.listSources().flatMap((source) => this.entriesOf(source))
  }

  importEntry(sourceId: string, relPath: string): ExpertRecord {
    const source = this.deps.repository.findSource(sourceId)
    if (!source) throw new Error('专家源不存在')
    const abs = resolvePluginSource(source.root, relPath)
    if (!existsSync(abs)) throw new Error('条目文件不存在')
    if (statSync(abs).size > MAX_FILE_BYTES)
      throw new Error(`条目文件过大（上限 ${MAX_FILE_BYTES / 1024}KB）`)
    return this.deps.importMarkdown(readFileSync(abs, 'utf8'))
  }

  private entriesOf(source: ExpertSourceRecord): ExpertMarketEntry[] {
    const cached = this.cache.get(source.id)
    if (cached) return cached
    return this.rescan(source)
  }

  private rescan(source: ExpertSourceRecord): ExpertMarketEntry[] {
    try {
      const { entries } = scanExpertDir(source.root)
      const mapped = entries.map((entry) => ({
        sourceId: source.id,
        sourceName: source.name,
        ...entry
      }))
      this.cache.set(source.id, mapped)
      this.deps.repository.updateSourceSync(source.id, { lastSyncedAt: Date.now(), lastError: '' })
      return mapped
    } catch (error) {
      const message = error instanceof Error ? error.message : '源不可读'
      this.cache.set(source.id, [])
      this.deps.repository.updateSourceSync(source.id, {
        lastSyncedAt: Date.now(),
        lastError: message
      })
      return []
    }
  }
}
