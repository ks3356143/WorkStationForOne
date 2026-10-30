# Agent 审批持久规则（v0.31.0 / DB v27）

- 状态：设计已确认（2026-10-30），待实现
- 日期：2026-10-30
- 范围：工具审批的「本会话允许 / 此工作区允许」、工作区规则持久化、三条审批链路接入、设置页规则撤销、审计与测试
- 关联：`docs/superpowers/specs/2026-10-23-workstation-design.md`、`AGENTS.md`

## 1. 背景与目标

Agent 目前有三条独立审批链路：Claude `can_use_tool`、Codex app-server（Shell / Patch / Permissions / MCP elicitation）、本地 MCP 数据桥的写入审批。三者都只有「允许一次」；MCP 写入卡另有「本会话允许」。用户在同一工作区反复使用同一 MCP 工具时，每次都要点一次卡。

目标：让 **MCP 工具与本地只读工具**可以按「Agent + 工作区 + 工具」持久放行，并在设置里撤销；**Bash / Shell / Write / Edit / Patch / Permissions 等敏感工具永远不能持久**，最多「本会话允许」（主进程内存，应用退出即失效）。减少的是重复的 MCP 审批，不是 shell / 文件写入的逐次复核。

## 2. 范围与非目标

**范围**

- DB v27 `approval_rules` 与仓储、规则服务。
- Claude `can_use_tool`、Codex app-server、本地 MCP 桥三条链路在**发卡之前**检查规则并自动批准。
- 工具卡与 MCP 卡增加作用域按钮，设置页「基础」增加规则列表与撤销。
- 规则创建 / 撤销 / 自动批准的审计。

**非目标**

- 不提供持久「拒绝」规则、通配符、按工具前缀或全局规则。
- 不允许 Bash / Shell / Write / Edit / NotebookEdit / Patch / Permissions / Task / WebFetch / WebSearch 获得工作区规则。
- 不改变 `--dangerously-*`、沙箱、MCP 域权限（`read|ask|write`）、能力中心工具策略、Codex 外部 MCP 策略的优先级。
- 不读写 `~/.claude`、`~/.codex`、CC Switch、Claude Desktop、Codex Desktop。
- 不改 MCP 工具名、Provider 配置或 CLI 启动参数。
- 不改「AskUserQuestion 自动拒绝」：它在规则检查之前处理。

## 3. 规则模型

一条规则 = `agent + 工作区 + 工具名` 的精确匹配。全部相等才自动放行；没有模糊匹配。

### 3.1 作用域

| 作用域 | 生效范围 | 存储 | 适用工具 |
| --- | --- | --- | --- |
| `once` 允许一次 | 当前请求 | 不存 | 全部 |
| `session` 本会话允许 | 同一会话、应用进程内 | 主进程内存 | 全部 |
| `workspace` 此工作区允许 | 同一 Agent、同一工作区、精确工具名 | SQLite | 仅资格工具 |
| `deny` 拒绝 | 当前请求 | 不存 | 全部 |

- 「本会话允许」跨回合有效，直到应用退出；不落库，设置页不列出。
- 「此工作区允许」跨重启有效，作用于该工作区里**同一 Agent 的所有会话**，不只当前会话；撤销后下一次请求重新弹卡。
- 规则只放行，不拒绝；没有持久拒绝。

### 3.2 工具资格

资格判断是**正名单**，未识别工具一律不合格。

| Agent | 可持久（`workspace`） | 只能 `once` / `session` |
| --- | --- | --- |
| Claude | 工具名以 `mcp__` 开头的 MCP 工具；`Read`、`Grep`、`Glob`、`LS` | 其余全部，含 `Bash`、`Write`、`Edit`、`NotebookEdit`、`Task`、`WebFetch`、`WebSearch` |
| Codex | 工具名以 `MCP · ` 开头的 MCP 工具 | `Shell`、`Patch`、`Permissions` 及其它 |

- `WebFetch` / `WebSearch` 虽是只读，但会把工作区内容发往外部网络，因此不进入持久名单。
- `AskUserQuestion` 在适配器内自动拒绝，不进入任何规则。
- 资格由主进程判定；渲染层收到的 `workspaceScope` 只用于显示按钮，主进程在回写作用域时再校验一次。

### 3.3 规范工具名

同一工具在三条链路上名字不同，规则必须先规范化到同一名字：

