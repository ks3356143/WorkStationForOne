# WorkStationForOne 设计规格

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-23 |
| 状态 | 待评审 |
| 平台 | Windows 10 / 11 x64 |
| 产品版本 | v0.1.0 |
| 视觉方向 | B‴ 极光 HUD（直角 + 玻璃 + 中文优先 + 全动效） |
| 视觉稿 | `E:\Chentools项目\WorkStationForOne\.superpowers\brainstorm\1407-1792734240\content\visual-style-v6.html` |

## 1. 摘要

WorkStationForOne 是一个 Windows 单人 AI 工作站。它把本机安装的 CLI Agent（v1 为 Claude Code 与 Codex）收进同一个窗口管理，同时承载个人任务、习惯、学习与快速笔记看板。

它不是聊天壳，也不是多个项目的整合层，而是两件事的合体：

1. **Agent 控制面**：启动、对话、流式输出、工具调用展示、权限审批、会话恢复。
2. **个人数据看板**：任务与日程、习惯打卡、学习与复习、快速笔记。

Agent 通过本地 MCP 读取和写入看板数据，写入受分区授权约束，所有调用进入审计。应用完全本地运行，不依赖云端，不采集遥测。

视觉采用已评审的 B‴ 极光 HUD：极光玻璃、渐变、辉光、直角骨架、终端 HUD 符号、中文优先文案，以及覆盖启动、交互、数据入场和常驻呼吸的全动效层。

## 2. 目标与非目标

### 2.1 目标

- **G1 一个窗口完成 Agent 工作流**：选择项目目录、启动 Claude Code 或 Codex、持续对话、看到工具调用与权限请求、恢复历史会话。
- **G2 个人看板可用**：四张卡片的增删改查在离线状态下完整可用，笔记支持全文搜索。
- **G3 Agent 能安全地读写看板**：通过 11 个窄 MCP 工具，按域授权，写操作可审计、可拒绝、可回滚。
- **G4 视觉与动效达标**：与 v6 视觉稿同构；直角、玻璃、极光、HUD、中文优先；动效流畅且可关闭。
- **G5 本地优先**：数据落在本机 SQLite；没有账号体系、没有云同步、没有遥测。
- **G6 可维护**：官方 SDK、适配器隔离、契约测试、版本兼容诊断，上游升级不靠猜。

### 2.2 非目标（v1 不做）

- Qoder、DeepSeek Harness 的原生会话接入；两者只提供启动入口。
- 云端同步、多设备、多用户、团队协作。
- 移动端、Web 端、macOS、Linux。
- 应用自动更新；v1 用安装包手动更新。
- 亮色主题；v1 仅暗色。
- 插件市场、技能编辑器、提示词市场。
- 替代 CLI 的终端、Shell、文件编辑能力。
- 全局快捷键、系统托盘常驻、开机自启。
- 应用级数据库加密；见 12.5 的边界说明。

## 3. 用户与核心场景

单人使用，使用者是熟悉命令行的开发者，本机已登录 Claude Code 与 Codex。核心日常：

| 场景 | 行为 | 成功标准 |
| --- | --- | --- |
| 早晨规划 | 打开看板，看今日任务、习惯进度、到期复习 | 3 秒内看清今天要做什么 |
| 开始工作 | 选项目目录，启动 Claude Code 或 Codex | 会话出现在左栏，首条消息可发送 |
| 处理审批 | Agent 请求执行敏感操作 | 右栏出现权限卡，允许 / 本会话允许 / 拒绝都立即生效 |
| Agent 更新看板 | Agent 通过 MCP 创建任务、勾选习惯、写笔记 | 按域授权；写入成功即出现在界面；审计可查 |
| 晚上复盘 | 勾习惯、做复习、写快速笔记 | 不离开看板即可完成，数据次日仍在 |

## 4. 产品范围

### 4.1 MVP 模块

| 模块 | 内容 |
| --- | --- |
| 看板 | 任务与日程、习惯打卡、学习与复习、快速笔记；时间轴时间块可直接开始专注；日期切换；进度展示 |
| 会话 | 会话列表、舰队状态总览（运行/待确认/空闲/总数）、运行时长、只读/可写标记、恢复、Fork（按 SDK 能力）、停止 |
| 对话 | 流式文本、工具调用行、错误提示、权限卡逐行 diff、输入区、上下文用量 |
| 启动器 | Claude Code、Codex、Qoder、DeepSeek Harness；前两者新建会话，后两者仅启动 |
| 命令面板 | `Ctrl K`：启动会话、切换会话、新建任务/笔记、打开设置 |
| 设置 | 分区授权、动效开关、诊断（版本/兼容性）、数据备份与恢复说明 |
| 审计 | 只读列表，按会话/域/决策/日期过滤 |
| 数据 | SQLite 持久化、FTS5 笔记搜索、每日备份 |
| 打包 | Windows x64 NSIS 安装包 |

### 4.2 交付边界

- 所有功能必须离线可用；除本地 MCP 外不发起网络请求。
- 单个窗口；外部应用（Qoder / DSH）由系统启动，不嵌入。
- 首版只支持暗色；所有视觉令牌按暗色定义。
- 首版只支持单人、本机、单实例。

## 5. 总体架构

```
┌──────────────────────────── Renderer（React 19） ────────────────────────────┐
│ 看板 / 会话坞 / 设置 / 审计 / 命令面板        Zustand · Motion · CSS          │
└───────────────▲───────────────────────────────────────────────┬──────────────┘
                │ typed IPC（contextBridge + Zod）               │
┌───────────────┴───────────────────────────────────────────────▼──────────────┐
│ Electron Main                                                                │
│                                                                              │
│  AgentManager ── ClaudeAdapter / CodexAdapter ── child CLI processes         │
│  PermissionEngine    AuditService    BackupService    SettingsService        │
│  McpServer（127.0.0.1，随机端口，按会话 Token）                                │
│  SQLite（Electron 内置 node:sqlite，WAL，显式前向迁移）                        │
└───────────────▲───────────────────────────────────────────────┬──────────────┘
                │ MCP over HTTP（仅 loopback）                   │ spawn / stream
        Claude Code / Codex ──────────────────────────────────────┘
```

