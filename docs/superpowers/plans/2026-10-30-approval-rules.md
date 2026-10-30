# Agent 审批持久规则实施计划（v0.31.0 / DB v27）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MCP 工具与本地只读工具按「Agent + 工作区 + 工具」持久放行，敏感工具最多本会话允许，并在设置页可撤销。

**Architecture:** 新增共享纯规则模块、DB v27 `approval_rules` 仓储与 `ApprovalRuleService`；Claude `can_use_tool`、Codex app-server、本地 MCP 桥在发卡前同步查规则；会话允许保留在主进程内存，工作区允许落库；渲染层只回传 `requestId + scope`，主进程二次校验资格。

**Tech Stack:** Electron 45、TypeScript、React 19、Zustand、node:sqlite（内置）、Vitest、Biome、electron-vite。

**Spec:** `docs/superpowers/specs/2026-10-30-approval-rules-design.md`

## Global Constraints

- 仅 Windows；工作区路径比较大小写不敏感，统一 `/` 为 `\` 并去尾分隔符。
- 工作区持久规则只允许：Claude `mcp__*` 与 `Read/Grep/Glob/LS`；Codex `MCP · *`。其余工具只能 `once` / `session`。
- 禁止通配符、全局规则、持久拒绝。
- 规则只放行；不得绕过 MCP 域权限（`read|ask|write`）、能力中心工具策略、Codex 外部 MCP 策略、工作区沙箱。
- 不加任何 `--dangerously-*`；不读写 `~/.claude`、`~/.codex`、CC Switch、Claude Desktop、Codex Desktop。
- 规则查询 / 审计失败按未命中处理（fail closed）；规则落库失败不得阻塞当前允许。
- UI 文案中文优先；颜色走令牌，不写死 `rgba()`；1180×720 下不得横向溢出。
- 版本：`package.json` 改为 `0.31.0`；DB `user_version` 27。
- 不提交任何 Token / API Key / 用户密钥；规则只存 agent、workspace、tool_name。
- 每个任务结束都运行 `npm run typecheck` 与 `npm run check`，再提交。

---

### Task 1: 共享审批规则纯函数

**Files:**
- Create: `src/shared/approval-rules.ts`
- Test: `src/shared/approval-rules.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `type ApprovalAgent = 'claude' | 'codex'`
  - `type ApprovalScope = 'once' | 'session' | 'workspace'`
  - `const APPROVAL_SCOPES: readonly ['once', 'session', 'workspace']`
  - `workspaceKey(path: string): string`
  - `isMcpToolName(agent: ApprovalAgent, toolName: string): boolean`
  - `isWorkspaceScopable(agent: ApprovalAgent, toolName: string): boolean`
  - `bridgeToolName(agent: ApprovalAgent, tool: string): string`

- [ ] **Step 1: 写失败测试**

Create `src/shared/approval-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_SCOPES,
  bridgeToolName,
  isMcpToolName,
  isWorkspaceScopable,
  workspaceKey
} from './approval-rules'

describe('workspaceKey', () => {
  it('统一分隔符、去掉尾部斜杠并转小写', () => {
    expect(workspaceKey('C:\\Work\\Demo\\')).toBe('c:\\work\\demo')
    expect(workspaceKey('C:/Work/Demo')).toBe('c:\\work\\demo')
    expect(workspaceKey('  C:\\Work\\Demo  ')).toBe('c:\\work\\demo')
    expect(workspaceKey('C:\\')).toBe('c:')
  })
})

describe('工具资格', () => {
  it('Claude 只允许 MCP 与本地只读工具持久', () => {
    expect(isWorkspaceScopable('claude', 'mcp__memory__read')).toBe(true)
    expect(isWorkspaceScopable('claude', 'mcp__workstationforone__tasks_create')).toBe(true)
    expect(isWorkspaceScopable('claude', 'Read')).toBe(true)
    expect(isWorkspaceScopable('claude', 'Grep')).toBe(true)
    expect(isWorkspaceScopable('claude', 'Glob')).toBe(true)
    expect(isWorkspaceScopable('claude', 'LS')).toBe(true)
    expect(isWorkspaceScopable('claude', 'Bash')).toBe(false)
    expect(isWorkspaceScopable('claude', 'Write')).toBe(false)
    expect(isWorkspaceScopable('claude', 'Edit')).toBe(false)
    expect(isWorkspaceScopable('claude', 'NotebookEdit')).toBe(false)
    expect(isWorkspaceScopable('claude', 'Task')).toBe(false)
    expect(isWorkspaceScopable('claude', 'WebFetch')).toBe(false)
    expect(isWorkspaceScopable('claude', 'WebSearch')).toBe(false)
    expect(isWorkspaceScopable('claude', 'UnknownTool')).toBe(false)
  })

  it('Codex 只允许 MCP elicitation 工具持久', () => {
    expect(isWorkspaceScopable('codex', 'MCP · memory/search')).toBe(true)
    expect(isWorkspaceScopable('codex', 'MCP · workstationforone/tasks_create')).toBe(true)
    expect(isWorkspaceScopable('codex', 'Shell')).toBe(false)
    expect(isWorkspaceScopable('codex', 'Patch')).toBe(false)
    expect(isWorkspaceScopable('codex', 'Permissions')).toBe(false)
    expect(isWorkspaceScopable('codex', 'mcp__memory__read')).toBe(false)
  })

  it('识别 MCP 工具名', () => {
    expect(isMcpToolName('claude', 'mcp__memory__read')).toBe(true)
    expect(isMcpToolName('claude', 'Read')).toBe(false)
    expect(isMcpToolName('codex', 'MCP · memory/search')).toBe(true)
    expect(isMcpToolName('codex', 'Shell')).toBe(false)
  })
})

describe('桥工具规范名', () => {
  it('按 Agent 还原为适配器层的工具名', () => {
    expect(bridgeToolName('claude', 'tasks_create')).toBe(
      'mcp__workstationforone__tasks_create'
    )
    expect(bridgeToolName('codex', 'tasks_create')).toBe(
      'MCP · workstationforone/tasks_create'
    )
  })

  it('作用域常量与规格一致', () => {
    expect(APPROVAL_SCOPES).toEqual(['once', 'session', 'workspace'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/shared/approval-rules.test.ts`

Expected: FAIL，提示找不到 `./approval-rules`。

- [ ] **Step 3: 实现纯函数**

Create `src/shared/approval-rules.ts`:

```ts
export type ApprovalAgent = 'claude' | 'codex'
export type ApprovalScope = 'once' | 'session' | 'workspace'
export const APPROVAL_SCOPES = ['once', 'session', 'workspace'] as const

const MCP_PREFIX = 'MCP · '
const BRIDGE_SERVER = 'workstationforone'
const CLAUDE_LOCAL_READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS'])

export function workspaceKey(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function isMcpToolName(agent: ApprovalAgent, toolName: string): boolean {
  return agent === 'claude' ? toolName.startsWith('mcp__') : toolName.startsWith(MCP_PREFIX)
}

export function isWorkspaceScopable(agent: ApprovalAgent, toolName: string): boolean {
  if (isMcpToolName(agent, toolName)) return true
  return agent === 'claude' && CLAUDE_LOCAL_READ_TOOLS.has(toolName)
}

export function bridgeToolName(agent: ApprovalAgent, tool: string): string {
  return agent === 'claude'
    ? `mcp__${BRIDGE_SERVER}__${tool}`
    : `${MCP_PREFIX}${BRIDGE_SERVER}/${tool}`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/shared/approval-rules.test.ts`

Expected: PASS（6 个用例）。

- [ ] **Step 5: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 均通过。

- [ ] **Step 6: 提交**

```bash
git add src/shared/approval-rules.ts src/shared/approval-rules.test.ts
git commit -m "feat: 审批规则纯函数先固定资格与规范工具名"
```

---

### Task 2: DB v27 与规则仓储

**Files:**
- Modify: `src/main/db/database.ts`（在 v26 后追加 v27）
- Create: `src/main/db/approval-rules.ts`
- Modify: `src/main/db/index.ts`
- Test: `src/main/db/approval-rules.test.ts`
- Modify: `src/main/db/agent.test.ts:73`
- Modify: `src/main/db/capabilities.test.ts:57`

**Interfaces:**
- Consumes: `ApprovalAgent`、`workspaceKey`（Task 1）。
- Produces:
  - `ApprovalRuleRecord`（在 Task 4 定义；本任务可先把类型写在 `src/shared/ipc.ts`，见 Step 3）
  - `ApprovalRuleRepository.list/find/upsert/touch/remove`
  - `DatabaseContext.approvalRules`

- [ ] **Step 1: 写失败测试**

Create `src/main/db/approval-rules.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workspaceKey } from '../../shared/approval-rules'
import { ApprovalRuleRepository } from './approval-rules'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'

const dirs: string[] = []

function seedDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-approval-rule-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new ApprovalRuleRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('迁移 v27', () => {
  it('建立 approval_rules 并推进到最新版本', () => {
    const { db } = seedDb()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'approval_rules'"
      )
      .all()
    expect(tables).toHaveLength(1)
    db.close()
  })

  it('从 v26 升级保留已有数据', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-approval-upgrade-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 26)
    )
    db.prepare(
      `INSERT INTO agent_sessions (id, agent, title, status, created_at, updated_at)
       VALUES ('s1', 'claude', '旧会话', 'idle', 1, 1)`
    ).run()

    migrate(db)

    expect(userVersion(db)).toBe(27)
    expect(db.prepare('SELECT title FROM agent_sessions WHERE id = ?').get('s1')).toEqual({
      title: '旧会话'
    })
    db.close()
  })
})

describe('ApprovalRuleRepository', () => {
  const input = {
    id: 'rule-1',
    agent: 'claude' as const,
    workspace: 'C:\\Work\\Demo',
    workspaceKey: workspaceKey('C:\\Work\\Demo'),
    toolName: 'mcp__memory__read',
    now: 100
  }

  it('插入时 last_used_at 为空，重复授予复用同一行', () => {
    const { db, repo } = seedDb()
    const first = repo.upsert(input)
    expect(first).toMatchObject({ id: 'rule-1', lastUsedAt: null })

    const second = repo.upsert({
      ...input,
      id: 'rule-2',
      workspace: 'c:/work/demo',
      now: 200
    })
    expect(second).toMatchObject({ id: 'rule-1', lastUsedAt: 200 })
    expect(repo.list()).toHaveLength(1)
    db.close()
  })

  it('touch 只更新最近使用时间，remove 删行', () => {
    const { db, repo } = seedDb()
    repo.upsert(input)
    repo.touch('rule-1', 300)
    expect(repo.find('claude', input.workspaceKey, input.toolName)?.lastUsedAt).toBe(300)
    expect(repo.remove('rule-1')).toBe(true)
    expect(repo.remove('rule-1')).toBe(false)
    expect(repo.list()).toHaveLength(0)
    db.close()
  })

  it('按最近使用与创建时间倒序排列', () => {
    const { db, repo } = seedDb()
    repo.upsert({ ...input, id: 'a', toolName: 'Read', now: 100 })
    repo.upsert({ ...input, id: 'b', toolName: 'Grep', now: 200 })
    repo.upsert({ ...input, id: 'c', toolName: 'Glob', now: 150 })
    repo.touch('a', 400)
    expect(repo.list().map((rule) => rule.id)).toEqual(['a', 'b', 'c'])
    db.close()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/main/db/approval-rules.test.ts`