| 链路 | 规范工具名示例 |
| --- | --- |
| Claude `can_use_tool` | `mcp__workstationforone__tasks_create`、`mcp__memory__read`、`Read` |
| Codex app-server | `MCP · workstationforone/tasks_create`、`Shell`、`Patch`、`Permissions` |
| 本地 MCP 桥（桥内裸名 `tasks_create`） | 按会话 Agent 还原：Claude 为 `mcp__workstationforone__tasks_create`，Codex 为 `MCP · workstationforone/tasks_create` |

- 规范化后，同一 Agent 下的两层审批共用一条规则：Claude 的 `can_use_tool` 卡与桥卡、Codex 的 elicitation 卡与桥卡，都不会为同一工具重复弹卡。会话 / 工作区允许会在回写适配器之前先写入规则，因此同一次调用的桥层也会直接命中。
- 规则表有 `agent` 列，Claude 的规则不会作用于 Codex 会话。
- 工具名按原样比较（区分大小写）；只有工作区路径做大小写归一化。

## 4. 数据层（DB v27）

### 4.1 迁移

```sql
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
```

- `workspace` 保留用户选择时的原始路径，用于设置页展示。
- `workspace_key` = 把 `/` 统一成 `\`、去掉尾部 `\`、再转小写；Windows 路径大小写与分隔符都不敏感，唯一性按 key 判断，避免同一目录出现两条规则。应用仅支持 Windows，直接小写即可。
- 迁移不写入种子，不修改历史数据；从 v26 升至 v27 只建表。
- 迁移前的自动备份沿用 `migrate()` 现有逻辑。

### 4.2 IPC 记录类型

```ts
export interface ApprovalRuleRecord {
  id: string
  agent: 'claude' | 'codex'
  workspace: string
  toolName: string
  createdAt: number
  lastUsedAt: number | null
}
```

### 4.3 仓储（`src/main/db/approval-rules.ts`）

```ts
export class ApprovalRuleRepository {
  list(): ApprovalRuleRecord[]
  find(agent: ApprovalAgent, workspaceKey: string, toolName: string): ApprovalRuleRecord | undefined
  upsert(input: {
    id: string
    agent: ApprovalAgent
    workspace: string
    workspaceKey: string
    toolName: string
    now: number
  }): ApprovalRuleRecord
  touch(id: string, at: number): void
  remove(id: string): boolean
}
```

- `list()` 按 `COALESCE(last_used_at, created_at) DESC, created_at DESC, id ASC` 排序，保证同一时间戳下顺序稳定。
- `upsert` 幂等：未命中时插入，`last_used_at = NULL`（表示尚未被自动命中）；命中唯一键时复用已有行的 `id` 与 `created_at`，把 `last_used_at` 更新为本次时间并返回该行。重复点「此工作区允许」不会产生重复行。
- `touch` 只更新 `last_used_at`；规则已不存在时静默返回。
- `remove` 返回是否删到行。
- 仓储挂进 `DatabaseContext.approvalRules`（`src/main/db/index.ts`）。

## 5. 规则服务（`src/main/agent/approval-rules.ts`）

```ts
export interface ApprovalRuleContext {
  sessionId: string
  agent: 'claude' | 'codex'
  workspace: string
}

export class ApprovalRuleService {
  constructor(deps: {
    rules: ApprovalRuleRepository
    sessions: Pick<AgentRepository, 'findSession'>
    audit?: AuditLog
    now?: () => number
  })

  isWorkspaceEligible(agent: ApprovalAgent, toolName: string): boolean
  check(context: ApprovalRuleContext, toolName: string): 'session' | 'workspace' | null
  grantSession(context: ApprovalRuleContext, toolName: string): void
  grantWorkspace(context: ApprovalRuleContext, toolName: string): void

  /** 把桥的裸工具名还原成规范名；会话不存在或没有工作区时返回 null */
  resolveBridge(sessionId: string, tool: string): {
    context: ApprovalRuleContext
    toolName: string
  } | null

  checkBridge(sessionId: string, tool: string): boolean
  grantBridgeSession(sessionId: string, tool: string): void
  grantBridgeWorkspace(sessionId: string, tool: string): void

