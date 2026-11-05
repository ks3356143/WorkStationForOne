import { describe, expect, it } from 'vitest'
import type { AgentKind, ExternalMcpServerRecord, SkillRecord } from '../../shared/ipc'
import type { CapabilityRepository } from '../db/capabilities'
import type { ToolPrefRepository, ToolPrefRow } from '../db/tool-prefs'
import { ToolSurfaceService } from './tool-surface'

function prefs(rows: ToolPrefRow[] = []): ToolPrefRepository {
  const store = new Map(rows.map((row) => [`${row.agent}:${row.key}`, row]))
  const fake = {
    list: (agent: AgentKind) => [...store.values()].filter((row) => row.agent === agent),
    disabledNative: (agent: AgentKind) =>
      [...store.values()]
        .filter((row) => row.agent === agent && !row.enabled && row.key.startsWith('native:'))
        .map((row) => row.key.slice('native:'.length)),
    order: (agent: AgentKind) =>
      new Map(
        [...store.values()]
          .filter((row) => row.agent === agent && !row.key.startsWith('native:'))
          .map((row) => [row.key, row.sortOrder])
      ),
    preferred: (agent: AgentKind) =>
      new Set(
        [...store.values()]
          .filter((row) => row.agent === agent && row.preferred && !row.key.startsWith('native:'))
          .map((row) => row.key)
      ),
    notes: (agent: AgentKind) =>
      new Map(
        [...store.values()]
          .filter((row) => row.agent === agent && row.note && !row.key.startsWith('native:'))
          .map((row) => [row.key, row.note])
      ),
    setNative: (agent: AgentKind, id: string, enabled: boolean) => {
      store.set(`${agent}:native:${id}`, {
        agent,
        key: `native:${id}`,
        enabled,
        sortOrder: 0,
        preferred: false,
        note: ''
      })
    },
    setPreferred: (agent: AgentKind, key: string, preferred: boolean) => {
      const existing =
        store.get(`${agent}:${key}`) ??
        ({ agent, key, enabled: true, sortOrder: 0, preferred, note: '' } as ToolPrefRow)
      store.set(`${agent}:${key}`, { ...existing, preferred })
    },
    setNote: (agent: AgentKind, key: string, note: string) => {
      const existing =
        store.get(`${agent}:${key}`) ??
        ({ agent, key, enabled: true, sortOrder: 0, preferred: false, note: '' } as ToolPrefRow)
      store.set(`${agent}:${key}`, { ...existing, note })
    },
    setOrder: (agent: AgentKind, keys: string[]) => {
      keys.forEach((key, index) => {
        const existing =
          store.get(`${agent}:${key}`) ??
          ({
            agent,
            key,
            enabled: true,
            sortOrder: index,
            preferred: false,
            note: ''
          } as ToolPrefRow)
        store.set(`${agent}:${key}`, { ...existing, sortOrder: index })
      })
    },
    remove: (agent: AgentKind, key: string) => {
      store.delete(`${agent}:${key}`)
    }
  }
  return fake as unknown as ToolPrefRepository
}

function repository(): CapabilityRepository {
  const servers = [
    {
      id: 's2',
      name: 'zeta',
      enabled: true,
      trusted: true,
      targets: 'both',
      tools: [{ name: 'z1' }]
    },
    {
      id: 's1',
      name: 'alpha',
      enabled: true,
      trusted: true,
      targets: 'both',
      tools: [{ name: 'a1' }, { name: 'a2' }]
    },
    {
      id: 's3',
      name: 'offline',
      enabled: false,
      trusted: true,
      targets: 'both',
      tools: [{ name: 'x1' }]
    },
    {
      id: 's4',
      name: 'codex-only',
      enabled: true,
      trusted: true,
      targets: 'codex',
      tools: []
    }
  ] as unknown as ExternalMcpServerRecord[]
  const plugins = [
    { id: 'p1', name: 'weekly-review', enabled: true, trusted: true, agent: 'claude' },
    { id: 'p2', name: 'pdf', enabled: true, trusted: true, agent: 'claude' },
    { id: 'p3', name: 'disabled', enabled: false, trusted: true, agent: 'claude' },
    { id: 'p4', name: 'codex-skill', enabled: true, trusted: true, agent: 'codex' }
  ] as unknown as SkillRecord[]
  return {
    listMcpServers: () => servers,
    listPlugins: (agent?: string) => plugins.filter((plugin) => !agent || plugin.agent === agent)
  } as unknown as CapabilityRepository
}