### 5.1 进程边界

- **Renderer**：只做 UI 与本地交互状态；没有 Node、没有数据库、没有文件系统权限。
- **Preload**：只暴露窄接口 `window.ws`；不暴露 `ipcRenderer`、`require`、`process`。
- **Main**：唯一持有数据库、子进程、MCP Server、Token、审计与备份的进程。
- **Agent 子进程**：由 Main 启动，工作目录由用户选择；文件/Shell 权限由各自 CLI 的沙箱与审批负责。

### 5.2 组件职责

| 组件 | 职责 | 不负责 |
| --- | --- | --- |
| `AgentManager` | 会话生命周期、适配器选择、事件广播、崩溃处理 | 解析 UI、直接写看板 |
| `ClaudeAdapter` / `CodexAdapter` | 调用官方 SDK、把差异事件归一化 | 权限策略、审计存储 |
| `PermissionEngine` | 域模式判定、审批队列、超时拒绝、本会话授权 | 弹窗渲染 |
| `McpServer` | 工具注册、Token 校验、参数校验、限流 | 业务规则 |
| `AuditService` | 审计写入、过滤查询、脱敏 | 修改业务数据 |
| `BackupService` | 每日备份、保留 7 份、恢复入口 | 自动删除用户数据 |
| `SettingsService` | 分区模式、动效偏好、诊断信息 | 密钥存储 |
| `Database` | 迁移、事务、FTS5、查询 | 业务编排 |

### 5.3 数据流

- **对话**：Renderer 发送消息 → Main 校验 → Adapter → CLI/SDK → 归一化事件 → Renderer 增量渲染 → Main 批量落库。
- **工具审批**：SDK 回调 → PermissionEngine → IPC 权限卡 → 用户决策 → SDK 继续/拒绝 → 审计。
- **MCP 写入**：Agent 调用工具 → McpServer 校验 Token 与会话 → PermissionEngine → 数据事务 + 审计事务 → 返回结构化结果 → Renderer 收到数据变更事件并刷新。
- **用户自身操作**：Renderer → typed IPC → Main 校验 → 数据库事务 → 返回结果；不走 Agent 授权，但设置变更进审计。

## 6. Agent 接入

### 6.1 支持矩阵

| Agent | v1 能力 | 实现 |
| --- | --- | --- |
| Claude Code | 新建、流式、工具调用、权限审批、恢复、Fork | `@anthropic-ai/claude-agent-sdk` |
| Codex | 新建、流式、工具调用、恢复；Fork 按 SDK 能力显示 | `@openai/codex-sdk` |
| Qoder | 仅启动应用 | 系统默认方式打开，不注入会话 |
| DeepSeek Harness | 仅启动应用 | 系统默认方式打开，不注入会话 |

外部应用只允许从预置探测到的安装路径或系统开始菜单启动；不接受任意路径、命令行参数或 URL 注入。

已安装 CLI 版本以诊断页实时读取为准；进入实现时记录当次验证过的 CLI/SDK 版本到 `docs/compatibility.md`。

### 6.2 适配器契约

```ts
type AgentKind = 'claude' | 'codex';

interface AgentAdapter {
  readonly kind: AgentKind;
  start(input: StartSessionInput): Promise<AgentSession>;
  send(session: AgentSession, text: string): AsyncIterable<AgentEvent>;
  interrupt(session: AgentSession): Promise<void>;
  resume(sessionId: string): Promise<AgentSession>;
  fork?(sessionId: string): Promise<AgentSession>;
  dispose(session: AgentSession): Promise<void>;
}

type AgentEvent =
  | { type: 'session.started'; sessionId: string; sdkSessionId?: string }
  | { type: 'turn.started'; turnId: string }
  | { type: 'text.delta'; turnId: string; text: string }
  | { type: 'tool.started'; turnId: string; toolCallId: string; name: string; input: unknown }
  | { type: 'tool.finished'; turnId: string; toolCallId: string; status: 'ok' | 'error'; output?: unknown }
  | { type: 'permission.requested'; turnId: string; requestId: string; tool: string; detail: string }
  | { type: 'turn.finished'; turnId: string; usage?: TokenUsage }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'session.ended'; reason: 'completed' | 'interrupted' | 'failed' };
```

适配器只做协议翻译，不做业务判断。未知事件必须被记录并忽略，不能让会话崩溃。

### 6.3 Claude Code

- 使用 SDK 的流式查询与会话恢复；开启 partial message 以获得增量文本。
- 会话模型默认继承 CLI 配置；新建会话时可选 CLI 暴露的模型别名（如 Sonnet）。
- 权限通过 SDK 的 `canUseTool` 回调接到右栏权限卡；60 秒超时拒绝。
- Resume 使用 SDK 会话 ID；Fork 仅在 SDK 支持时显示入口。
- 工作目录由目录选择器确定；启动前校验目录存在且可写。

### 6.4 Codex

- 使用官方 SDK 启动 thread，消费结构化流式事件。
- 默认策略固定为 `sandbox = workspace-write`、`approval = on-request`；禁止任何 `--dangerously-*`。
- P3 首先验证 SDK 能否把审批事件回传到应用：
  - 能回传：接入统一权限卡，与 Claude 一致。
  - 不能回传：评估官方 `app-server` 审批协议作为受支持备选。
  - 两者都不可用：应用内 Codex 降级为只读会话，并明确提示到 CLI 处理写入；不启用绕过参数。