Expected: FAIL，找不到 `./approval-rules`。

- [ ] **Step 3: 先加 IPC 记录类型**

在 `src/shared/ipc.ts` 顶部加：

```ts
import type { ApprovalAgent } from './approval-rules'
```

在 `ProviderApi` 之前（或 `AgentPermissionResponse` 附近）加：

```ts
export interface ApprovalRuleRecord {
  id: string
  agent: ApprovalAgent
  workspace: string
  toolName: string
  createdAt: number
  lastUsedAt: number | null
}
```

- [ ] **Step 4: 加迁移 v27**

在 `src/main/db/database.ts` 的 v26 对象后追加：

```ts
  {
    // 审批规则：只保存工作区级的精确工具放行；会话级规则只存在内存。
    version: 27,
    sql: `
      CREATE TABLE approval_rules (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex')),
        workspace TEXT NOT NULL,
        workspace_key TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        UNIQUE (agent, workspace_key, tool_name)
      );

      CREATE INDEX idx_approval_rules_used
        ON approval_rules(last_used_at DESC, created_at DESC);
    `
  }
```

- [ ] **Step 5: 实现仓储**

Create `src/main/db/approval-rules.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite'
import type { ApprovalAgent } from '../../shared/approval-rules'
import type { ApprovalRuleRecord } from '../../shared/ipc'

interface ApprovalRuleRow {
  id: string
  agent: ApprovalAgent
  workspace: string
  tool_name: string
  created_at: number
  last_used_at: number | null
}

export interface ApprovalRuleInput {
  id: string
  agent: ApprovalAgent
  workspace: string
  workspaceKey: string
  toolName: string
  now: number
}

function toRecord(row: ApprovalRuleRow): ApprovalRuleRecord {
  return {
    id: row.id,
    agent: row.agent,
    workspace: row.workspace,
    toolName: row.tool_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  }
}

const SELECT = `SELECT id, agent, workspace, tool_name, created_at, last_used_at
  FROM approval_rules`

export class ApprovalRuleRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): ApprovalRuleRecord[] {
    const rows = this.db
      .prepare(
        `${SELECT} ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC, id ASC`
      )
      .all() as unknown as ApprovalRuleRow[]
    return rows.map(toRecord)
  }

  find(
    agent: ApprovalAgent,
    workspaceKey: string,
    toolName: string
  ): ApprovalRuleRecord | undefined {
    const row = this.db
      .prepare(`${SELECT} WHERE agent = ? AND workspace_key = ? AND tool_name = ?`)
      .get(agent, workspaceKey, toolName) as unknown as ApprovalRuleRow | undefined
    return row ? toRecord(row) : undefined
  }

  upsert(input: ApprovalRuleInput): ApprovalRuleRecord {
    const existing = this.find(input.agent, input.workspaceKey, input.toolName)
    if (existing) {
      this.touch(existing.id, input.now)
      return { ...existing, lastUsedAt: input.now }
    }
    this.db
      .prepare(
        `INSERT INTO approval_rules
           (id, agent, workspace, workspace_key, tool_name, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(input.id, input.agent, input.workspace, input.workspaceKey, input.toolName, input.now)
    return {
      id: input.id,
      agent: input.agent,
      workspace: input.workspace,
      toolName: input.toolName,
      createdAt: input.now,
      lastUsedAt: null
    }
  }

  touch(id: string, at: number): void {
    this.db.prepare('UPDATE approval_rules SET last_used_at = ? WHERE id = ?').run(at, id)
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM approval_rules WHERE id = ?').run(id)
    return Number(result.changes ?? 0) > 0
  }
}
```

- [ ] **Step 6: 挂进 DatabaseContext**

Modify `src/main/db/index.ts`：

```ts
import { ApprovalRuleRepository } from './approval-rules'
```

在 `DatabaseContext` 中加：

```ts
  approvalRules: ApprovalRuleRepository
```

在 `initDatabase()` 返回对象中加：

```ts
    approvalRules: new ApprovalRuleRepository(db),
```

- [ ] **Step 7: 修正既有硬编码版本断言**

`src/main/db/agent.test.ts:73` 的 v25→v26 用例保持第一次迁移到 ≤25，只把**第二次** `migrate(db)` 改成迁移到 ≤26：

```ts
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 26)
    )

    expect(userVersion(db)).toBe(26)
```

`src/main/db/capabilities.test.ts` 顶部导入补 `MIGRATIONS`：

```ts
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'
```

第 57 行改为：

```ts
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
```

- [ ] **Step 8: 运行测试**

Run: `npm test -- src/main/db/approval-rules.test.ts src/main/db/agent.test.ts src/main/db/capabilities.test.ts`

Expected: 全部 PASS。

- [ ] **Step 9: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 通过。

- [ ] **Step 10: 提交**

```bash
git add src/shared/ipc.ts src/main/db/database.ts src/main/db/approval-rules.ts src/main/db/index.ts src/main/db/approval-rules.test.ts src/main/db/agent.test.ts src/main/db/capabilities.test.ts
git commit -m "feat: DB v27 增加工作区审批规则表与仓储"
```

---

### Task 3: 规则服务

**Files:**
- Create: `src/main/agent/approval-rules.ts`
- Test: `src/main/agent/approval-rules.test.ts`

**Interfaces:**
- Consumes: `ApprovalRuleRepository`（Task 2）、`workspaceKey/isWorkspaceScopable/isMcpToolName/bridgeToolName`（Task 1）、`AgentRepository.findSession`、`AuditLog.record`。
- Produces:
  - `interface ApprovalRuleContext { sessionId; agent; workspace }`
  - `class ApprovalRuleService`
  - `isWorkspaceEligible(agent, toolName): boolean`
  - `check(context, toolName): 'session' | 'workspace' | null`
  - `grantSession(context, toolName): void`
  - `grantWorkspace(context, toolName): void`
  - `resolveBridge(sessionId, tool): { context; toolName } | null`
  - `checkBridge(sessionId, tool): boolean`
  - `grantBridgeSession(sessionId, tool): void`
  - `grantBridgeWorkspace(sessionId, tool): void`
  - `list(): ApprovalRuleRecord[]`
  - `remove(id): void`
  - `resetSession(): void`

- [ ] **Step 1: 写失败测试**

Create `src/main/agent/approval-rules.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRuleRecord } from '../../shared/ipc'
import type { AgentRepository } from '../db/agent'
import type { ApprovalRuleRepository } from '../db/approval-rules'
import type { AuditLog } from '../db/audit'
import { ApprovalRuleService } from './approval-rules'

function rule(overrides: Partial<ApprovalRuleRecord> = {}): ApprovalRuleRecord {
  return {
    id: 'r1',
    agent: 'claude',
    workspace: 'C:\\Work\\Demo',
    toolName: 'mcp__memory__read',
    createdAt: 100,
    lastUsedAt: null,
    ...overrides
  }
}

function session(id: string, agent: 'claude' | 'codex') {
  return {
    id,
    agent,
    title: id,
    status: 'idle' as const,
    workspace: 'C:\\Work\\Demo',
    createdAt: 1,
    updatedAt: 1
  }
}

function setup(seed: ApprovalRuleRecord[] = []) {
  const rules = {
    list: vi.fn(() => seed),
    find: vi.fn((agent: string, key: string, toolName: string) =>
      seed.find(
        (item) =>
          item.agent === agent && item.toolName === toolName && key === 'c:\\work\\demo'
      )
    ),
    upsert: vi.fn((input) => {
      const created: ApprovalRuleRecord = {
        id: input.id,
        agent: input.agent,
        workspace: input.workspace,
        toolName: input.toolName,
        createdAt: input.now,
        lastUsedAt: null
      }
      seed.push(created)
      return created
    }),
    touch: vi.fn(),
    remove: vi.fn(() => true)
  }
  const sessions = {
    findSession: vi.fn((id: string) =>
      id === 's1' ? session('s1', 'claude') : id === 's2' ? session('s2', 'codex') : undefined
    )
  }
  const audit = { record: vi.fn() }
  const service = new ApprovalRuleService({
    rules: rules as unknown as ApprovalRuleRepository,
    sessions: sessions as unknown as Pick<AgentRepository, 'findSession'>,
    audit: audit as unknown as AuditLog,
    now: () => 500
  })
  return { service, rules, audit }
}

const context = { sessionId: 's1', agent: 'claude' as const, workspace: 'C:\\Work\\Demo' }