  list(): ApprovalRuleRecord[]
  remove(id: string): void
  /** 清空本会话内存（测试与退出） */
  resetSession(): void
}
```

### 5.1 检查顺序

`check(context, toolName)`：

1. 命中本会话内存（`sessionId + toolName`）→ 写审计 `auto:session`，返回 `'session'`。
2. 命中工作区规则（`agent + workspaceKey + toolName`）→ `touch`、写审计 `auto:workspace`，返回 `'workspace'`。
3. 否则返回 `null`。

- 资格只约束工作区持久化；本会话允许对所有工具有效（含 Bash / Write）。`check` 对不合格工具的工作区规则返回 `null`（防御性），避免历史脏数据生效。
- 规则查询 / 审计抛错时**按未命中处理**（fail closed）：记 console，返回 `null`，继续弹卡。绝不因存储异常自动放行。

### 5.2 授予

- `grantSession`：写入内存，不做资格限制。
- `grantWorkspace`：先 `isWorkspaceEligible`，不合格抛 `TypeError`；合格则 `upsert` 并写审计。落库失败由调用方捕获并记 console，**不影响当前这次允许**。
- `grantBridgeSession/Workspace`：先 `resolveBridge`；会话不存在时静默忽略（理论上不会发生，会话必须存在才能运行）。桥的工具全部是 MCP，资格天然成立。
- `remove`：删除成功写审计；id 不存在时静默返回，不写审计（幂等）。

### 5.3 内存生命周期

- 本会话规则保存在 `Map<sessionId, Set<toolName>>`，`resetSession()` 清空；应用退出时进程结束自然失效。
- 不在回合结束时清空（与本会话允许的语义一致）。
- 会话删除功能当前不存在；如未来增加删除会话，必须同时清掉该会话的内存规则，并在规则表里保留工作区规则（规则与工作区绑定，不随会话删除）。

## 6. 三条审批链路

### 6.1 Claude `can_use_tool`（`src/main/agent/claude.ts`）

`ClaudeRunOptions` 新增：

```ts
autoApprove?: (toolName: string) => 'session' | 'workspace' | null
```

`handleControlRequest` 中，`AskUserQuestion` 分支之后、组装 `AgentPermissionRequest` 之前：

- `autoApprove(toolName)` 返回非空 → 直接 `writeControlResponse(requestId, { behavior: 'allow', updatedInput: input, toolUseID: toolUseId })`，不写入 `pendingPermissions`，不发 `permission` 事件。
- 返回 `null` → 沿用现状发卡。
- 自动批准不回传 `description` / `inputPreview` 事件；聊天区由 CLI 自己的 `tool_use` 事件展示工具调用。
- 审计已在规则服务内完成，适配器不重复写。

### 6.2 Codex app-server（`src/main/agent/codex-app-server.ts`）

`CodexAppServerRunOptions` 新增同样的 `autoApprove`。

在 `handleServerRequest` 中：

- `approvalRequest()` 生成 Shell / Patch / Permissions 请求后，先调 `autoApprove(request.toolName)`；命中 → `respondApproval(id, method, params, true)` 并 return，不登记 `pendingApprovals`、不发卡。
- `mcpServer/elicitation/request`：现有的「本地桥只读工具自动 accept」与外部工具 `allow/deny` 策略保持不变；在此之后、登记 `pendingApprovals` 之前调 `autoApprove('MCP · server/tool')`，命中 → `respondApproval(id, 'mcp_elicitation', params, true)` 并 return。
- `Permissions` 的自动批准仍走原有 `respondApproval`，授予范围是本次回合请求的权限，不扩大。
- `Shell` / `Patch` / `Permissions` 只可能命中会话规则；`MCP · …` 还能命中工作区规则。资格由主进程校验，适配器不自行判断。

### 6.3 本地 MCP 桥（`src/main/mcp/server.ts`、`src/main/mcp/permissions.ts`）

- `McpBridge` 的钩子 `isSessionAllowed` 更名为 `isPreApproved(sessionId, tool): boolean`，语义是「本会话已允许 **或** 已命中工作区规则」。`tools/call` 的写入询问分支先用它短路，命中则不再调用 `permissions.request`。
- `isPreApproved` 由 `index.ts` 接到 `ApprovalRuleService.checkBridge()`；工作区命中会写 `auto:workspace` 审计，会话命中写 `auto:session`。
- 桥的域权限检查、写入事务与 `mcp/write` 审计完全不变：规则只在 `ask` 模式下替代卡片，不能把 `read` 域变成可写。
- `index.ts` 里 `ApprovalRuleService` 必须在 `McpPermissionBroker` 与 `McpBridge` 之前创建，broker、bridge 与 `registerAgentHandlers` 共用同一实例。
- `McpPermissionBroker` 不再持有内存允许集合，改为回调：

```ts
export interface McpPermissionBrokerOptions {
  send: (request: McpPermissionRequest) => boolean
  audit?: AuditLog
  timeoutMs?: number
  /** 与桥钩子同义：本会话已允许或命中工作区规则 */
  isPreApproved?: (sessionId: string, tool: string) => boolean
  grantSession?: (sessionId: string, tool: string) => void
  grantWorkspace?: (request: McpPermissionRequest) => void
}
```

- `request()` 仍先查 `isPreApproved`（防御性；桥的正常路径已在上游短路）。
- `respond()` 新增 `workspace`：调用 `grantWorkspace(request)` 后按 `workspace` 结束；`session` 调 `grantSession`。授予异常只记 console，当前调用仍然放行（broker 内 try/catch）。
- `close()` 只拒绝挂起卡，不再清空会话集合（集合已移到服务，进程退出即失效）；删除 broker 自已的 `isSessionAllowed` 方法与内部集合。
- `index.ts` 接线：

```ts
new McpPermissionBroker({
  send, audit,
  isPreApproved: (sessionId, tool) => approvalRules.checkBridge(sessionId, tool),
  grantSession: (sessionId, tool) => approvalRules.grantBridgeSession(sessionId, tool),
  grantWorkspace: (request) => approvalRules.grantBridgeWorkspace(request.sessionId, request.tool)
})
```

### 6.4 自动批准顺序与竞态

- 裁决发生在 permission 事件生成之前，规则查询是同步 SQLite，**不需要额外的待审批队列**。
- 规则落库失败不会让当前审批悬挂：本次照常允许，下次继续弹卡。
- 规则在卡片挂起期间被撤销：当前卡仍需作答；撤销只影响之后的请求。
- 规则在卡片挂起期间被创建（另一会话）：当前卡不自动消失；之后的请求命中。

## 7. IPC 契约（`src/shared/ipc.ts`、`src/preload/index.ts`）

```ts
export type ApprovalScope = 'once' | 'session' | 'workspace'
export const APPROVAL_SCOPES = ['once', 'session', 'workspace'] as const