- 启动前做与 Claude 相同的工作目录校验。

### 6.5 会话生命周期

`starting → running → awaiting_permission → idle → completed / interrupted / failed`

- `awaiting_permission` 时禁止发送新消息，避免上下文竞态。
- 应用退出时向所有子进程发送中断；未完成的会话标记为 `interrupted`，下次启动提供恢复入口。
- 子进程异常退出标记 `failed`，展示 stderr 尾部与错误码；不自动重启，不自动重放有副作用的回合。
- 网络类错误且无副作用时，提供用户主动触发的“重试”。

### 6.6 流式持久化

- 文本增量留在内存，按 250ms 或 64KB 批量写入；回合结束时强制落盘。
- 工具调用开始即落库，完成后更新状态与输出摘要。
- 不在每个 token 上写 SQLite，避免磁盘抖动与 WAL 膨胀。

### 6.7 透明性

- 只展示 SDK 提供的文本、工具调用、权限请求与错误；不请求、不展示隐藏推理链。
- 工具输入输出在 UI 中可见，敏感字段按 12.6 脱敏。
- 不自动重试有副作用的回合；重试必须是用户显式动作。

## 7. 本地 MCP、分区授权与审计

### 7.1 运行形态

- Main 进程内嵌官方 MCP SDK 的 Streamable HTTP Server。
- 仅绑定 `127.0.0.1`，端口使用 0 由系统分配；不监听局域网。
- 每个 Agent 会话一枚 32 字节随机 Bearer Token，映射 `sessionId + agent`；应用重启后全部失效。
- Token 通过环境变量或仅当前用户可读的临时配置注入；禁止出现在命令行参数、日志、审计和项目文件中。会话结束删除临时文件。
- 提供全局开关。关闭后 Agent 仍可对话，但工具列表为空。
- MCP 不提供任意 SQL、文件读写、Shell 或跨会话操作。

### 7.2 工具面（11 个）

server 名称：`workstation`。

| 工具 | 类型 | 域 | 主要参数 | 返回 |
| --- | --- | --- | --- | --- |
| `day_summary` | 读 | 全部 | `date?` | 今日任务、习惯进度、到期复习数、最近笔记 |
| `tasks_list` | 读 | 任务 | `status?`, `date?`, `limit?` | 任务数组，最多 50 |
| `habits_list` | 读 | 习惯 | `date?` | 习惯与当日打卡状态 |
| `learning_due` | 读 | 学习 | `date?` | 到期复习条目，最多 50 |
| `notes_search` | 读 | 笔记 | `query`, `limit?` | 标题与高亮片段 |
| `tasks_create` | 写 | 任务 | `title`, `details?`, `due_at?`, `priority?` | 新任务 |
| `tasks_update` | 写 | 任务 | `id`, `patch` | 更新后的任务 |
| `tasks_complete` | 写 | 任务 | `id` | 完成后的任务 |
| `habits_check` | 写 | 习惯 | `habit_id`, `date?`, `value?` | 当日打卡记录 |
| `learning_review` | 写 | 学习 | `item_id`, `rating`（1–4） | 下一次复习时间 |
| `notes_create` | 写 | 笔记 | `title`, `body_md?` | 新笔记 |

写工具必须接受 `idempotency_key`（字符串）。同一会话内重复键返回首次结果，不重复写入。所有输入输出由 Zod 定义并生成 JSON Schema。

### 7.3 授权模式

四个域：任务、习惯、学习、笔记。默认配置：

| 域 | 默认模式 |
| --- | --- |
| 任务 | 可写 |
| 习惯 | 只读 |
| 学习 | 询问 |
| 笔记 | 询问 |

| 模式 | 读 | 写 |
| --- | --- | --- |
| 只读 | 允许 | 直接拒绝，返回 `denied_by_policy` |
| 询问 | 允许 | 每次弹权限卡 |
| 可写 | 允许 | 允许，写操作记审计 |

无论哪种模式，所有 MCP 调用与权限决策都写审计；写操作与业务数据同事务，读操作单独记录。

权限卡展示：域、工具、人类可读动作、目标对象、变更预览。MCP 写入审批复用右栏权限卡组件，卡头标记来源（Agent 审批 / 数据写入）；两者共用同一个全局队列，避免同时弹多张卡。

选项：

- **允许一次**：只放行本次调用。
- **本会话允许**：同一会话 + 同一工具，会话结束失效；不扩大到同域其他写工具。
- **拒绝**：返回 `denied_by_policy`，Agent 可向用户解释。

60 秒无操作按拒绝处理。会话结束或应用退出时，所有挂起请求自动拒绝。多个请求排队，一次只展示一个，右上角显示待处理数量。用户自己在 UI 中的操作不经过此授权。

### 7.4 审计

`audit_events` 只增不改：

| 字段 | 说明 |
| --- | --- |
| `id` | UUIDv7 |
| `ts` | epoch ms |
| `session_id` / `agent` | 来源会话与 Agent；设置变更时两者均为空 |
| `tool` / `domain` / `action` | 工具、域、动作（read / write / tool.approval / settings.update） |
| `decision` | `allowed` / `denied` / `timeout` / `error` |
| `mode` | 当时的域模式；非 MCP 记录可空 |
| `duration_ms` | 调用耗时 |
| `target_id` | 被操作对象 ID |
| `change_summary` | 字段级摘要，不含正文 |
| `error_code` | 失败码，可空 |