describe('ApprovalRuleService', () => {
  it('工作区命中时更新最近使用并写 auto:workspace 审计', () => {
    const { service, rules, audit } = setup([rule()])
    expect(service.check(context, 'mcp__memory__read')).toBe('workspace')
    expect(rules.touch).toHaveBeenCalledWith('r1', 500)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'mcp',
        action: 'approve',
        title: 'mcp__memory__read',
        detail: 'auto:workspace'
      })
    )
  })

  it('会话规则按会话隔离，并写 auto:session 审计', () => {
    const { service, audit } = setup()
    service.grantSession(context, 'Bash')
    expect(service.check(context, 'Bash')).toBe('session')
    expect(service.check({ ...context, sessionId: 'other' }, 'Bash')).toBeNull()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'system', detail: 'auto:session' })
    )
  })

  it('工作区规则不跨 Agent', () => {
    const { service } = setup([rule({ agent: 'codex' })])
    expect(service.check(context, 'mcp__memory__read')).toBeNull()
  })

  it('不合格工具不能授予工作区规则', () => {
    const { service, rules } = setup()
    expect(() => service.grantWorkspace(context, 'Bash')).toThrow(TypeError)
    expect(rules.upsert).not.toHaveBeenCalled()
  })

  it('授予工作区规则会写设置审计', () => {
    const { service, rules, audit } = setup()
    service.grantWorkspace(context, 'mcp__memory__read')
    expect(rules.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'claude',
        workspace: 'C:\\Work\\Demo',
        workspaceKey: 'c:\\work\\demo',
        toolName: 'mcp__memory__read'
      })
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'system',
        action: 'settings',
        detail: expect.stringContaining('approval-rule:create')
      })
    )
  })

  it('桥工具按会话 Agent 还原规范名', () => {
    const { service } = setup([
      rule({ toolName: 'mcp__workstationforone__tasks_create' })
    ])
    expect(service.resolveBridge('s1', 'tasks_create')).toMatchObject({
      toolName: 'mcp__workstationforone__tasks_create'
    })
    expect(service.checkBridge('s1', 'tasks_create')).toBe(true)
    expect(service.resolveBridge('s2', 'tasks_create')).toMatchObject({
      toolName: 'MCP · workstationforone/tasks_create'
    })
  })

  it('仓储抛错时按未命中处理', () => {
    const { service, rules } = setup([rule()])
    rules.find.mockImplementation(() => {
      throw new Error('db closed')
    })
    expect(service.check(context, 'mcp__memory__read')).toBeNull()
  })

  it('撤销规则写审计，resetSession 清空内存', () => {
    const { service, rules, audit } = setup([rule()])
    service.remove('r1')
    expect(rules.remove).toHaveBeenCalledWith('r1')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('approval-rule:revoke') })
    )
    service.grantSession(context, 'Bash')
    service.resetSession()
    expect(service.check(context, 'Bash')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/main/agent/approval-rules.test.ts`

Expected: FAIL，找不到 `./approval-rules`。

- [ ] **Step 3: 实现服务**

Create `src/main/agent/approval-rules.ts`:

```ts
import { randomUUID } from 'node:crypto'
import {
  bridgeToolName,
  isMcpToolName,
  isWorkspaceScopable,
  workspaceKey,
  type ApprovalAgent
} from '../../shared/approval-rules'
import type { ApprovalRuleRecord } from '../../shared/ipc'
import type { AgentRepository } from '../db/agent'
import type { ApprovalRuleRepository } from '../db/approval-rules'
import type { AuditLog } from '../db/audit'

export interface ApprovalRuleContext {
  sessionId: string
  agent: ApprovalAgent
  workspace: string
}

export type ApprovalRuleMatch = 'session' | 'workspace'

export interface ApprovalRuleServiceOptions {
  rules: ApprovalRuleRepository
  sessions: Pick<AgentRepository, 'findSession'>
  audit?: AuditLog
  now?: () => number
}

export class ApprovalRuleService {
  private readonly sessionAllowed = new Map<string, Set<string>>()
  private readonly now: () => number

  constructor(private readonly options: ApprovalRuleServiceOptions) {
    this.now = options.now ?? Date.now
  }

  isWorkspaceEligible(agent: ApprovalAgent, toolName: string): boolean {
    return isWorkspaceScopable(agent, toolName)
  }

  check(context: ApprovalRuleContext, toolName: string): ApprovalRuleMatch | null {
    try {
      if (this.sessionAllowed.get(context.sessionId)?.has(toolName)) {
        this.recordAuto(context, toolName, 'session')
        return 'session'
      }
      if (!isWorkspaceScopable(context.agent, toolName)) return null
      const rule = this.options.rules.find(
        context.agent,
        workspaceKey(context.workspace),
        toolName
      )
      if (!rule) return null
      this.options.rules.touch(rule.id, this.now())
      this.recordAuto(context, toolName, 'workspace')
      return 'workspace'
    } catch (error) {
      console.error('[approval-rules] 规则查询失败，按未命中处理', error)
      return null
    }
  }

  grantSession(context: ApprovalRuleContext, toolName: string): void {
    const set = this.sessionAllowed.get(context.sessionId) ?? new Set<string>()
    set.add(toolName)
    this.sessionAllowed.set(context.sessionId, set)
  }

  grantWorkspace(context: ApprovalRuleContext, toolName: string): void {
    if (!isWorkspaceScopable(context.agent, toolName)) {
      throw new TypeError('该工具不支持工作区持久规则')
    }
    const now = this.now()
    const rule = this.options.rules.upsert({
      id: `rule-${randomUUID()}`,
      agent: context.agent,
      workspace: context.workspace,
      workspaceKey: workspaceKey(context.workspace),
      toolName,
      now
    })
    this.options.audit?.record({
      at: now,
      domain: 'system',
      action: 'settings',
      targetId: rule.id,
      title: toolName,
      source: 'ui',
      detail: `approval-rule:create agent=${context.agent} workspace=${context.workspace}`
    })
  }

  resolveBridge(
    sessionId: string,
    tool: string
  ): { context: ApprovalRuleContext; toolName: string } | null {
    const session = this.options.sessions.findSession(sessionId)
    if (!session?.workspace) return null
    return {
      context: { sessionId, agent: session.agent, workspace: session.workspace },
      toolName: bridgeToolName(session.agent, tool)
    }
  }

  checkBridge(sessionId: string, tool: string): boolean {
    const resolved = this.resolveBridge(sessionId, tool)
    return resolved ? this.check(resolved.context, resolved.toolName) !== null : false
  }

  grantBridgeSession(sessionId: string, tool: string): void {
    const resolved = this.resolveBridge(sessionId, tool)
    if (resolved) this.grantSession(resolved.context, resolved.toolName)
  }

  grantBridgeWorkspace(sessionId: string, tool: string): void {
    const resolved = this.resolveBridge(sessionId, tool)
    if (resolved) this.grantWorkspace(resolved.context, resolved.toolName)
  }

  list(): ApprovalRuleRecord[] {
    return this.options.rules.list()
  }

  remove(id: string): void {
    const rule = this.options.rules.list().find((item) => item.id === id)
    if (!rule) return
    if (!this.options.rules.remove(id)) return
    this.options.audit?.record({
      at: this.now(),
      domain: 'system',
      action: 'settings',
      targetId: rule.id,
      title: rule.toolName,
      source: 'ui',
      detail: `approval-rule:revoke agent=${rule.agent} workspace=${rule.workspace}`
    })
  }

  resetSession(): void {
    this.sessionAllowed.clear()
  }

  private recordAuto(
    context: ApprovalRuleContext,
    toolName: string,
    scope: ApprovalRuleMatch
  ): void {
    this.options.audit?.record({
      at: this.now(),
      domain: isMcpToolName(context.agent, toolName) ? 'mcp' : 'system',
      action: 'approve',
      targetId: context.sessionId,
      title: toolName,
      source: 'agent',
      detail: `auto:${scope}`
    })
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/main/agent/approval-rules.test.ts`

Expected: PASS。

- [ ] **Step 5: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/main/agent/approval-rules.ts src/main/agent/approval-rules.test.ts
git commit -m "feat: 审批规则服务统一会话与工作区命中"
```

---

### Task 4: IPC 契约、preload 与参数校验

**Files:**
- Modify: `src/shared/ipc.ts`（Task 2 已加 `ApprovalRuleRecord`，本任务补 `scope`、decision、channel、`AgentApi`）
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/agent.ts`（仅 `assertPermissionResponse`）
- Modify: `src/main/ipc/mcp.ts`
- Test: `src/main/ipc/agent.test.ts`
- Test: `src/main/ipc/mcp.test.ts`

**Interfaces:**
- Consumes: `ApprovalScope`、`APPROVAL_SCOPES`（Task 1）。
- Produces:
  - `AgentPermissionResponse.scope?: ApprovalScope`
  - `McpPermissionDecision` 含 `'workspace'`
  - `IPC_CHANNELS.agentApprovalRules / agentRemoveApprovalRule`
  - `AgentApi.approvalRules()/removeApprovalRule(id)`

- [ ] **Step 1: 写失败测试**

在 `src/main/ipc/agent.test.ts` 的「工具审批响应」describe 中追加：

```ts
  it('允许时可带作用域，拒绝时忽略作用域', () => {
    expect(
      registerAgentHandlersIPC.assertPermissionResponse({
        requestId: 'p1',
        allow: true,
        scope: 'workspace'
      })
    ).toEqual({ requestId: 'p1', allow: true, scope: 'workspace' })

    expect(
      registerAgentHandlersIPC.assertPermissionResponse({
        requestId: 'p1',
        allow: false,
        scope: 'workspace',
        message: '用户拒绝'
      })
    ).toEqual({ requestId: 'p1', allow: false, message: '用户拒绝' })
  })

  it('拒绝未知作用域', () => {
    expect(() =>
      registerAgentHandlersIPC.assertPermissionResponse({
        requestId: 'p1',
        allow: true,
        scope: 'always'
      })
    ).toThrow(TypeError)
  })
```

在 `src/main/ipc/mcp.test.ts` 的审批响应用例中追加：

```ts
    expect(
      registerMcpHandlersIPC.assertPermissionResponse({
        requestId: 'p1',
        decision: 'workspace'
      })
    ).toEqual({ requestId: 'p1', decision: 'workspace' })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/main/ipc/agent.test.ts src/main/ipc/mcp.test.ts`

Expected: FAIL，`scope` 被丢弃、`workspace` 决定被拒绝。

- [ ] **Step 3: 改共享契约**

`src/shared/ipc.ts` 顶部：

```ts
import type { ApprovalAgent, ApprovalScope } from './approval-rules'

export { APPROVAL_SCOPES } from './approval-rules'
export type { ApprovalAgent, ApprovalScope } from './approval-rules'
```

改 `AgentPermissionResponse`：

```ts
export interface AgentPermissionResponse {
  requestId: string
  allow: boolean
  /** 允许时的作用域；省略按 once。拒绝时忽略 */
  scope?: ApprovalScope
  /** 拒绝时回给 CLI 的原因，省略时用“用户拒绝” */
  message?: string
}
```

改 decision：

```ts
export type McpPermissionDecision = 'once' | 'session' | 'workspace' | 'deny'
```

`AgentApi` 加：

```ts
  approvalRules: () => Promise<ApprovalRuleRecord[]>
  removeApprovalRule: (id: string) => Promise<void>
```

`IPC_CHANNELS` 在 `agentImportSession` 后加：

```ts
  agentApprovalRules: 'agent:approval-rules',
  agentRemoveApprovalRule: 'agent:remove-approval-rule',
```

- [ ] **Step 4: 改参数校验**

`src/main/ipc/agent.ts` 顶部导入：

```ts
import { APPROVAL_SCOPES, type ApprovalScope } from '../../shared/approval-rules'
```

把 `assertPermissionResponse` 替换为：

```ts
export function assertPermissionResponse(value: unknown): AgentPermissionResponse {
  if (typeof value !== 'object' || value === null) throw new TypeError('审批响应必须是对象')
  const input = value as Record<string, unknown>
  if (typeof input.allow !== 'boolean') throw new TypeError('审批结果无效')
  const result: AgentPermissionResponse = {
    requestId: assertId(input.requestId, '审批请求 id'),
    allow: input.allow
  }
  if (input.allow === true && input.scope !== undefined) {
    if (
      typeof input.scope !== 'string' ||
      !(APPROVAL_SCOPES as readonly string[]).includes(input.scope)
    ) {
      throw new TypeError('审批作用域无效')
    }
    result.scope = input.scope as ApprovalScope
  }
  if (input.message !== undefined) {
    if (typeof input.message !== 'string') throw new TypeError('拒绝原因无效')
    const message = input.message.trim()
    if (message.length > 500) throw new TypeError('拒绝原因过长')
    if (message) result.message = message
  }
  return result
}
```

`src/main/ipc/mcp.ts`：

```ts
const DECISIONS: McpPermissionDecision[] = ['once', 'session', 'workspace', 'deny']
```

- [ ] **Step 5: 暴露 preload**

`src/preload/index.ts` 的 `agent` 组末尾加：

```ts
    approvalRules: () => ipcRenderer.invoke(IPC_CHANNELS.agentApprovalRules),
    removeApprovalRule: (id) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentRemoveApprovalRule, id),
```

- [ ] **Step 6: 运行测试**

Run: `npm test -- src/main/ipc/agent.test.ts src/main/ipc/mcp.test.ts`

Expected: PASS。

- [ ] **Step 7: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 通过。

- [ ] **Step 8: 提交**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc/agent.ts src/main/ipc/mcp.ts src/main/ipc/agent.test.ts src/main/ipc/mcp.test.ts
git commit -m "feat: 审批 IPC 支持作用域与规则列表"
```

---

### Task 5: Claude `can_use_tool` 自动批准

**Files:**
- Modify: `src/main/agent/claude.ts`
- Test: `src/main/agent/claude.test.ts`

**Interfaces:**
- Consumes: 无（回调由主进程注入）。
- Produces: `ClaudeRunOptions.autoApprove?: (toolName: string) => 'session' | 'workspace' | null`。

- [ ] **Step 1: 写失败测试**

在 `src/main/agent/claude.test.ts` 顶部 `run()` 增加可选参数：

```ts
function run(
  prompt: string,
  resumeId?: string,
  cli: { bin: string; prefixArgs: string[]; viaNode: boolean } | null = {
    bin: process.execPath,
    prefixArgs: [STUB],
    viaNode: true
  },
  autoApprove?: (toolName: string) => 'session' | 'workspace' | null
) {
  return new Promise<{
    events: AgentRunEvent[]
    exit: { code: number | null; cancelled: boolean }
  }>((done) => {
    const events: AgentRunEvent[] = []
    startClaudeRun({
      prompt,
      resumeId,
      cwd: process.cwd(),
      cli,
      ...(autoApprove ? { autoApprove } : {}),
      onEvent: (event) => events.push(event),
      onExit: (info) => done({ events, exit: { code: info.code, cancelled: info.cancelled } })
    })
  })
}
```

在「转发 can_use_tool」之后追加：

```ts
  it('规则命中时不发 permission 事件，直接回写 allow', async () => {
    const asked: string[] = []
    const { events, exit } = await run('需要审批', undefined, undefined, (toolName) => {
      asked.push(toolName)
      return 'workspace'
    })

    expect(asked).toEqual(['Write'])
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(
      events.some((event) => event.kind === 'text' && event.text.includes('已写入临时文件'))
    ).toBe(true)
    expect(exit.code).toBe(0)
  })

  it('自动批准不作用于 AskUserQuestion', async () => {
    const { events } = await run('需要问答', undefined, undefined, () => 'workspace')
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(
      events.some((event) => event.kind === 'text' && event.text.includes('问答被拒绝'))
    ).toBe(true)
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/main/agent/claude.test.ts`

Expected: FAIL，`autoApprove` 不是已知字段 / 仍出现 permission 事件。

- [ ] **Step 3: 实现**

`src/main/agent/claude.ts` 的 `ClaudeRunOptions` 加：

```ts
  /** 规则命中时在发卡前直接放行；返回命中作用域或 null */
  autoApprove?: (toolName: string) => 'session' | 'workspace' | null
```

`handleControlRequest` 中，把原来的这一段：

```ts
    const input =
      typeof entry.input === 'object' && entry.input !== null
        ? (entry.input as Record<string, unknown>)
        : {}
    const inputJson = JSON.stringify(input)
```

替换为：

```ts
    const input =
      typeof entry.input === 'object' && entry.input !== null
        ? (entry.input as Record<string, unknown>)
        : {}
    if (options.autoApprove?.(toolName)) {
      writeControlResponse(requestId, {
        behavior: 'allow',
        updatedInput: input,
        toolUseID: toolUseId
      })
      return true
    }
    const inputJson = JSON.stringify(input)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/main/agent/claude.test.ts`

Expected: PASS。

- [ ] **Step 5: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/main/agent/claude.ts src/main/agent/claude.test.ts
git commit -m "feat: Claude 工具审批支持规则命中前的自动放行"
```

---

### Task 6: Codex app-server 自动批准

**Files:**
- Modify: `src/main/agent/codex-app-server.ts`
- Test: `src/main/agent/codex-app-server.test.ts`

**Interfaces:**
- Consumes: 无（回调由主进程注入）。
- Produces: `CodexAppServerRunOptions.autoApprove?: (toolName: string) => 'session' | 'workspace' | null`。

- [ ] **Step 1: 写失败测试**

`src/main/agent/codex-app-server.test.ts` 的 `run()` options 增加：

```ts
    autoApprove?: (toolName: string) => 'session' | 'workspace' | null
```

`startCodexAppServerRun` 调用中加：

```ts
      ...(options.autoApprove ? { autoApprove: options.autoApprove } : {}),
```

追加用例：

```ts
  it('MCP 规则命中时不弹卡并回 accept', async () => {
    const { events, done } = run('MCP 写', { autoApprove: () => 'workspace' })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(streamText(events)).toBe('已允许 MCP 调用。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('Shell 会话规则命中时不弹卡', async () => {
    const asked: string[] = []
    const { events, done } = run('写一个文件', {
      autoApprove: (toolName) => {
        asked.push(toolName)
        return toolName === 'Shell' ? 'session' : null
      }
    })
    const exit = await done

    expect(asked).toEqual(['Shell'])
    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(streamText(events)).toBe('已允许写入。')
  })

  it('Permissions 未命中规则时仍发卡', async () => {
    const { events, done } = run('额外权限', {
      autoApprove: () => null,
      onPermission: (active) => {
        const request = events.find((event) => event.kind === 'permission')
        if (request?.kind !== 'permission') return
        expect(request.request.toolName).toBe('Permissions')
        expect(active.respondPermission(request.request.requestId, 'allow')).toBe(true)
      }
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(streamText(events)).toBe('已授予额外权限。')
  })

  it('自动批准不覆盖外部 MCP 的 deny 策略', async () => {
    const { events, done } = run('外部 MCP 禁止', {
      externalMcp: externalPolicy('blocked', 'deny'),
      autoApprove: () => 'workspace'
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(streamText(events)).toBe('已拒绝外部 MCP。')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/main/agent/codex-app-server.test.ts`

Expected: FAIL，仍出现 permission 事件或类型不接受 `autoApprove`。

- [ ] **Step 3: 实现**

`CodexAppServerRunOptions` 加：

```ts
  /** 规则命中时在发卡前直接放行；返回命中作用域或 null */
  autoApprove?: (toolName: string) => 'session' | 'workspace' | null
```

`handleServerRequest` 的普通审批分支改为：

```ts
    const approval = approvalRequest(method, params, parser)
    if (approval) {
      if (options.autoApprove?.(approval.request.toolName)) {
        respondApproval(id, method, params, true)
        return
      }
      const requestId = String(id)
      approval.request.requestId = requestId
      pendingApprovals.set(requestId, { id, method, params })
      options.onEvent({ kind: 'permission', request: approval.request })
      return
    }
```

`mcp_elicitation` 分支中，在 `externalPolicy === 'deny'` 判断之后、构建 `description` 之前插入：

```ts
        const toolName = `MCP · ${serverName}/${tool}`
        if (options.autoApprove?.(toolName)) {
          send({ id, result: { action: 'accept', content: {}, _meta: null } })
          return
        }
        const description = asString(meta?.tool_description)
```

并把该分支原请求对象里的 `toolName: \`MCP · ${serverName}/${tool}\`` 改成 `toolName`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/main/agent/codex-app-server.test.ts`

Expected: PASS。

- [ ] **Step 5: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/main/agent/codex-app-server.ts src/main/agent/codex-app-server.test.ts
git commit -m "feat: Codex app-server 审批支持规则命中自动接受"
```

---

### Task 7: 本地 MCP 桥预检与 broker 回调化

**Files:**
- Modify: `src/main/mcp/server.ts`
- Modify: `src/main/mcp/permissions.ts`
- Modify: `src/main/index.ts`
- Test: `src/main/mcp/server.test.ts`
- Test: `src/main/mcp/permissions.test.ts`

**Interfaces:**
- Consumes: `ApprovalRuleService`（Task 3）、`DatabaseContext.approvalRules`（Task 2）。
- Produces:
  - `McpHooks.isPreApproved?: (sessionId: string, tool: string) => boolean`（替换 `isSessionAllowed`）
  - `McpPermissionOutcome` 增加 `'workspace'`
  - `McpPermissionBrokerOptions.isPreApproved/grantSession/grantWorkspace`
  - broker 不再有 `isSessionAllowed()` 方法
  - `index.ts` 里 broker、bridge 与规则服务完成接线

- [ ] **Step 1: 写失败测试**

`src/main/mcp/permissions.test.ts` 重写 `setup()`：

```ts
function setup(timeoutMs = 30) {
  const sent: McpPermissionRequest[] = []
  const audit = { record: vi.fn() }
  const allowed = new Set<string>()
  const grantSession = vi.fn((sessionId: string, tool: string) => {
    allowed.add(`${sessionId}:${tool}`)
  })
  const grantWorkspace = vi.fn()
  const broker = new McpPermissionBroker({
    send: (request) => {
      sent.push(request)
      return true
    },
    audit: audit as unknown as AuditLog,
    timeoutMs,
    isPreApproved: (sessionId, tool) => allowed.has(`${sessionId}:${tool}`),
    grantSession,
    grantWorkspace
  })
  return { broker, sent, audit, grantSession, grantWorkspace, allowed }
}
```

把「本会话允许只记住当前会话 + 当前工具」保留，改断言：

```ts
    expect(grantSession).toHaveBeenCalledWith('s1', 'tasks_create')
    await expect(broker.request(input('s1'))).resolves.toBe('session')
    await expect(broker.request(input('s2'))).resolves.toBe('once')
```

最后一行会弹卡，因此先 `broker.respond(sent[1].requestId, 'deny')` 再等待；按现有两张卡的顺序写：

```ts
  it('本会话允许只记住当前会话 + 当前工具', async () => {
    const { broker, sent, grantSession } = setup()
    const first = broker.request(input('s1'))
    broker.respond(sent[0].requestId, 'session')
    await expect(first).resolves.toBe('session')
    expect(grantSession).toHaveBeenCalledWith('s1', 'tasks_create')

    await expect(broker.request(input('s1'))).resolves.toBe('session')
    expect(sent).toHaveLength(1)

    const otherTool = broker.request(input('s1', 'tasks_update'))
    expect(sent).toHaveLength(2)
    broker.respond(sent[1].requestId, 'deny')
    await expect(otherTool).resolves.toBe('deny')
  })
```

追加：

```ts
  it('工作区允许会授予持久规则并放行当前请求', async () => {
    const { broker, sent, grantWorkspace } = setup()
    const first = broker.request(input('s1'))
    expect(broker.respond(sent[0].requestId, 'workspace')).toBe(true)
    await expect(first).resolves.toBe('workspace')
    expect(grantWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', tool: 'tasks_create' })
    )
  })

  it('规则保存失败仍放行当前请求', async () => {
    const { broker, sent, grantWorkspace } = setup()
    grantWorkspace.mockImplementation(() => {
      throw new Error('db closed')
    })
    const first = broker.request(input('s1'))
    expect(broker.respond(sent[0].requestId, 'workspace')).toBe(true)
    await expect(first).resolves.toBe('workspace')
  })
```

把「关闭队列」用例最后的 `expect(broker.isSessionAllowed(...)).toBe(false)` 删除。

`src/main/mcp/server.test.ts`：把现有 `isSessionAllowed: () => false` 改成 `isPreApproved: () => false`；追加：

```ts
  it('预检命中时跳过审批并照常写入', async () => {
    const source = data()
    const create = vi.fn(source.tasks.create)
    source.tasks.create = create
    const requestPermission = vi.fn(async () => 'deny' as const)
    bridge = new McpBridge(source, 'test', {
      mode: () => 'ask',
      requestPermission,
      isPreApproved: () => true
    })
    await bridge.start()
    const endpoint = bridge.issue('s-pre')
    if (!endpoint) throw new Error('没有 issue token')

    const response = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'tasks_create',
        arguments: { title: '预检通过', idempotency_key: 'pre-1' }
      }
    })
    const body = (await response.json()) as {
      result: { isError?: boolean; content: { text: string }[] }
    }
    expect(body.result.isError).toBeUndefined()
    expect(create).toHaveBeenCalledTimes(1)
    expect(requestPermission).not.toHaveBeenCalled()
    expect(source.audit.recordStrict).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'mcp', action: 'write', title: 'tasks_create' })
    )
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/main/mcp/server.test.ts src/main/mcp/permissions.test.ts`

Expected: FAIL，`isPreApproved` / `workspace` 未被支持。

- [ ] **Step 3: 改桥钩子**

`src/main/mcp/server.ts`：`McpHooks` 把

```ts
  isSessionAllowed?: (sessionId: string, tool: string) => boolean
```

改为：

```ts
  /** 本会话已允许或命中工作区审批规则；命中则跳过询问卡 */
  isPreApproved?: (sessionId: string, tool: string) => boolean
```

在 `tools/call` 的 `mode === 'ask'` 分支把

```ts
          if (this.hooks.isSessionAllowed?.(sessionId, name)) {
```

改为：

```ts
          if (this.hooks.isPreApproved?.(sessionId, name)) {
```

并把同一分支里的允许判断：

```ts
            allowed = decision === 'once' || decision === 'session'
```

改为：

```ts
            allowed = decision === 'once' || decision === 'session' || decision === 'workspace'
```

- [ ] **Step 4: 改 broker**

`src/main/mcp/permissions.ts` 整体改为：

```ts
import { randomUUID } from 'node:crypto'
import type { McpDomain, McpPermissionRequest } from '../../shared/ipc'
import type { AuditLog } from '../db/audit'

export type McpPermissionOutcome = 'once' | 'session' | 'workspace' | 'deny' | 'timeout'

export interface McpPermissionInput {
  sessionId: string
  domain: McpDomain
  tool: string
  detail: string
  preview: string
}

interface PendingPermission {
  request: McpPermissionRequest
  resolve: (outcome: McpPermissionOutcome) => void
  timer: NodeJS.Timeout | null
}

export interface McpPermissionBrokerOptions {
  /** 返回 false 表示没有可用窗口，直接拒绝 */
  send: (request: McpPermissionRequest) => boolean
  audit?: AuditLog
  timeoutMs?: number
  /** 与桥钩子同义：本会话已允许或命中工作区规则 */
  isPreApproved?: (sessionId: string, tool: string) => boolean
  grantSession?: (sessionId: string, tool: string) => void
  grantWorkspace?: (request: McpPermissionRequest) => void
}

const DEFAULT_TIMEOUT = 60_000

/**
 * MCP 写入询问队列：一次只展示一张卡。
 * 会话 / 工作区规则由 ApprovalRuleService 持有；这里只负责排队、超时与审计。
 * 超时、窗口不可用、回合取消都按拒绝处理，绝不默认放行。
 */
export class McpPermissionBroker {
  private readonly pending = new Map<string, PendingPermission>()
  private readonly queue: string[] = []
  private current: string | null = null
  private readonly timeoutMs: number

  constructor(private readonly options: McpPermissionBrokerOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  }

  request(input: McpPermissionInput): Promise<McpPermissionOutcome> {
    if (this.options.isPreApproved?.(input.sessionId, input.tool)) {
      return Promise.resolve('session')
    }
    const request: McpPermissionRequest = {
      requestId: randomUUID(),
      sessionId: input.sessionId,
      domain: input.domain,
      tool: input.tool,
      detail: input.detail,
      preview: input.preview,
      createdAt: Date.now()
    }
    return new Promise((resolve) => {
      this.pending.set(request.requestId, { request, resolve, timer: null })
      this.queue.push(request.requestId)
      this.pump()
    })
  }

  respond(requestId: string, decision: 'once' | 'session' | 'workspace' | 'deny'): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    try {
      if (decision === 'session') {
        this.options.grantSession?.(entry.request.sessionId, entry.request.tool)
      }
      if (decision === 'workspace') {
        this.options.grantWorkspace?.(entry.request)
      }
    } catch (error) {
      // 规则落库失败不能让当前审批悬挂
      console.error('[mcp] 保存审批规则失败', error)
    }
    this.finish(requestId, decision)
    return true
  }

  cancelSession(sessionId: string): void {
    const ids = [...this.pending.entries()]
      .filter(([, entry]) => entry.request.sessionId === sessionId)
      .map(([id]) => id)
    for (const id of ids) this.finish(id, 'deny')
  }

  close(): void {
    for (const id of [...this.pending.keys()]) this.finish(id, 'deny')
  }

  private pump(): void {
    if (this.current) return
    const id = this.queue.shift()
    if (!id) return
    const entry = this.pending.get(id)
    if (!entry) {
      this.pump()
      return
    }
    this.current = id
    if (!this.options.send(entry.request)) {
      this.finish(id, 'deny')
      return
    }
    entry.timer = setTimeout(() => this.finish(id, 'timeout'), this.timeoutMs)
  }

  private finish(id: string, outcome: McpPermissionOutcome): void {
    const entry = this.pending.get(id)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    this.pending.delete(id)
    const queued = this.queue.indexOf(id)
    if (queued >= 0) this.queue.splice(queued, 1)
    this.options.audit?.record({
      at: Date.now(),
      domain: 'mcp',
      action: outcome === 'deny' || outcome === 'timeout' ? 'deny' : 'approve',
      targetId: entry.request.sessionId,
      title: entry.request.tool,
      source: 'agent',
      detail: `${entry.request.domain} · ${outcome}`
    })
    entry.resolve(outcome)
    if (this.current === id) {
      this.current = null
      this.pump()
    }
  }
}
```

- [ ] **Step 5: 装配 index.ts（服务、broker、bridge）**

`src/main/index.ts` 顶部加：

```ts
import { ApprovalRuleService } from './agent/approval-rules'
```

在 `const database = initDatabase()` 之后、`new McpPermissionBroker` 之前加：

```ts
    const approvalRules = new ApprovalRuleService({
      rules: database.approvalRules,
      sessions: database.agent,
      audit: database.audit
    })
```

把 `new McpPermissionBroker({ send, audit })` 改为：

```ts
    const permissions = new McpPermissionBroker({
      send: (request) => {
        const win = mainWindow
        if (!win || win.isDestroyed()) return false
        win.webContents.send(IPC_CHANNELS.mcpPermission, request)
        return true
      },
      audit: database.audit,
      isPreApproved: (sessionId, tool) => approvalRules.checkBridge(sessionId, tool),
      grantSession: (sessionId, tool) => approvalRules.grantBridgeSession(sessionId, tool),
      grantWorkspace: (request) =>
        approvalRules.grantBridgeWorkspace(request.sessionId, request.tool)
    })
```

把 bridge 钩子的：

```ts
        isSessionAllowed: (sessionId, tool) => permissions.isSessionAllowed(sessionId, tool)
```

改为：

```ts
        isPreApproved: (sessionId, tool) => approvalRules.checkBridge(sessionId, tool)
```

- [ ] **Step 6: 检查残留引用**

Run: `grep -rn "isSessionAllowed" src scripts`

Expected: 无输出。

- [ ] **Step 7: 运行测试**

Run: `npm test -- src/main/mcp/server.test.ts src/main/mcp/permissions.test.ts`

Expected: PASS。

- [ ] **Step 8: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 通过。

- [ ] **Step 9: 提交**

```bash
git add src/main/mcp/server.ts src/main/mcp/permissions.ts src/main/index.ts src/main/mcp/server.test.ts src/main/mcp/permissions.test.ts
git commit -m "feat: MCP 桥预检审批规则并接管 broker 作用域回调"
```

---

### Task 8: 主进程接线（handler 上下文、规则 IPC、index 装配）

**Files:**
- Modify: `src/main/ipc/agent.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/db/index.ts`（Task 2 已加仓储，确认存在）
- Test: `src/main/ipc/agent.test.ts`（Task 4 已覆盖 scope；本任务补 `assertPermissionResponse` 的缺省行为如需要）

**Interfaces:**
- Consumes: `ApprovalRuleService`（Task 3）、`ApprovalRuleRepository`（Task 2）、新 IPC 通道（Task 4）、桥钩子（Task 7）。
- Produces:
  - `registerAgentHandlers(options: AgentHandlerOptions)`
  - `AgentHandlerOptions.approvalRules`
  - `AgentPermissionRequest.workspaceScope`（在 `src/shared/agent-stream.ts` 加字段）

- [ ] **Step 1: 加事件字段**

在 `src/shared/agent-stream.ts` 的 `AgentPermissionRequest` 加：

```ts
  /** 主进程判定该工具是否可「此工作区允许」；渲染层只用于决定按钮是否显示 */
  workspaceScope?: boolean
```

- [ ] **Step 2: 确认类型检查起点**

Run: `npm run typecheck`

Expected: 通过（该字段可选，不破坏现有类型）。本任务的 handler 接线由 Task 11 的冒烟与 Task 12 的运行时断言覆盖；`assertPermissionResponse` 的缺省行为已在 Task 4 覆盖。

- [ ] **Step 3: 改 handler 签名与运行上下文**

`src/main/ipc/agent.ts` 顶部加：

```ts
import type { ApprovalRuleService } from '../agent/approval-rules'
```

把：

```ts
interface ActiveRun {
  sessionId: string
  cancel: () => void
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => boolean
}
```

改为：

```ts
interface ActiveRun {
  sessionId: string
  agent: 'claude' | 'codex'
  workspace: string
  cancel: () => void
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => boolean
}

export interface AgentHandlerOptions {
  getWindow: () => BrowserWindow | null
  repository: AgentRepository
  cli?: AgentCli | null
  getProvider?: (target: ProviderTarget) => ProviderRuntime | undefined
  codexCli?: AgentCli | null
  mcp?: McpAccess | null
  cancelPermissions?: (sessionId: string) => void
  codexHome?: string
  capabilities?: AgentCapabilityRuntime
  approvalRules: ApprovalRuleService
}
```

把 `registerAgentHandlers` 的整段位置参数替换为：

```ts
export function registerAgentHandlers(options: AgentHandlerOptions): void {
  const {
    getWindow,
    repository,
    cli,
    getProvider,
    codexCli,
    mcp,
    cancelPermissions,
    codexHome,
    capabilities,
    approvalRules
  } = options
```

函数体内其余引用不变。

- [ ] **Step 4: 记录 toolName 与 workspaceScope**

`permissionRuns` 类型改为：

```ts
  const permissionRuns = new Map<
    string,
    { runId: string; requestId: string; toolName: string }
  >()
```

`agent:send` 里的 `emit` 改为：

```ts
    const emit = (runEvent: AgentRunEvent) => {
      let event = runEvent
      if (runEvent.kind === 'result') runResult = runEvent
      if (runEvent.kind === 'permission') {
        const scoped = `${runId}:${runEvent.request.requestId}`
        permissionRuns.set(scoped, {
          runId,
          requestId: runEvent.request.requestId,
          toolName: runEvent.request.toolName
        })
        event = {
          ...runEvent,
          request: {
            ...runEvent.request,
            requestId: scoped,
            workspaceScope: approvalRules.isWorkspaceEligible(
              input.agent,
              runEvent.request.toolName
            )
          }
        }
      }
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC.agentEvent, { runId, event })
    }
```

- [ ] **Step 5: 注入 autoApprove**

在 `agent:send` 里、`handle` 之前加：

```ts
    const autoApprove = (toolName: string) =>
      approvalRules.check({ sessionId: input.sessionId, agent: input.agent, workspace }, toolName)
```

Codex app-server 的调用中，在 `home: codexHome,` 后加一行：

```ts
                home: codexHome,
                autoApprove,
                ...(mcpEndpoint ? { mcp: mcpEndpoint } : {}),
```

Claude 的调用中，在 `cwd: workspace,` 后加一行：

```ts
              cwd: workspace,
              autoApprove,
              ...(provider ? { provider } : {}),
```

`runs.set(runId, { ... })` 改为：

```ts
    runs.set(runId, {
      sessionId: input.sessionId,
      agent: input.agent,
      workspace,
      cancel: handle.cancel,
      respondPermission: handle.respondPermission
    })
```

- [ ] **Step 6: 回写作用域与规则**

把 `agent:permission-response` 的 handler 替换为：

```ts
  ipcMain.handle(IPC.agentPermissionResponse, (_event, value: unknown) => {
    const response = assertPermissionResponse(value)
    const owner = permissionRuns.get(response.requestId)
    const run = owner ? runs.get(owner.runId) : undefined
    if (!owner || !run) return false

    const scope = response.allow ? (response.scope ?? 'once') : 'once'
    if (
      response.allow &&
      scope === 'workspace' &&
      !approvalRules.isWorkspaceEligible(run.agent, owner.toolName)
    ) {
      throw new TypeError('该工具不支持工作区持久规则')
    }
    if (response.allow && scope === 'workspace') {
      try {
        approvalRules.grantWorkspace(
          { sessionId: run.sessionId, agent: run.agent, workspace: run.workspace },
          owner.toolName
        )
      } catch (error) {
        console.error('[agent] 保存审批规则失败', error)
      }
    }
    if (response.allow && scope === 'session') {
      approvalRules.grantSession(
        { sessionId: run.sessionId, agent: run.agent, workspace: run.workspace },
        owner.toolName
      )
    }

    const ok = run.respondPermission(
      owner.requestId,
      response.allow ? 'allow' : 'deny',
      response.message
    )
    permissionRuns.delete(response.requestId)
    return ok
  })
```

- [ ] **Step 7: 加规则 IPC**

在 `agent:usage` 附近加：

```ts
  ipcMain.handle(IPC.agentApprovalRules, () => approvalRules.list())

  ipcMain.handle(IPC.agentRemoveApprovalRule, (_event, id: unknown) => {
    approvalRules.remove(assertId(id, '规则 id'))
  })
```

- [ ] **Step 8: 改 `registerAgentHandlers` 调用**

`ApprovalRuleService`、broker 与 bridge 的装配已在 Task 7 完成；本步只把 `src/main/index.ts` 里的位置参数调用改为：

```ts
    registerAgentHandlers({
      getWindow: () => mainWindow,
      repository: database.agent,
      getProvider: (target) => providers.runtime(target),
      mcp: mcpBridge,
      cancelPermissions: (sessionId) => mcpPermissions?.cancelSession(sessionId),
      codexHome: join(dirname(database.file), 'codex-home'),
      capabilities: agentCapabilityRuntime(capabilities),
      approvalRules
    })
```

注意：`registerAgentHandlers` 的 `cli` / `codexCli` 不传时保持 `undefined`，与旧调用一致；`getProvider` 不能丢。

- [ ] **Step 9: 运行相关测试**

Run: `npm test -- src/main/ipc/agent.test.ts src/main/db/approval-rules.test.ts src/main/agent/approval-rules.test.ts`

Expected: PASS。

- [ ] **Step 10: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 通过。

- [ ] **Step 11: 提交**

```bash
git add src/shared/agent-stream.ts src/main/ipc/agent.ts src/main/index.ts src/main/db/index.ts
git commit -m "feat: 主进程接线审批规则，作用域由请求上下文推导"
```

---

### Task 9: 渲染层审批卡与回写

**Files:**
- Modify: `src/renderer/src/components/agent/ToolApprovalCard.tsx`
- Modify: `src/renderer/src/components/agent/McpApprovalCard.tsx`
- Modify: `src/renderer/src/components/agent/AgentDock.tsx`
- Modify: `src/renderer/src/styles/sections/08-dock.css`

**Interfaces:**
- Consumes: `ToolPermission.workspaceScope`（Task 8）、`McpPermissionDecision`（Task 4）。
- Produces: 工具卡 / MCP 卡的四按钮作用域；AgentDock 回写 `scope`。

- [ ] **Step 1: 改工具卡**

`ToolApprovalCard.tsx` 整体替换为：

```tsx
import { useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import type { ToolPermission } from '../../types'

type ToolDecision = 'once' | 'session' | 'workspace' | 'deny'

interface ToolApprovalCardProps {
  request: ToolPermission
  onResolve: (decision: ToolDecision) => void
}

export function ToolApprovalCard({ request, onResolve }: ToolApprovalCardProps) {
  const [busy, setBusy] = useState(false)

  const resolve = (decision: ToolDecision) => {
    if (busy) return
    setBusy(true)
    onResolve(decision)
  }

  return (
    <m.section
      className="w1-perm w1-toolperm"
      aria-label="工具审批请求"
      initial={{ opacity: 0, transform: 'translateY(8px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      exit={{ opacity: 0, transform: 'translateY(8px)', transition: { duration: DURATION.fast } }}
      transition={{ duration: DURATION.permissionIn, ease: EASE_OUT }}
    >
      <span className="w1-permglow" aria-hidden="true" />
      <div className="w1-ph">
        <span className="w1-pi">!</span>
        <span>// 工具审批</span>
        <time>{request.toolName} · 待确认</time>
      </div>
      <p>{request.description ?? `Agent 请求使用 ${request.toolName}。`}</p>
      <div className="w1-toolinput">
        <div className="w1-toolrow">
          <span>工具</span>
          <b>{request.toolName}</b>
        </div>
        {request.detail ? (
          <div className="w1-toolrow">
            <span>目标</span>
            <b>{request.detail}</b>
          </div>
        ) : null}
        <pre>{request.inputPreview || '{}'}</pre>
      </div>
      <p className="w1-toolhint">
        {request.workspaceScope
          ? '本会话允许只在应用运行期间有效；此工作区允许会记住该工具，对该工作区里同 Agent 的会话都生效，可在设置里撤销。'
          : request.toolName === 'Permissions'
            ? 'Bash、写入类工具与额外权限只能本会话允许或单次允许，不会写入持久规则。本会话允许会让本会话之后的额外权限请求自动通过。'
            : 'Bash、写入类工具与额外权限只能本会话允许或单次允许，不会写入持久规则。'}
      </p>
      <div className="w1-pacts">
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('deny')}>
          拒绝
        </button>
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('session')}>
          本会话允许
        </button>
        {request.workspaceScope ? (
          <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('workspace')}>
            此工作区允许
          </button>
        ) : null}
        <button className="w1-pb pri" type="button" disabled={busy} onClick={() => resolve('once')}>
          允许一次
        </button>
      </div>
    </m.section>
  )
}
```

- [ ] **Step 2: 改 MCP 卡**

`McpApprovalCard.tsx` 的 hint 改为：

```tsx
      <p className="w1-toolhint">
        60 秒无操作按拒绝处理。此工作区允许只对这一种工具生效，对该工作区里同 Agent 的会话都生效，可在设置里撤销。
      </p>
```

按钮组改为：

```tsx
      <div className="w1-pacts">
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('deny')}>
          拒绝
        </button>
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('session')}>
          本会话允许
        </button>
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('workspace')}>
          此工作区允许
        </button>
        <button className="w1-pb pri" type="button" disabled={busy} onClick={() => resolve('once')}>
          允许一次
        </button>
      </div>
```

- [ ] **Step 3: 改 AgentDock**

`AgentDock.tsx` 顶部导入：

```ts
import type { McpPermissionDecision } from '../../../../shared/ipc'
```

`resolveMcpPermission` 改为：

```ts
  const resolveMcpPermission = (decision: McpPermissionDecision) => {
    if (!mcpPermission) return
    const { requestId, sessionId } = mcpPermission
    clearMcpPermission(sessionId)
    void window.ws?.mcp
      ?.respondPermission({ requestId, decision })
      .catch((error) => console.error('[agent] MCP 审批回写失败', error))
  }
```

`resolveToolPermission` 改为：

```ts
  const resolveToolPermission = (decision: 'once' | 'session' | 'workspace' | 'deny') => {
    if (!toolPermission) return
    const { requestId, sessionId } = toolPermission
    const allow = decision !== 'deny'
    clearToolPermission(sessionId)
    void respondPermission?.({
      requestId,
      allow,
      ...(allow ? { scope: decision } : { message: '用户拒绝' })
    })
      .then((ok) => {
        if (!ok) console.error('[agent] 审批请求已失效')
      })
      .catch((error) => {
        console.error('[agent] 回写审批失败', error)
        if (!useWorkstation.getState().toolPermissions[sessionId]) {
          useWorkstation.getState().setToolPermission(sessionId, toolPermission)
        }
      })
  }
```

- [ ] **Step 4: 允许按钮换行**

`src/renderer/src/styles/sections/08-dock.css` 的 `.w1-pacts` 加：

```css
  flex-wrap: wrap;
```

- [ ] **Step 5: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 通过。

- [ ] **Step 6: 冒烟验证卡片渲染（在 Task 11 完成后最终验证；本步先构建）**

Run: `npm run build`

Expected: 构建成功。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components/agent/ToolApprovalCard.tsx src/renderer/src/components/agent/McpApprovalCard.tsx src/renderer/src/components/agent/AgentDock.tsx src/renderer/src/styles/sections/08-dock.css
git commit -m "feat: 审批卡支持本会话与此工作区作用域"
```

---

### Task 10: 设置页审批规则列表

**Files:**
- Modify: `src/renderer/src/components/SettingsSheet.tsx`
- Modify: `src/renderer/src/styles/sections/10-overlays.css`

**Interfaces:**
- Consumes: `window.ws.agent.approvalRules/removeApprovalRule`（Task 4）、`ApprovalRuleRecord`。
- Produces: 基础 tab「审批规则」组、撤销按钮、空态与说明。

- [ ] **Step 1: 加状态与拉取**

`SettingsSheet.tsx` 的共享类型导入加：

```ts
  ApprovalRuleRecord,
```

在 `mcpApi` 附近加：

```ts
  const agentApi = typeof window === 'undefined' ? undefined : window.ws?.agent
  const [approvalRules, setApprovalRules] = useState<ApprovalRuleRecord[]>([])
  const [ruleBusy, setRuleBusy] = useState(false)
```

在 `useEffect` 区加：

```ts
  useEffect(() => {
    void agentApi
      ?.approvalRules()
      .then(setApprovalRules)
      .catch(() => setApprovalRules([]))
  }, [agentApi])
```

- [ ] **Step 2: 加撤销函数**

在 `changePolicy` 之后加：

```ts
  const revokeRule = (id: string) => {
    if (!agentApi || ruleBusy) return
    setRuleBusy(true)
    void agentApi
      .removeApprovalRule(id)
      .then(() => {
        notify('已撤销审批规则')
        return agentApi.approvalRules().then(setApprovalRules)
      })
      .then(() =>
        auditApi?.recent(30, auditDomain === 'all' ? undefined : auditDomain).then(setAuditRows)
      )
      .catch((error: unknown) =>
        notify(error instanceof Error ? `撤销失败：${error.message}` : '撤销失败')
      )
      .finally(() => setRuleBusy(false))
  }
```

- [ ] **Step 3: 渲染规则组**

在「MCP 数据权限」`</section>` 之后、「活动记录」`<section>` 之前插入：

```tsx
            <section className="w1-setgroup" aria-label="审批规则">
              <h3>审批规则</h3>
              <p className="w1-provnote">
                只对 MCP 工具与本地只读工具生效；对该工作区里同 Agent 的所有会话生效。Bash、写入类工具与「本会话允许」不落库，应用退出后失效。
              </p>
              {approvalRules.length === 0 ? (
                <p className="w1-provnote">还没有工作区审批规则。</p>
              ) : (
                <div className="w1-setrules">
                  {approvalRules.map((rule) => (
                    <div className="w1-setrule" key={rule.id}>
                      <code className="w1-setruletool">{rule.toolName}</code>
                      <span className="w1-setruleagent">
                        {rule.agent === 'claude' ? 'Claude' : 'Codex'}
                      </span>
                      <span className="w1-setrulepath" title={rule.workspace}>
                        {rule.workspace}
                      </span>
                      <time>{rule.lastUsedAt ? auditTime(rule.lastUsedAt) : '从未'}</time>
                      <button
                        type="button"
                        className="w1-setbtn"
                        disabled={ruleBusy}
                        onClick={() => revokeRule(rule.id)}
                      >
                        撤销
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
```

- [ ] **Step 4: 加样式**

在 `src/renderer/src/styles/sections/10-overlays.css` 的 `.w1-setpath` 规则后追加：

```css
.w1-setrules {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  margin-top: 6px;
  padding: 2px 8px;
  border: 1px solid rgb(var(--bd-rgb) / 0.3);
  background: rgb(var(--field-rgb) / 0.16);
  overflow-y: auto;
  scrollbar-width: thin;
}

.w1-setrule {
  display: grid;
  grid-template-columns: minmax(120px, 1.1fr) 48px minmax(0, 1.6fr) 72px auto;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid rgb(var(--bd-rgb) / 0.24);
  font: 10.5px / 1.4 var(--mono);
  color: var(--su);
}

.w1-setrule:last-child {
  border-bottom: 0;
}

.w1-setruletool,
.w1-setrulepath {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.w1-setruletool {
  color: var(--fs);
}

.w1-setruleagent {
  color: var(--ac2-fg);
}

.w1-setrulepath,
.w1-setrule time {
  color: var(--mu);
}

.w1-setrulepath {
  direction: rtl;
}
```

- [ ] **Step 5: 类型检查与 lint**

Run: `npm run typecheck && npm run check`

Expected: 通过。

- [ ] **Step 6: 构建**

Run: `npm run build`

Expected: 成功。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components/SettingsSheet.tsx src/renderer/src/styles/sections/10-overlays.css
git commit -m "feat: 设置页展示并撤销工作区审批规则"
```

---

### Task 11: 冒烟测试缝与断言

**Files:**
- Modify: `scripts/stub-agent.cjs`
- Modify: `scripts/smoke.cjs`

**Interfaces:**
- Consumes: 已实现的 UI 与 IPC。
- Produces: 新增冒烟断言与 stub 分支。

- [ ] **Step 1: 扩展 stub-agent 的 MCP 写分支**

在 `scripts/stub-agent.cjs` 的 MCP 分支中，把：

```js
    const approval = prompt.includes('审批')
    const writeMode = prompt.includes('写任务') || approval
```

改为：

```js
    const approval = prompt.includes('审批')
    const ruleWrite = prompt.includes('规则写入')
    const autoWrite = prompt.includes('自动写入')
    const writeMode = prompt.includes('写任务') || approval || ruleWrite || autoWrite
    const title = approval
      ? 'MCP 审批写入'
      : ruleWrite
        ? 'MCP 规则写入'
        : autoWrite
          ? 'MCP 自动写入'
          : 'MCP 写入测试'
```

把 `toolArgs` 里的：

```js
          title: approval ? 'MCP 审批写入' : 'MCP 写入测试',
```

改为：

```js
          title,
```

把最终文本里的：

```js
                ? writeMode
                  ? approval
                    ? 'MCP 审批写入：已创建。'
                    : 'MCP 写任务：已创建。'
                  : 'MCP 概览：读取成功。'
```

改为：

```js
                ? writeMode
                  ? ruleWrite
                    ? 'MCP 规则写入：已创建。'
                    : autoWrite
                      ? 'MCP 自动写入：已创建。'
                      : approval
                        ? 'MCP 审批写入：已创建。'
                        : 'MCP 写任务：已创建。'
                  : 'MCP 概览：读取成功。'
```

- [ ] **Step 2: 增加连续审批分支**

在 `if (prompt.includes('需要审批'))` 之前插入：

```js
  if (prompt.includes('连续审批')) {
    emit({
      type: 'system',
      subtype: 'init',
      model: 'stub-model',
      session_id: 'stub-permission-two'
    })
    await wait(100)
    emit({
      type: 'control_request',
      request_id: 'perm-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        display_name: 'Write',
        input: { file_path: 'tmp/first.txt', content: 'ok' },
        tool_use_id: 'stub-perm-1',
        description: '连续审批第一次'
      }
    })
    const first = await new Promise((resolve) => pendingPermissions.set('perm-1', resolve))
    emit({
      type: 'control_request',
      request_id: 'perm-2',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        display_name: 'Write',
        input: { file_path: 'tmp/second.txt', content: 'ok' },
        tool_use_id: 'stub-perm-2',
        description: '连续审批第二次'
      }
    })
    const second = await new Promise((resolve) => pendingPermissions.set('perm-2', resolve))
    const allowed = first?.behavior === 'allow' && second?.behavior === 'allow'
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: allowed ? '连续审批：两次均允许。' : '连续审批：未全部允许。'
          }
        ]
      }
    })
    emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 })
    return
  }

```

- [ ] **Step 3: 加 Claude 冒烟断言**

在现有 MCP「允许一次后写入完成」之后、`await window.ws.mcp.setPolicy('task', 'write')` 之前插入：

```js
    const claudeRuleInput = one('#composer-input')
    setValue(claudeRuleInput, 'MCP 规则写入')
    await sleep(80)
    claudeRuleInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await waitFor(() => !!one('.w1-mcpapprove'), 2000)
    check(
      'MCP 卡出现此工作区允许',
      (one('.w1-mcpapprove')?.textContent ?? '').includes('此工作区允许'),
      one('.w1-mcpapprove')?.textContent?.slice(0, 120) ?? 'missing'
    )
    byText('.w1-mcpapprove .w1-pb', '此工作区允许')?.click()
    const ruleWriteDone = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('MCP 规则写入：已创建'),
      3000
    )
    check('MCP 工作区规则允许后写入完成', ruleWriteDone, one('.w1-thread')?.textContent?.slice(-100) ?? '')

    const autoWriteInput = one('#composer-input')
    setValue(autoWriteInput, 'MCP 自动写入')
    await sleep(80)
    autoWriteInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const autoWriteDone = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('MCP 自动写入：已创建'),
      3000
    )
    check(
      '工作区规则命中后第二次 MCP 写入无卡',
      autoWriteDone && !one('.w1-mcpapprove'),
      one('.w1-thread')?.textContent?.slice(-100) ?? ''
    )

    one('.w1-settings')?.click()
    await waitFor(() => !!one('.w1-settings-sheet'), 2000)
    const ruleShown = await waitFor(
      () => (one('.w1-setrules')?.textContent ?? '').includes('tasks_create'),
      2000
    )
    check('设置页显示审批规则', ruleShown, one('.w1-setrules')?.textContent?.slice(0, 120) ?? 'missing')
    byText('.w1-setrule .w1-setbtn', '撤销')?.click()
    const ruleRevoked = await waitFor(
      () => !(one('.w1-setrules')?.textContent ?? '').includes('tasks_create'),
      2000
    )
    check('设置页可撤销审批规则', ruleRevoked, one('.w1-setrules')?.textContent ?? 'empty')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(() => !one('.w1-settings-sheet'), 2000)

    const revokedInput = one('#composer-input')
    setValue(revokedInput, 'MCP 审批写入')
    await sleep(80)
    revokedInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const cardBack = await waitFor(() => !!one('.w1-mcpapprove'), 2500)
    check('撤销后 MCP 写入重新弹卡', cardBack, one('.w1-mcpapprove')?.textContent?.slice(0, 120) ?? 'missing')
    byText('.w1-mcpapprove .w1-pb', '拒绝')?.click()
    await waitFor(() => !one('.w1-mcpapprove'), 2000)
```

- [ ] **Step 4: 加 Claude 本会话允许断言**

在现有「需要审批」卡片测试（约 `scripts/smoke.cjs:911`）之后插入：

```js
    const sessionAskInput = one('#composer-input')
    setValue(sessionAskInput, '连续审批')
    await sleep(80)
    sessionAskInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const firstWriteCard = await waitFor(
      () => (one('.w1-toolperm')?.textContent ?? '').includes('连续审批第一次'),
      2500
    )
    check(
      '敏感工具卡没有此工作区允许',
      firstWriteCard && !(one('.w1-toolperm')?.textContent ?? '').includes('此工作区允许'),
      one('.w1-toolperm')?.textContent?.slice(0, 140) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '本会话允许')?.click()
    const sessionAllowed = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('连续审批：两次均允许'),
      3000
    )
    check(
      '本会话允许后第二次 Write 自动放行',
      sessionAllowed && !one('.w1-toolperm'),
      one('.w1-thread')?.textContent?.slice(-120) ?? ''
    )
```

- [ ] **Step 5: 加 Codex 断言**

在 Codex「允许一次后继续本轮」之后，把现有的 `'允许一次'` 点击改为 `'本会话允许'`，并把检查文案改为：

```js
    check(
      'Codex 本会话允许后继续本轮',
      codexWriteDone &&
        (all('.w1-amsg').at(-1)?.textContent ?? '').includes('已允许写入。'),
      all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing'
    )

    const codexRepeatInput = one('#composer-input')
    const codexBefore = all('.w1-amsg').length
    setValue(codexRepeatInput, '写一个文件')
    await sleep(80)
    codexRepeatInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const codexRepeatDone = await waitFor(
      () => all('.w1-amsg').length > codexBefore && !one('.w1-toolperm'),
      5000
    )
    check('Codex Shell 会话规则命中后无卡', codexRepeatDone, all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing')

    const codexPermInput = one('#composer-input')
    setValue(codexPermInput, '额外权限')
    await sleep(80)
    codexPermInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const codexPermCard = await waitFor(
      () => (one('.w1-toolperm')?.textContent ?? '').includes('Permissions'),
      5000
    )
    check(
      'Codex Permissions 卡没有此工作区允许',
      codexPermCard && !(one('.w1-toolperm')?.textContent ?? '').includes('此工作区允许'),
      one('.w1-toolperm')?.textContent?.slice(0, 140) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '允许一次')?.click()
    await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('已授予额外权限'),
      5000
    )
```

`Patch` 与 `Permissions` 共用同一条 `isWorkspaceEligible('codex', …)` 资格判断；冒烟用 Shell + Permissions 代表敏感工具，`Patch` 由单元测试覆盖。

注意：`codexWriteDone` 的原断言在前面。在点击按钮之前加敏感工具断言，并把点击改为：

```js
    check(
      'Codex 敏感工具卡没有此工作区允许',
      !(one('.w1-toolperm')?.textContent ?? '').includes('此工作区允许'),
      one('.w1-toolperm')?.textContent?.slice(0, 140) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '本会话允许')?.click()
```

Codex MCP 卡部分把点击改为 `'此工作区允许'`，检查文案改为：

```js
    check(
      'Codex MCP 允许后继续',
      mcpAllowed,
      all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing'
    )
```

并在其后追加：

```js
    const codexMcpRepeat = one('#composer-input')
    const codexMcpBefore = all('.w1-amsg').length
    setValue(codexMcpRepeat, 'MCP 写入')
    await sleep(80)
    codexMcpRepeat.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const codexMcpRepeatDone = await waitFor(
      () => all('.w1-amsg').length > codexMcpBefore && !one('.w1-toolperm'),
      5000
    )
    check(
      'Codex MCP 工作区规则命中后无卡',
      codexMcpRepeatDone,
      all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing'
    )
```

- [ ] **Step 6: 加数据库断言**

在 `scripts/smoke.cjs` 的 `dbStats` 对象中加：

```js
      mcpAutoTask: count(
        "SELECT COUNT(*) AS n FROM tasks WHERE title = 'MCP 自动写入' AND deleted_at IS NULL"
      ),
      approvalRules: count('SELECT COUNT(*) AS n FROM approval_rules'),
      approvalRuleAudit: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'system' AND detail LIKE 'approval-rule:%'"
      ),
      autoApproveAudit: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND action = 'approve' AND detail = 'auto:workspace'"
      )
```

在现有 `MCP 审批写入与决定已落库` 检查之后加：

```js
  results.checks.push({
    name: '工作区规则自动写入已落库',
    ok: Boolean(dbStats && dbStats.mcpAutoTask === 1 && dbStats.autoApproveAudit > 0),
    detail: dbStats ? `task ${dbStats.mcpAutoTask} / auto ${dbStats.autoApproveAudit}` : '无数据'
  })
  results.checks.push({
    name: '审批规则已撤销且审计留痕',
    ok: Boolean(dbStats && dbStats.approvalRules === 0 && dbStats.approvalRuleAudit > 0),
    detail: dbStats ? `rules ${dbStats.approvalRules} / audit ${dbStats.approvalRuleAudit}` : '无数据'
  })
```

若 Codex 规则未撤销，`approvalRules` 会是 1；在 Codex 设置访问里补撤销，或把断言改为 `<= 1` 并单独断言 Claude 规则已删。推荐在 Codex 冒烟末尾打开设置撤销 `MCP · workstationforone/tasks_create`（见 Step 7）。

- [ ] **Step 7: 撤销 Codex 规则**

在 Codex MCP 断言之后、`one('.w1-settings')?.click()`（约 `scripts/smoke.cjs:2014`）之前加：

```js
    one('.w1-settings')?.click()
    await waitFor(() => !!one('.w1-settings-sheet'), 2000)
    const codexRuleShown = await waitFor(
      () => (one('.w1-setrules')?.textContent ?? '').includes('MCP · workstationforone/tasks_create'),
      2000
    )
    check('Codex 审批规则出现在设置', codexRuleShown, one('.w1-setrules')?.textContent?.slice(0, 120) ?? 'missing')
    byText('.w1-setrule .w1-setbtn', '撤销')?.click()
    await waitFor(
      () => !(one('.w1-setrules')?.textContent ?? '').includes('MCP · workstationforone/tasks_create'),
      2000
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(() => !one('.w1-settings-sheet'), 2000)
```

注意：`byText('.w1-setrule .w1-setbtn', '撤销')` 会点第一条；若 Claude 规则已撤销，Codex 是唯一一条。顺序由断言保证。

- [ ] **Step 8: 运行冒烟**

Run: `npm run smoke`

Expected: 300+ 项全过；新增断言全部通过。若失败，按提示修正选择器或等待条件，不要增加固定 `sleep`。

- [ ] **Step 9: 类型检查 / lint / 单元测试**

Run: `npm run typecheck && npm run check && npm test`

Expected: 全部通过。

- [ ] **Step 10: 提交**

```bash
git add scripts/stub-agent.cjs scripts/smoke.cjs
git commit -m "test: 冒烟覆盖审批规则自动放行与撤销"
```

---

### Task 12: 运行时校验、文档、版本与全量回归

**Files:**
- Modify: `scripts/runtime-verify.mjs`
- Modify: `package.json`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: 全部实现。
- Produces: v0.31.0、运行时断言、文档与最终验证。

- [ ] **Step 1: 加运行时断言**

`scripts/runtime-verify.mjs` 的 security `pageEval` 之后加：

```js
  const approvalRules = await pageEval(
    `(async () => {
      const fn = window.ws?.agent?.approvalRules
      if (typeof fn !== 'function') return 'missing'
      const list = await fn()
      return Array.isArray(list) && list.length === 0 ? 'ok' : JSON.stringify(list)
    })()`,
    'approval rules'
  )
  record('审批规则接口可用且为空', approvalRules === 'ok', approvalRules)
```

Expect: 运行时断言数量 +1（AGENTS.md 从 251–253 更新为 252–254）。

- [ ] **Step 2: 版本号**

`package.json`：

```json
  "version": "0.31.0",
```

- [ ] **Step 3: 更新 AGENTS.md**

在「架构与约定」加一条（放在 Agent Provider 条目之后）：

```markdown
- 审批规则（DB v27）：`approval_rules` 只存 `agent + workspace + tool_name` 的工作区级精确放行；MCP 工具与本地只读 `Read/Grep/Glob/LS` 可持久，Bash / Shell / Write / Edit / NotebookEdit / Patch / Permissions / Task / WebFetch / WebSearch 只能「本会话允许」或单次。会话规则在主进程内存，应用退出即失效；工作区规则可在设置「审批规则」撤销。三条链路（Claude `can_use_tool`、Codex app-server、本地 MCP 桥）在发卡前同步查规则；桥的裸工具名按会话 Agent 还原为 `mcp__workstationforone__*` / `MCP · workstationforone/*`，同一规则同时压掉适配器卡与桥卡。规则查询 / 审计失败按未命中处理（fail closed），规则落库失败不阻塞当前允许；不得用规则绕过 MCP 域权限、工具策略或沙箱，也不得加通配符 / 持久拒绝 / `--dangerously-*`。
```

把「当前状态」与 smoke / verify 段落中的 DB 版本、断言数量、冒烟项数更新为实际运行结果。

- [ ] **Step 4: 更新 CHANGELOG**

在 `## [Unreleased]` 下加 `## [0.31.0] - 2026-10-30`，内容：

```markdown
## [0.31.0] - 2026-10-30

### 新增

- **审批规则**：MCP 工具与本地只读工具可按「Agent + 工作区」持久放行；Bash / Shell / Write / Edit / Patch / Permissions 等敏感工具仍只能单次或本会话允许。会话允许只存在主进程内存，应用退出失效。
- **卡片**：工具卡与 MCP 卡增加「本会话允许」「此工作区允许」；敏感工具不显示工作区按钮，主进程也会拒绝伪造的工作区作用域。
- **设置**：基础页新增「审批规则」列表，可按最近使用排序并撤销；规则创建、撤销与自动批准写入活动记录。
- **DB v27**：`approval_rules` 存 agent、工作区、规范工具名与最近使用时间，工作区路径按大小写与分隔符归一化。

### 验证

- 运行 `npm run typecheck`、`npm run check`、`npm test`、`npm run smoke`、`npm run verify` 后填入实际数量。
```

- [ ] **Step 5: 运行全量验证**

先关闭已打开的 WorkStationForOne 窗口（应用单实例，旧窗口会干扰运行时校验），然后运行：

```bash
npm run typecheck
npm run check
npm test
npm run smoke
npm run verify
```

Expected: 全部通过。若 `verify` 的主题性能断言受系统负载影响，先在空闲环境复跑一次，不要放宽阈值。

- [ ] **Step 6: 截图矩阵**

Run:

```bash
for theme in dark light; do
  for view in today tasks agent notes learning; do
    npm run capture -- ".screenshots/${view}-1440-${theme}.png" 1440 900 "$theme" "$view"
    npm run capture -- ".screenshots/${view}-1180-${theme}.png" 1180 720 "$theme" "$view"
  done
done
```

Expected: 20 张截图生成；检查 1180×720 下审批卡与设置规则列表无横向溢出、四按钮正常换行。

- [ ] **Step 7: 更新文档中的实际数量**

把 `AGENTS.md` 与 `CHANGELOG.md` 中的测试 / 冒烟 / 运行时断言数量改成实际值；不要留下占位符。

- [ ] **Step 8: 提交**

```bash
git add package.json AGENTS.md CHANGELOG.md scripts/runtime-verify.mjs docs/superpowers/plans/2026-10-30-approval-rules.md
git commit -m "chore: 发布审批规则 0.31.0 并更新验证记录"
```

- [ ] **Step 9: 推送**

仅在用户确认后执行：

```bash
git push origin main
```