export interface AgentPermissionResponse {
  requestId: string
  allow: boolean
  /** 允许时的作用域；省略按 once。拒绝时忽略 */
  scope?: ApprovalScope
  message?: string
}

export type McpPermissionDecision = 'once' | 'session' | 'workspace' | 'deny'
```

- `IPC_CHANNELS` 增加 `agentApprovalRules = 'agent:approval-rules'`、`agentRemoveApprovalRule = 'agent:remove-approval-rule'`。都挂在现有 `agent` 桥组下，不新增 `ws` 顶级键，`runtime-verify` 的桥组集合断言不变。
- `AgentApi` 增加：

```ts
approvalRules: () => Promise<ApprovalRuleRecord[]>
removeApprovalRule: (id: string) => Promise<void>
```

- preload 在 `agent` 组内透传两个新方法。
- `assertPermissionResponse`：
  - 只在 `allow === true` 时读取 `scope`；缺省时**不补值**，由 handler 按 `response.scope ?? 'once'` 处理。
  - `scope` 存在且不在 `APPROVAL_SCOPES` 内 → `TypeError`。
  - 未知字段不进入返回值。
- `src/main/ipc/mcp.ts` 的 `assertPermissionResponse`：`DECISIONS` 增加 `workspace`。
- `agent:permission-response` 的处理：

```ts
interface ActiveRun {
  sessionId: string
  agent: 'claude' | 'codex'
  workspace: string
  cancel: () => void
  respondPermission: (requestId, behavior, message?) => boolean
}
```

`permissionRuns` 条目增加 `toolName`。回写时：

1. `allow=true && scope='workspace'` 且工具不合格 → 抛 `TypeError('该工具不支持工作区持久规则')`，不回写 CLI。
2. `scope='workspace'` → `rules.grantWorkspace({...runContext}, toolName)`；仅捕获数据库异常并记 console，继续第 4 步（资格不合格已在第 1 步抛错）。
3. `scope='session'` → `rules.grantSession(...)`。
4. 调 `run.respondPermission(...)`；无论 allow / deny，最后删除映射（保持现有行为）。
- 拒绝只使用 `allow=false + message`，`scope` 不参与。
- `agent:approval-rules` 直接返回服务 `list()`；`agent:remove-approval-rule` 校验 id 后调用 `remove(id)`，返回 `void`。

### 7.1 事件形状

`shared/agent-stream.ts` 的 `AgentPermissionRequest` 增加：

```ts
/** 主进程判定该工具是否可「此工作区允许」；渲染层只用于决定按钮是否显示 */
workspaceScope?: boolean
```

- 主进程在 `emit` 包装 permission 事件时按 `run.agent + request.toolName` 计算并写入。
- `McpPermissionRequest` 不增加字段：本地桥工具全部具备工作区资格，MCP 卡固定显示按钮。

### 7.2 `registerAgentHandlers` 签名

当前函数有 9 个位置参数，再新增规则服务会失去可读性。本轮将其改为单个 options 对象：

```ts
registerAgentHandlers({
  getWindow, repository, cli, getProvider, codexCli, mcp,
  cancelPermissions, codexHome, capabilities, approvalRules
})
```

行为不变，只调整调用形状；`index.ts` 同步更新。避免在这一轮改其它 handler 的签名。

## 8. 渲染层

### 8.1 工具审批卡（`components/agent/ToolApprovalCard.tsx`）

- props 的 `onResolve` 改为 `(decision: 'once' | 'session' | 'workspace' | 'deny') => void`。
- 按钮顺序：`拒绝` / `本会话允许` / `此工作区允许`（仅 `request.workspaceScope === true`）/ `允许一次`（主按钮）。
- 敏感工具只有：`拒绝` / `本会话允许` / `允许一次`。
- 提示文案：
  - 合格：「本会话允许只在应用运行期间有效；此工作区允许会记住该工具，对该工作区里同 Agent 的会话都生效，可在设置里撤销。」
  - 不合格：「Bash、写入类工具与额外权限只能本会话允许或单次允许，不会写入持久规则。」
  - `Permissions` 卡额外说明：「本会话允许会让本会话之后的额外权限请求自动通过。」
- 保留 `busy` 防重复点击与现有动效结构。

### 8.2 MCP 审批卡（`components/agent/McpApprovalCard.tsx`）

- 按钮：`拒绝` / `本会话允许` / `此工作区允许` / `允许一次`（主按钮）。
- 提示：「60 秒无操作按拒绝处理。此工作区允许只对这一种工具生效，对该工作区里同 Agent 的会话都生效，可在设置里撤销。」
- 保留 61 秒清卡的渲染层兜底。

### 8.3 AgentDock

- `resolveToolPermission(decision)`：拒绝发 `{requestId, allow:false, message:'用户拒绝'}`；允许发 `{requestId, allow:true, scope: decision}`。
- 先清本会话卡再异步回写，沿用现有行为；回写 `false`（运行已结束或重复回写）只记 console。回写 **抛错**（例如资格校验失败）时把捕获的卡片放回，避免本轮停在 wait。
- MCP 卡的 `onResolve` 直接透传新的 decision。

### 8.4 设置页（`components/SettingsSheet.tsx`）

「基础」tab 在「MCP 数据权限」与「活动记录」之间新增「审批规则」组：

- 数据：挂载时 `window.ws?.agent?.approvalRules()`；撤销后重新拉取。无桥时显示「仅在桌面应用可用。」
- 每行：工具名（代码字体）、Agent 标签（Claude / Codex）、工作区（路径过长时中间省略，`title` 给完整路径）、最近使用时间（`从未` / `MM-DD HH:mm`，与现有 `auditTime` 一致）、`撤销` 按钮。
- 空态：「还没有工作区审批规则。」
- 底部说明：「只对 MCP 工具与本地只读工具生效；对该工作区里同 Agent 的所有会话生效。Bash、写入类工具与『本会话允许』不落库，应用退出后失效。」
- 撤销成功用现有 `notify()` 提示，并刷新活动记录。
- 不加二次确认（撤销后再次允许即可恢复）；样式复用 `w1-setgroup` / `w1-setrow` / `w1-pb`，新增类名保持 `w1-setrule*` 前缀。

### 8.5 状态层

- 不需要新的 zustand 状态：规则列表是设置页局部 state，审批作用域随回写即弃。
- `ToolPermission` 自动获得 `workspaceScope?: boolean`（继承 `AgentPermissionRequest`）。
- 后台会话审批汇总、状态栏、舰队控制台逻辑不变。

### 8.6 视觉与响应式

- 四按钮卡在 1180×720 下允许 `.w1-pacts` 换行；不改变按钮视觉语言。
- 颜色继续走令牌；新增样式加到设置与 Agent 对应分节，不新建视觉体系。
- 动效沿用 `DURATION` / `EASE_OUT`；不新增依赖。

## 9. 审计

| 事件 | domain | action | title | detail |
| --- | --- | --- | --- | --- |
| 创建工作区规则 | `system` | `settings` | 工具名 | `approval-rule:create agent=… workspace=…` |
| 撤销工作区规则 | `system` | `settings` | 工具名 | `approval-rule:revoke agent=… workspace=…` |
| 工作区规则自动批准 | MCP 工具记 `mcp`，其余 `system` | `approve` | 工具名 | `auto:workspace` |
| 本会话规则自动批准 | 同上 | `approve` | 工具名 | `auto:session` |
| 卡片决定（MCP 桥） | `mcp` | `approve` / `deny` | 工具名 | `域 · once/session/workspace/deny/timeout`（沿用 broker） |

- 自动批准记录的 `targetId` 为会话 id，`source` 为 `agent`。
- MCP 写入本身仍写 `mcp/write`；自动批准是额外证据，不替代写入审计。
- 规则创建 / 撤销的 `source` 为 `ui`。

## 10. 安全边界

- 没有通配符、没有全局允许、没有持久拒绝；每个规则只对一行精确工具名生效。
- 敏感工具的工作区作用域在主进程被拒绝（`TypeError`），不依赖渲染层隐藏按钮。
- 自动批准永远发生在域权限 / 工具策略 / 沙箱之后：规则不能把 `read` 域变成可写，不能绕过 Claude `--disallowedTools`、Codex `disabled_tools`、外部 MCP 的 `deny` 或工作区沙箱。
- 规则不存 Token、API Key 或命令输出；只存 Agent、工作区路径与工具名。
- 不写 `~/.claude`、`~/.codex`、CC Switch、Claude Desktop、Codex Desktop；不新增任何 `--dangerously-*`。
- 规则查询失败或审计失败按「未命中」处理，fail closed。
- 规则表只由主进程读写；渲染层只能通过类型化 IPC 拉取与撤销。

## 11. 边界情况

- **会话没有工作区**：无法启动运行；桥不会收到调用；`resolveBridge` 返回 null，不自动批准。
- **工作区移动 / 重命名**：旧规则不再命中；设置里仍可见并可撤销。
- **同一路径不同大小写**：`workspace_key` 归一化，命中去重。
- **重复点「此工作区允许」**：`upsert` 复用同一行，只更新 `last_used_at`。
- **规则与当前卡片同时存在**：已挂起的卡不自动消失；作答后删除映射。
- **规则只按工具名匹配**：不校验外部 MCP Server 的 URL、版本或可执行文件；用户用同名 Server 替换后旧规则仍生效。撤销规则或改名 Server 即可失效。
- **规则创建后本回合立刻再请求**：适配器每次请求都查服务，立即生效。
- **Claude MCP 写入**：`can_use_tool` 与服务桥各有一层；规范名一致，一条规则同时生效。在 Claude 卡上选「本会话允许 / 此工作区允许」时，规则先落库再回写 CLI，随后的桥调用直接命中，同一次调用不会弹第二张卡；选「允许一次」则桥仍会单独询问。
- **Codex 本地桥写入**：elicitation 与桥内 broker 两层都可能发卡；规范名一致，一条规则同时压掉两层。在 elicitation 卡上选会话 / 工作区允许，同样在桥调用之前生效。
- **同工作区另一个同 Agent 会话**：命中同一规则并自动批准；规则不是会话私有的。
- **规则被撤销后**：下一请求重新弹卡；本会话内存规则不受影响。
- **应用重启**：工作区规则保留；本会话规则清空；卡片状态本就不持久化。
- **数据库迁移失败**：沿用 v27 事务回滚与迁移前备份，不影响旧库。

## 12. 测试与验证

### 12.1 单元测试

- `src/shared/approval-rules.test.ts`：`workspaceKey` 分隔符统一 / 去尾分隔符 / 小写 / 根路径；资格矩阵（MCP、本地只读、敏感工具、WebFetch/WebSearch、未知工具）；`bridgeToolName` 双 Agent；`isMcpToolName`。
- `src/main/db/approval-rules.test.ts`：v26 → v27 迁移；唯一键（大小写 / 分隔符不同的工作区视为同一条）；upsert 幂等与 `last_used_at`；`touch`；`remove`；重开库后仍在。
- 既有 `src/main/db/agent.test.ts:73` 与 `src/main/db/capabilities.test.ts:57` 硬编码了最新版本 `26`；加 v27 后前者的 v25→v26 用例改用 `MIGRATIONS.filter(v => v.version <= 26)`，后者改成 `MIGRATIONS.at(-1)!.version`。
- `src/main/agent/approval-rules.test.ts`：会话命中 / 工作区命中 / 未命中；同工作区不同 Agent 不命中；同 Agent 不同会话共享工作区规则；会话规则不跨会话；`last_used_at` 更新；审计 `auto:session|workspace`；不合格工具 `grantWorkspace` 抛错且不落库；`resolveBridge` 双 Agent 规范名与 Codex 桥规则落库；`check` 在仓储抛错时返回 null（fail closed）；`resetSession`。
- `src/main/agent/claude.test.ts`：`autoApprove` 命中时不发 permission 事件并写 allow control_response；未命中照旧发卡；`AskUserQuestion` 仍自动拒绝且不经过规则。
- `src/main/agent/codex-app-server.test.ts`：`MCP · …` 命中时不发卡并回 accept；`Shell` 会话命中；`Patch` / `Permissions` 未命中照旧发卡；外部策略 `deny` 优先于规则。
- `src/main/mcp/permissions.test.ts`：`isPreApproved` 短路；`session` / `workspace` 决定调用对应回调；`workspace` 授予异常仍放行；超时 / 拒绝不变。
- `src/main/mcp/server.test.ts`：`isPreApproved` 命中时跳过 broker，仍写 `mcp/write` 审计；未命中走卡片。
- `src/main/ipc/agent.test.ts`：`scope` 合法值与缺省、非法作用域、拒绝时忽略 `scope`；工作区持久化的授予与拒绝路径由规则服务单测和冒烟覆盖。
- `src/main/ipc/mcp.test.ts`：`workspace` 决定合法。

### 12.2 冒烟（`scripts/smoke.cjs` + stub）

新增测试缝：

- `scripts/stub-agent.cjs` 增加 `连续审批` 分支：连续发两个 `Write` 的 `can_use_tool`（`perm-1` / `perm-2`），第二个请求在收到第一个决定后发出；根据两次决定输出「连续审批：两次均允许」等文本。
- `scripts/stub-agent.cjs` 的 MCP 写分支增加 `MCP 规则写入` / `MCP 自动写入` 两个触发词，写出的任务标题与触发词同名。现有 `MCP 审批写入` 的数据库断言是 `=== 1`，新用例必须使用独立标题，不能复用。
- `scripts/stub-codex.cjs` 的 `MCP 写入` 与 `写一个文件` 分支可重复发送，分别验证 elicitation 工作区规则与 Shell 会话规则。

冒烟断言：

1. Claude 工具卡（`Write`）**没有**「此工作区允许」按钮；点「本会话允许」后第二个 `Write`（`连续审批`）自动放行且不再出现卡片。
2. 任务域切到 `ask`：发送 `MCP 规则写入` → 卡 → 点「此工作区允许」；发送 `MCP 自动写入` → 无卡直接落库。断言 `MCP 自动写入` 任务数为 1，`audit_log` 新增 `mcp / approve / auto:workspace`。
3. 设置「审批规则」出现该规则；点「撤销」后再发 `MCP 审批写入` 重新弹卡并点「拒绝」，不新增任务（现有 `MCP 审批写入 === 1` 断言保持成立）。
4. Codex 现有 Shell 卡（`写一个文件`）没有「此工作区允许」按钮；点「本会话允许」后再次发送 `写一个文件` 自动放行且无卡。`Patch` / `Permissions` 的资格由单元测试覆盖。
5. Codex `MCP 写入` 第一次点「此工作区允许」，第二次同一工具无卡且线程文本为「已允许 MCP 调用。」。
6. 既有审批、并发审批、MCP 域权限、Codex 审批断言全部保持通过。

新增测试结束前撤销本次创建的工作区规则并清回 MCP 域权限，避免临时库里的规则影响后续断言。会话允许无法从渲染层清除，同会话后续同类工具会被自动放行：相关用例要放在依赖审批卡出现的断言之后，或改用新会话。

### 12.3 运行时校验

- `preload` 桥组集合不变；新增一条断言：全新临时库上 `window.ws.agent.approvalRules()` 是函数且返回 `[]`。
- 因新增断言，更新 AGENTS.md 中记录的运行时断言数量。

### 12.4 截图

- 运行 20 套截图（双主题 × 双尺寸 × 五视图），确认四按钮卡与设置规则列表不出横向溢出；`1180×720` 下 `.w1-pacts` 正常换行。
- 不做视觉体系改动，不需要额外的组件截图矩阵。

### 12.5 提交前检查

- `npm run typecheck`、`npm run check`、`npm test`、`npm run smoke`、`npm run verify`。
- 全部通过后提交并推送。

## 13. 兼容与迁移

- DB v26 → v27 只增加表；不迁移历史审批状态。
- 旧渲染层若未传 `scope`：按 `once` 处理，行为与现在一致。
- 旧版不存在「本会话允许」的工具卡状态，无需清理。
- 规则记录会随数据库备份一起复制；不包含密钥。
- 版本号：`0.31.0`（新功能，minor）。`package.json` 是唯一版本来源。

## 14. 影响域

| 区域 | 变更 |
| --- | --- |
| `src/shared/approval-rules.ts` | 新增资格、工作区键、规范工具名纯函数 |
| `src/shared/ipc.ts` | `ApprovalScope`、`AgentPermissionResponse.scope`、MCP decision、`ApprovalRuleRecord`、两个 channel、`AgentApi` |
| `src/shared/agent-stream.ts` | `AgentPermissionRequest.workspaceScope` |
| `src/main/db/database.ts` | v27 迁移 |
| `src/main/db/approval-rules.ts` | 新仓储 |
| `src/main/db/index.ts` | `DatabaseContext.approvalRules` |
| `src/main/agent/approval-rules.ts` | 规则服务 |
| `src/main/agent/claude.ts` | `autoApprove` |
| `src/main/agent/codex-app-server.ts` | `autoApprove` |
| `src/main/mcp/server.ts` / `permissions.ts` | 预检钩子更名、broker 回调化、workspace 决定 |
| `src/main/ipc/agent.ts` | options 化、run 上下文、作用域校验、规则 IPC |
| `src/main/ipc/mcp.ts` | 校验 `workspace` |
| `src/main/index.ts` | 服务装配与回调接线 |
| `src/preload/index.ts` | 两个新方法 |
| `src/renderer/src/components/agent/ToolApprovalCard.tsx` | 四按钮与文案 |
| `src/renderer/src/components/agent/McpApprovalCard.tsx` | 四按钮与文案 |
| `src/renderer/src/components/agent/AgentDock.tsx` | 回写作用域 |
| `src/renderer/src/components/SettingsSheet.tsx` | 审批规则组 |
| 样式 | `.w1-pacts` 换行、设置规则行 |
| `scripts/stub-agent.cjs` / `smoke.cjs` / `runtime-verify.mjs` | 测试缝与断言 |
| `src/main/db/agent.test.ts` / `capabilities.test.ts` | 更新硬编码的最新 DB 版本断言 |
| `AGENTS.md` / `CHANGELOG.md` | 规则契约、DB v27、验证数量 |

## 15. 关键代码位置

- 纯规则：`src/shared/approval-rules.ts`
- 仓储：`src/main/db/approval-rules.ts`、迁移 `src/main/db/database.ts`
- 服务：`src/main/agent/approval-rules.ts`
- 审批接入：`src/main/agent/claude.ts`、`src/main/agent/codex-app-server.ts`、`src/main/mcp/server.ts`、`src/main/mcp/permissions.ts`
- IPC：`src/shared/ipc.ts`、`src/main/ipc/agent.ts`、`src/preload/index.ts`
- UI：`src/renderer/src/components/agent/ToolApprovalCard.tsx`、`McpApprovalCard.tsx`、`AgentDock.tsx`、`components/SettingsSheet.tsx`
- 测试：`src/shared/approval-rules.test.ts`、`src/main/db/approval-rules.test.ts`、`src/main/agent/approval-rules.test.ts`、`scripts/smoke.cjs`