- 所有 MCP 调用（读与写）与权限决策都写审计。写操作与业务数据在同一个 SQLite 事务中，审计写入失败则整个写操作回滚；读操作单独记录，不与业务事务绑定。
- 不保存笔记正文、任务描述全文、Token 或文件内容；文本参数截断并脱敏后仅存摘要。
- 设置页提供只读审计视图，按会话/域/决策/日期过滤，不提供删除入口。
- 默认保留 90 天，可在设置中调整；清理只删过期审计，不动业务数据。
- 设置变更记为 `tool = settings.update`、`domain = system`、`action = settings.update`、`decision = allowed`，`session_id` 与 `agent` 为空；用于回溯授权模式何时被放开或收紧。
- Agent 自身的工具审批（Shell、文件等）也写审计：`domain = agent`、`tool` 为 SDK 工具名、`action = tool.approval`、`decision` 为 allowed/denied，`target_id` 为空，`change_summary` 只存命令/路径摘要。它不改变 CLI 的沙箱与审批语义。

### 7.5 失败语义

- MCP Server 崩溃：Main 自动重启，进行中的工具调用返回可重试错误；会话不受影响。
- 应用重启：旧 Token 全部失效；恢复会话时重新发放。
- 权限请求挂起时会话结束：自动拒绝。
- 限流：读取 120 次/分钟/会话，写入 60 次/分钟/会话；超限返回 `rate_limited`。
- 请求体上限 256KB；超限返回 `payload_too_large`。

## 8. 数据模型

### 8.1 约定