const builtin = () => []

describe('ToolSurfaceService', () => {
  it('按 Agent 过滤 MCP，未设置顺序时按名称稳定排序', () => {
    const service = new ToolSurfaceService(prefs(), repository(), builtin)
    const claude = service.forAgent('claude')
    expect(claude.mcp.map((server) => server.name)).toEqual(['alpha', 'offline', 'zeta'])
    expect(claude.skills.map((skill) => skill.name)).toEqual(['disabled', 'pdf', 'weekly-review'])
    expect(service.forAgent('codex').mcp.map((server) => server.name)).toEqual([
      'alpha',
      'codex-only',
      'offline',
      'zeta'
    ])
  })

  it('移动 MCP 时与技能共用一条顺序，写回后立即生效', () => {
    const store = prefs()
    const service = new ToolSurfaceService(store, repository(), builtin)
    service.move('claude', 'mcp:s1', 'down')
    expect(service.forAgent('claude').mcp.map((server) => server.name)).toEqual([
      'offline',
      'alpha',
      'zeta'
    ])
    expect(store.setOrder).toBeTypeOf('function')
  })

  it('关闭原生组生成 Claude 拒绝列表与 Codex 进程参数', () => {
    const store = prefs()
    const service = new ToolSurfaceService(store, repository(), builtin)
    service.setNative('claude', 'web', false)
    service.setNative('codex', 'shell', false)
    expect(service.nativePolicy('claude')).toEqual({
      disabledClaudeTools: ['WebFetch', 'WebSearch'],
      codexFlags: [],
      codexDeniedTools: []
    })
    expect(service.nativePolicy('codex')).toEqual({
      disabledClaudeTools: [],
      codexFlags: [],
      codexDeniedTools: ['Shell']
    })
  })

  it('优先级提示只列启用的 MCP 与技能', () => {
    const service = new ToolSurfaceService(prefs(), repository(), builtin)
    const text = service.priorityPrompt('claude')
    expect(text).toContain('alpha（a1, a2）')
    expect(text).toContain('zeta（z1）')
    expect(text).not.toContain('offline')
    expect(text).toContain('技能：pdf；weekly-review')
    expect(text).not.toContain('disabled')
    expect(service.priorityPrompt('codex')).toContain('codex-skill')
  })

  it('首选项置顶，并进入提示词的「首选 / 其它已启用」两级', () => {
    const store = prefs()
    const service = new ToolSurfaceService(store, repository(), builtin)
    service.setPreferred('claude', 'mcp:s2', true)
    const surface = service.forAgent('claude')
    expect(surface.mcp.map((server) => server.name)).toEqual(['zeta', 'alpha', 'offline'])
    expect(surface.mcp[0]?.preferred).toBe(true)

    const text = service.priorityPrompt('claude')
    expect(text).toContain('首选：zeta（z1）')
    expect(text).toContain('其它已启用：alpha（a1, a2）；技能 pdf、weekly-review')
    expect(text).toContain('CLI 原生工具')

    service.setPreferred('claude', 'mcp:s2', false)
    expect(service.forAgent('claude').mcp[0]?.preferred).toBe(false)
    expect(service.priorityPrompt('claude')).not.toContain('首选：')
  })

  it('用途说明只进入首选分组，并随 Agent 隔离', () => {
    const store = prefs()
    const service = new ToolSurfaceService(store, repository(), builtin)
    service.setPreferred('claude', 'mcp:s2', true)
    service.setNote('claude', 'mcp:s2', '  窗口截图\n与浏览器操作  ')
    const surface = service.forAgent('claude')
    expect(surface.mcp.find((server) => server.name === 'zeta')?.note).toBe('窗口截图 与浏览器操作')
    const text = service.priorityPrompt('claude')
    expect(text).toContain('zeta（z1） · 用途：窗口截图 与浏览器操作')
    expect(service.forAgent('codex').mcp.find((server) => server.name === 'zeta')?.note).toBe('')
    expect(service.priorityPrompt('codex')).not.toContain('窗口截图')
    expect(() => service.setNote('claude', 'native:web', 'x')).toThrow('只有 MCP 与技能')
  })

  it('首选只接受 MCP / 技能键', () => {
    const service = new ToolSurfaceService(prefs(), repository(), builtin)
    expect(() => service.setPreferred('claude', 'native:web', true)).toThrow('只有 MCP 与技能')
  })
})