- 主键：UUIDv7 文本。
- 时间：epoch ms（UTC 存储，界面按系统时区显示）。
- 习惯与复习日期：本地日期 `YYYY-MM-DD`。
- SQLite：WAL、`foreign_keys=ON`、`busy_timeout=5000`。
- 迁移：按 `PRAGMA user_version` 的显式前向迁移，每个版本一个事务；迁移前自动备份。
- 数据库：`%APPDATA%\WorkStationForOne\data\workstation.db`。
- 备份：`%APPDATA%\WorkStationForOne\backups\`，每日一份，保留 7 份。

### 8.2 表

| 表 | 关键字段 |
| --- | --- |
| `sessions` | id, agent, title, cwd, sdk_session_id, model, status, created_at, updated_at, last_activity_at, archived_at |
| `messages` | id, session_id, turn_id, role, kind, content_json, seq, created_at |
| `tool_calls` | id, message_id, name, input_json, output_json, status, started_at, finished_at, permission_decision |
| `tasks` | id, title, details, status, priority, due_at, scheduled_start, duration_min, created_by, created_at, updated_at, completed_at |
| `habits` | id, name, target_text, target_value, unit, schedule_json, active, sort_order, created_at |
| `habit_logs` | id, habit_id, date, value, completed_at；`UNIQUE(habit_id, date)` |
| `learning_items` | id, title, source, notes, next_review_at, interval_days, ease, last_reviewed_at, created_at, updated_at |
| `learning_reviews` | id, item_id, rating, reviewed_at |
| `notes` | id, title, body_md, pinned, source, created_at, updated_at |
| `notes_fts` | FTS5 外部内容表，索引 title 与 body_md，触发器同步 |
| `permission_settings` | domain 主键，mode |
| `audit_events` | 见 7.4 |
| `settings` | key 主键，value_json |

### 8.3 索引与查询

- `messages(session_id, seq)`、`sessions(status, last_activity_at)`。
- `tasks(status, due_at)`、`tasks(scheduled_start)`。
- `habit_logs(habit_id, date)`、`learning_items(next_review_at)`。
- `audit_events(ts)`、`audit_events(session_id, ts)`、`audit_events(domain, ts)`。
- 笔记搜索走 FTS5；`notes_search` 的用户输入必须参数化并按 FTS5 语法转义/引号包裹，语法错误返回可读错误，不中断服务。
- 会话按标题与最近活动排序；v1 不做消息全文搜索。

### 8.4 备份与恢复

- 启动后每天首次运行时做一次 SQLite 在线备份。
- 恢复仅在启动检测到数据库损坏时提示，用户确认后从最近一份备份恢复；不自动删除原库。
- 备份失败写诊断日志并在设置页提示，不阻塞应用。

## 9. 视觉系统

实现以 v6 视觉稿为准；v6 是评审用 HTML，不是生产代码。生产实现使用 React 组件 + 手写 CSS 分节 + 设计令牌，不直接复用评审页的包装结构。

### 9.1 方向

B‴ 极光 HUD：深靛黑背景上的紫→青极光，每张卡片玻璃，主操作渐变，直角骨架，终端 HUD 符号，中文优先文案。个人工具允许 AI 味，不套用反 AI 套路规则。

### 9.2 窗口与布局

- 默认 1440 × 900；最小 1180 × 720；单窗口。
- 使用隐藏标题栏 + 原生窗口按钮覆盖层（`titleBarStyle: 'hidden'` + `titleBarOverlay`），顶栏高度 52px；空白区域可拖动，按钮区域不可拖动。
- 四区结构（另加底部状态栏）：
  - 顶栏：品牌、命令条、SYS 状态、时钟。
  - 左栏：舰队状态总览（运行 / 待确认 / 空闲 / 总数 + 待确认直达）、会话列表、启动区、设置。
  - 中央：可滚动的模块流——日期条与时间轴（时间块可点击开始专注）、任务与日程（全宽）、习惯打卡与学习复习（两列并排）、快速笔记（全宽）。
  - 右栏：会话头部、上下文用量、消息流、工具调用、权限卡（逐行 diff：旧值划线、新值高亮）、输入区。
  - 底部状态栏：MCP 状态、会话数、待审批数、快捷键提示；数字来自真实数据，不使用视觉稿里的装饰性技能/插件计数。
- 中央区域通过纵向滚动换取字号与留白，不强行把四张卡片压进一屏。
- 列宽：≥1366px 时 248 / 1fr / 376；1180–1365px 时 224 / 1fr / 352；≤1279px 时 216 / 1fr / 340，模块流改为单列。
- 低于 1180px 不提供适配，窗口不允许缩到更小。

### 9.3 设计令牌

```css
--bg0:#070812; --bg1:#0D0E1A;
--s1:#141229; --s2:#1B1838; --s3:#241F4A;
--bd:#2E2A4A; --ctl:#6D63A8;
--fg:#E8F2FD; --fs:#B7C9DC; --mu:#8EA6BE; --su:#7F94AB;
--ac:#A78BFA;   /* 紫：主强调 */
--ac2:#2DE2E6;  /* 青：数据与运行态 */
--ink:#081522;  /* 渐变按钮上的深墨字 */
--ok:#45C29B;   /* 成功 / 只读 */
--wn:#E0AF5A;   /* 现在 / 待确认 */
--dg:#F07886;   /* 错误 */
--mono:"Cascadia Code","Cascadia Mono",Consolas,monospace;
--sans:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif;
--disp:"Segoe UI Variable Display","Segoe UI","Microsoft YaHei UI",sans-serif;
```

### 9.4 材质与形状

- 每张卡片同一玻璃配方：两层渐变叠底 + `backdrop-filter: blur(22px) saturate(150%)` + 内高光 + 深投影 + 极淡紫辉光。面板 26–28px，浮层 10–14px，仅改模糊半径。
- 窗口、卡片、按钮、输入区一律 `border-radius: 0`；开关、进度条等微控件允许 0–2px。
- 每张卡片四角有 8px 支架线；背景叠 48px 网格（约 3.5% 透明）与标尺刻度。
- 主按钮使用 `linear-gradient(100deg,#A78BFA,#2DE2E6)`，文字 `#0B1020`，不使用白字。
- 辉光只给主按钮、当前会话、输入区、权限卡；同屏整块发光元素不超过 4 个。
- 状态灯、复选框、习惯点使用方点，不使用圆形。
- 应用图标沿用同一视觉语言：深靛底、四角支架线、W/ 几何标记与紫青渐变。源文件为 `resources/icon.svg`（小尺寸精简版 `resources/icon-small.svg`），运行 `npm run icon` 生成 512px PNG 与含 256/128/64/48/32/24/16 七档的 ICO。

### 9.5 排版与中文优先

- 基础字号 15px / 1.6；卡片标题中文使用无衬线 600 16px/1，不用等宽大写。
- 正文 13.5–15px；辅助文字 11–12px；等宽遥测 10.5–11.5px，最小不低于 10.5px。
- 展示型数字：页面标题 38px、复习大数 64px、专注计时 82px；窄窗口只压缩间距与展示数字，不压缩正文与控件字号。
- 中文标签 `letter-spacing` 控制在 0.01–0.06em；英文全大写元信息可用 0.08–0.12em。
- 功能文案全部中文。仅保留：
  - 品牌名：WorkStationForOne、Claude Code、Codex、Qoder、DeepSeek Harness、Sonnet。
  - 技术缩写：MCP、CLI、SYS、HUD、API。
  - 快捷键：`Ctrl K`、`^N`、`^,`。
  - HUD 骨架：`//`、`v0.1.0`、`>` 提示符、命令行片段。

### 9.6 组件

- `TopBar`、`SessionRail`、`TodayHeader`、`Timeline`、`DashboardCard`、`TaskRow`、`HabitRow`、`ReviewCard`、`QuickNote`、`AgentDock`、`MessageList`、`ToolCallRow`、`PermissionCard`、`Composer`、`StatusBar`、`CommandPalette`、`AuditView`、`SettingsView`。
- 交互原语自绘；命令面板使用 cmdk。不引入 UI 组件库或 Tailwind。
- 图标使用内联 SVG（`components/Glyphs.tsx`），线宽统一；HUD 装饰符号仍用文本。

### 9.7 状态与可访问性

- 每个数据区必须定义加载、空、错误三态；加载用扫描线/骨架，不用整屏 spinner。
- 键盘可达：所有操作有可见 `focus-visible`（青色 1px 外框 + 2px 偏移）；命令面板支持上下选择与 Esc 关闭。
- 正文对比度 ≥ 4.5:1，大号文字 ≥ 3:1；渐变按钮深墨字必须实测。
- `prefers-reduced-transparency` 或不支持 `backdrop-filter` 时，玻璃降级为实色背景，文字与边框对比度不变。
- v1 仅暗色，不提供主题切换。

## 10. 动效系统

### 10.1 技术分工

| 场景 | 方案 |
| --- | --- |
| 启动编排、列表错峰、权限卡/消息进出、面板切换 | Motion（`motion/react`） |
| hover / press、边框、颜色、静态辉光 | CSS transition |
| 状态灯、呼吸、光标、NOW 脉冲 | CSS keyframes，只动 transform / opacity |
| 动效总闸 | MotionConfig 统一 duration 0 + `.motion-off` 暂停 CSS |
| 减少动效 | `MotionConfig reducedMotion="user"` + CSS media query |

不引入第二套动画库。Motion 负责 React 编排，CSS 负责合成层友好的常驻动画。

### 10.2 时长与曲线

| 层级 | 时长 | 说明 |
| --- | --- | --- |
| 启动编排 | 340–1600ms | 一次性建立空间层级 |
| 交互反馈 | 120–260ms | hover、press、切换 |
| 数据入场 | 300–650ms | 图表、列表、消息 |
| 环境呼吸 | 1.7–5s | 常驻状态提示 |

统一缓动 `cubic-bezier(.22,1,.36,1)`；扫描线使用 `cubic-bezier(.4,0,.2,1)`。

### 10.3 启动编排

| 时间 | 内容 |
| --- | --- |
| 0–340ms | 窗口淡入，扫描线从顶部扫过 |
| 340–620ms | 顶栏下落、左右栏滑入 |
| 620–1000ms | 日期条、时间轴、四张卡片错峰上浮（70ms 步进） |
| 900–1300ms | 任务行、习惯行、图表、消息错峰入场 |
| 1300–1600ms | 状态栏、输入区落位 |

只播放一次；应用内切换页面不重播启动编排。扫描线一次性，不循环。

### 10.4 交互与常驻

- 卡片 hover：上浮 3px、边框变紫、辉光增强，240ms。
- 会话/启动行 hover：左移 2px + 背景提亮，180ms。
- 权限卡：入场 520ms；常驻 4.6s 琥珀呼吸。
- 状态灯：2.4s 呼吸；当前会话：5s 呼吸；NOW 标线：3.2s 脉冲；光标：1.1s 闪烁。
- 图表柱：入场 `scaleY`；当前柱 3s 辉光脉冲。
- 所有常驻动画幅度必须低到不干扰阅读；窗口失焦或最小化时暂停。

### 10.5 总闸与减少动效

- 设置 → 外观提供“动效 开 / 关”。
- 关闭时：新的 Motion 动画直接到终态；CSS 常驻动画暂停；进行中的一次性动画允许在 300ms 内收尾，不中途跳变。
- 系统 `prefers-reduced-motion: reduce` 时：总闸自动关闭并禁用开关；CSS 动画与过渡全部关闭；Motion 使用 `reducedMotion="user"`。
- 设置持久化；重启后保持。

### 10.6 性能护栏

- 只动 `transform / opacity`；不要动画 `box-shadow / filter / width / height`。辉光用伪元素透明度实现。
- 文字密集的祖先容器禁止 scale、rotate 和分数位移；v6 的 `scale(.992)` 曾导致整屏文字发虚，生产实现不得复现。
- 列表超过 50 条时取消 stagger，只做首屏入场。
- 窗口失焦/最小化：给根节点加 `.app-blurred`，暂停常驻 CSS 动画。
- 目标 60fps；单次长任务 ≤ 50ms；动效不得触发布局抖动。

## 11. 技术栈与依赖策略

### 11.1 技术栈

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 桌面 | Electron + electron-vite + electron-builder | Windows x64，NSIS |
| UI | React 19 + TypeScript + 手写 CSS 分节 | 自绘 HUD；cmdk 负责命令面板 |
| 动效 | Motion（`motion/react`）+ CSS | 见第 10 节 |
| 状态 | Zustand | 分域 store + IPC 事件 |
| 数据 | Electron 内置 `node:sqlite` + 显式前向迁移 + FTS5 | 本地单文件，WAL；无需原生模块重编译 |
| 校验 | Zod | 主/渲染共享 schema |
| Agent | Claude Agent SDK、Codex SDK | 主进程内，适配器隔离 |
| MCP | 官方 MCP SDK | 仅 loopback |
| 图标 | 内联 SVG | 统一线宽 |
| 测试 | Vitest + Playwright | 单测/集成/Electron E2E |
| 日志 | electron-log | 脱敏、轮转、不记 Token |
| 构建 | Node 24 LTS + npm + package-lock | 原生模块重编译最稳 |

TypeScript 开启 `strict`；ESLint + Prettier 统一格式。v1 不引入 React Query、Redux、CSS-in-JS 或第二套动画库。

### 11.2 SDK 与更新策略

- 只依赖官方包：`@anthropic-ai/claude-agent-sdk`、`@openai/codex-sdk`、`@modelcontextprotocol/sdk`；不 fork、不封装私有协议。
- 一律消费 SDK 的结构化事件，不解析终端彩色文本；SDK 缺失的能力才退回 CLI，并在诊断页标记。
- 版本锁进 lockfile；每月检查更新：
  - patch/minor：升级后跑适配器契约测试与 E2E。
  - major：读 changelog、改适配层、跑全量回归后再合并。
- 应用内“诊断”页显示 App / SDK / 已装 CLI 版本与兼容状态；CLI 超出已验证范围时警告，不阻止使用。
- `docs/compatibility.md` 记录每次验证过的组合（App、SDK、CLI、日期、结果）。
- 不加任何 `--dangerously-*`；Codex 默认 `on-request` + `workspace-write`。
- 应用自身 v1 不做自动更新；安装包手动升级。

### 11.3 构建与打包

- `electron-vite` 管理 main / preload / renderer 三份构建。
- `electron-builder` 产出 NSIS x64 安装包；`asar: true`。数据库使用 Electron 内置 `node:sqlite`，不引入原生 `.node` 模块，也不需要 `asarUnpack` 或 `@electron/rebuild`。
- 安装后首次启动创建数据库与目录；卸载默认保留用户数据，安装器提供清理选项。
- 安装包未签名，v1 接受 SmartScreen 提示；代码签名留待后续。

### 11.4 仓库约定

- P0 初始化 git，提交前建立 `.gitignore`：`node_modules/`、`out/`、`dist/`、`.superpowers/`、`*.db`、`*.db-*`、`logs/`、`coverage/`、`test-results/`、`playwright-report/`、`.env*`。
- `.superpowers/` 只保留本地视觉评审素材，不入库。
- P0 脚手架和真实命令就绪后创建 `AGENTS.md`，只写实际存在的结构、命令与约束；不写密钥、个人配置或未落地的功能。
- 设计文档：`docs/superpowers/specs/`；兼容矩阵：`docs/compatibility.md`。

## 12. 安全基线

### 12.1 Electron

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`、`webviewTag: false`、`allowRunningInsecureContent: false`。
- preload 只暴露白名单 API；主进程校验 IPC sender 与参数（Zod）。
- 生产 CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'`。样式允许内联是因为 Motion 会写行内样式；脚本保持严格。
- 外链仅允许用户点击后通过 `shell.openExternal` 打开 `https:`，禁止 `file:`、`javascript:` 与任意本地路径。
- 不加载远程页面、不注入远程脚本、不启用 devtools 的远程调试。

### 12.2 Agent 进程

- 不用 `shell: true`；参数数组显式传递；工作目录必须存在且为目录。
- 环境变量最小化：系统必需项 + CLI 登录所需项 + MCP Token；不注入 API Key、不注入无关密钥。
- 默认不加任何危险绕过参数；Claude 审批走 SDK 回调，Codex 保持 `on-request` + `workspace-write`。
- 有副作用的回合不自动重试；用户显式重试才继续。
- 不请求隐藏推理链；只展示 SDK 返回的文本、工具与权限事件。

### 12.3 MCP

- 仅 `127.0.0.1`，随机端口，按会话 Bearer Token，常量时间比较。
- 请求体上限 256KB；读 120 次/分钟/会话，写 60 次/分钟/会话。
- Token 不进命令行、不进日志、不进审计、不落项目文件；应用重启失效。
- 所有工具输入输出 Zod 校验；错误返回稳定错误码，不泄露内部堆栈。

### 12.4 日志与诊断

- `electron-log` 写入 `%APPDATA%\WorkStationForOne\logs`，按大小轮转。
- 统一脱敏：Token、Authorization、疑似密钥、长文本正文不落日志。
- 诊断页只展示版本、路径、数据库状态、MCP 状态、最近错误码，不展示对话正文。

### 12.5 数据

- 数据库与备份位于当前 Windows 用户目录，依赖用户 ACL 隔离。
- v1 不做应用级加密；敏感个人内容依赖 BitLocker/设备加密。若后续需要存更高敏感数据，再评估 SQLCipher。
- 审计与业务写入同事务；审计失败则写操作回滚。
- 备份不自动删除原库；恢复必须用户确认。

### 12.6 内容脱敏

- 审计只存目标 ID、字段名、变更摘要；不存笔记正文、任务描述全文、文件内容。
- 工具调用 UI 中，路径可显示，密钥形态字符串（`sk-`、`Bearer `、长随机串）打码。
- AGENTS.md 与 `docs/` 不写密钥、个人配置、生产环境信息。

## 13. 错误处理与恢复

| 情况 | 行为 |
| --- | --- |
| CLI 未安装 | 启动项禁用，显示安装提示；不误报为项目目录问题 |
| 工作目录不存在 | 阻止启动，明确提示“项目目录不存在”；Windows `spawn ENOENT` 可能由 cwd 缺失引起，诊断时先查目录再查 PATH |
| Agent 子进程崩溃 | 标记 `failed`，展示 stderr 尾部与错误码；提供恢复或新会话，不自动重放 |
| SDK 返回未知事件 | 记录并忽略，不中断会话；诊断页累计计数 |
| MCP Server 崩溃 | 自动重启；进行中的调用返回可重试错误 |
| 权限超时 | 按拒绝处理，审计记 `timeout` |
| SQLite busy | `busy_timeout=5000`；仍失败则提示稍后重试，不丢数据 |
| 数据库损坏 | 启动时检测，提示从最近备份恢复；不自动删除原库 |
| 备份失败 | 诊断页警告；不阻塞主流程 |
| 审计写入失败 | 回滚对应写操作，返回错误 |
| 网络离线 | 看板与本地数据正常工作；Agent 错误原样展示 |
| 应用退出时会话运行中 | 中断子进程，标记 `interrupted`；下次启动提供恢复 |
| 系统睡眠/唤醒 | 检查子进程存活；已退出则标记中断，不伪造运行状态 |
| 高 DPI / 多显示器 | 使用 CSS 像素与系统缩放；125%、150% 下不得裁切 |

## 14. 测试策略

### 14.1 测试层次

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| 单元 | Vitest | 权限真值表、Zod schema、事件归一化、脱敏、日期边界、幂等键 |
| 集成 | Vitest + 临时 SQLite | 迁移、FTS 触发器、审计事务回滚、备份/恢复 |
| MCP 集成 | Vitest + 真实 loopback HTTP | 无 Token/错误 Token/跨会话 Token、限流、体积上限、超时拒绝 |
| 适配器契约 | Vitest + 录制 fixture | Claude/Codex 事件映射、resume、错误码、未知事件 |
| E2E | Playwright（Electron） | 看板 CRUD、流式消息、工具行、权限允许/拒绝/超时、恢复、审计过滤 |
| 视觉 | Playwright 截图 | 1440×900、1280×800；主屏、权限卡、设置、审计 |
| 可访问性 | axe-core | 关键页面无严重违规；键盘路径；focus-visible |
| 性能 | Playwright trace + Electron 指标 | 启动、动画帧率、长任务、内存 |

### 14.2 测试约束

- 集成测试使用真实 SQLite，不用 mock 数据库。
- E2E 默认使用假 Agent CLI（Node 脚本回放 NDJSON），不消耗真实额度；真实 Claude/Codex 只做手动 smoke。
- 视觉基线只在 Windows 固定缩放（100%）下生成；变更需人工确认。
- 权限测试必须覆盖三模式 × 读/写 × 允许/拒绝/超时 × 本会话授权范围。
- 安全测试必须证明 Token 不出现在命令行、日志和审计中。
- 测试数据不得包含真实个人数据、客户名或密钥。

### 14.3 性能预算

| 指标 | 目标 |
| --- | --- |
| 冷启动到可交互 | ≤ 3s |
| 动画帧率 | 1440×900 下稳定 60fps |
| 单次长任务 | ≤ 50ms |
| 空闲 CPU | < 1% |
| 常驻内存 | < 500MB |
| 安装包体积 | < 200MB |

## 15. 分期与里程碑

| 阶段 | 交付 | 退出条件 |
| --- | --- | --- |
| P0 基础壳 | electron-vite 脚手架、窗口安全、设计令牌与基础组件、SQLite 迁移、typed IPC、空壳布局；git 初始化、`.gitignore`、`AGENTS.md` | 应用可启动；迁移可跑；IPC 类型贯通；单测通过 |
| P1 今日看板 | 四张卡片 CRUD、日期切换、FTS 笔记搜索、命令面板、完整动效层 | 离线完成全部看板操作；视觉截图通过；减少动效与总闸可用 |
| P2 Claude | Claude 适配器、会话列表、流式消息、工具行、权限卡、resume/fork | 真实 Claude 完成一轮对话、审批、恢复；消息落库正确 |
| P3 Codex | Codex 适配器、会话管理、审批能力 spike | 流式输出与恢复可用；审批回传结论明确；无危险参数 |
| P4 数据桥 | MCP Server、11 个工具、分区授权、审计视图、限流与失败语义 | 三模式生效；审计可查；MCP 安全测试通过 |
| P5 收尾 | 设置/诊断、备份恢复、安装包、E2E、性能与降级检查 | 干净 Windows 用户环境安装通过；验收清单全绿 |

每阶段结束必须是可运行的应用，不留半成品。阶段顺序可按反馈调整，但 P0 与 P1 先于 Agent 接入，P4 依赖 P1 的数据模型。

## 16. 验收标准

1. 全新 Windows 用户环境安装后，离线可打开看板，四张卡片可增删改查。
2. Claude Code 可新建会话、流式输出、展示工具调用、弹出权限卡、允许/拒绝生效、恢复历史会话。
3. Codex 可新建会话、流式输出、恢复；审批能力按 P3 结论工作，且全程无危险绕过参数。
4. 任务/习惯/学习/笔记四个域的模式真实生效；只读不可写、询问必弹卡、可写有审计。
5. Agent 通过 MCP 的每次读写都有审计；Agent 自身的工具审批也有记录；审计不可从 UI 删除；写审计失败时业务写入回滚。
6. MCP 仅监听 127.0.0.1；错误 Token、跨会话 Token、超限请求均被拒绝；Token 不出现在日志/命令行/审计。
7. 1440×900 与 1280×800 下无裁切、无重叠；正文对比度达标；键盘可完成主要操作。
8. 启动编排、悬停、权限卡进出、常驻呼吸均流畅；动效总闸与系统减少动效都有效；窗口失焦时常驻动画暂停。
9. 冷启动、内存、安装包体积满足 14.3 预算。
10. 数据库每日备份；损坏时可按提示恢复；卸载默认保留用户数据。
11. 工作目录缺失、CLI 未安装、子进程崩溃、MCP 崩溃均有明确且不误导的错误提示。
12. 测试套件通过；没有真实密钥、客户名或生产配置进入仓库、日志与审计。

## 17. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| SDK / CLI 事件漂移 | 流式或工具展示中断 | 契约 fixture、月度升级、诊断版本告警、未知事件忽略不崩溃 |
| Codex 审批无法回传 | 写入无法在应用内确认 | P3 优先验证 SDK；备选官方 app-server；否则降级只读并明示；不绕过 |
| Windows `spawn ENOENT` 误判 | 被当成 CLI 未安装 | 启动前校验 cwd；错误信息区分目录缺失与可执行文件缺失 |
| 原生 SQLite 模块 ABI 不匹配 | 打包后启动失败 | 已规避：使用 Electron 内置 `node:sqlite`，无原生模块；打包后仍需冒烟 |
| backdrop-filter + 多层辉光 | 低端 GPU 掉帧 | 限制玻璃层数；辉光伪元素；失焦暂停；实色降级 |
| 祖先 scale 导致文字发虚 | 全屏文字模糊 | 文字容器禁用 scale/layout 动画；只缩内层图形 |
| Token 泄漏到命令行/日志 | 本地越权 | 环境变量/临时 ACL 文件注入；日志脱敏；安全测试 |
| 审批疲劳 | 用户习惯性点允许 | 合理默认；本会话授权限定单工具；权限卡展示变更预览 |
| 数据丢失 | 个人数据不可恢复 | WAL、每日备份、迁移前备份、审计同事务 |
| 安装包未签名 | SmartScreen 警告 | v1 接受并说明；后续代码签名 |
| 启动慢/包体大 | 体验下降 | 预算约束；按需加载；P5 性能回归 |
| 本地数据未加密 | 设备丢失可读 | 依赖 Windows ACL + BitLocker；后续评估 SQLCipher |

## 18. 参考

- 视觉稿 v6：[visual-style-v6.html](file:///E:/Chentools%E9%A1%B9%E7%9B%AE/WorkStationForOne/.superpowers/brainstorm/1407-1792734240/content/visual-style-v6.html)
- 稳定态截图：`.superpowers/brainstorm/1407-1792734240/state/preview-v6-final.png`
- 启动中截图：`.superpowers/brainstorm/1407-1792734240/state/preview-v6-mid.png`
- 2× 局部：`.superpowers/brainstorm/1407-1792734240/state/mock-v6-crop.png`
- 风格归档：`E:\1.工作相关内容\★陈叫叫个人知识库\0-收件箱\极光HUD工作台视觉与动效方案.md`
- 官方包：`@anthropic-ai/claude-agent-sdk`、`@openai/codex-sdk`、`@modelcontextprotocol/sdk`
