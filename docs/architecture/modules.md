# 模块地图

按进程分层，只列有明确职责边界的模块；文件名即入口。改代码前先确认自己改的是哪一层，不要跨层伸手。

## 主进程 `src/main`

| 路径 | 职责 |
| --- | --- |
| `index.ts` | 应用启动、窗口、IPC 注册、退出顺序（先停 MCP 桥与提醒轮询再关库） |
| `validate.ts` | IPC 入参守卫（对象、id、文本、枚举、空补丁），所有 handler 共用 |
| `db/database.ts` | 打开库、`PRAGMA user_version` 前向迁移、迁移前备份 |
| `db/capabilities-rows.ts` | 能力表行类型、列清单与行映射，仓储不再重复写列名 |
| `db/capabilities.ts` | `CapabilityRepository`：插件、插件源、外部 MCP、密钥与工具审批 |
| `db/audit.ts` | `AuditLog`；`record` 只记不阻断，`recordStrict` 失败回滚业务 |
| `ipc/*.ts` | 按域注册 handler；`agent-validators.ts` 收 agent 入参，`plugin-handlers.ts` 收插件源与导入 |
| `ipc/settings-audit.ts` | 设置类审计的唯一写法（system / settings / ui） |
| `agent/claude.ts` | Claude CLI 参数、Provider 环境、stream-json 运行 |
| `agent/codex-app-server.ts` | Codex app-server JSON-RPC 运行与审批回写 |
| `agent/codex-parser.ts` | app-server 事件到 `AgentRunEvent` 的纯解析，可单测 |
| `agent/approval-rules.ts` | 会话 / 工作区放行规则与自动批准审计 |
| `capabilities/claude-plugins.ts` | 应用私有 Claude 插件库（市场、安装、本地导入） |
| `capabilities/mcp-secrets.ts` | `safeStorage` 解密出口，连测试与运行时共用 |
| `capabilities/plugins/components.ts` | 插件组件探测与 id 拆分，市场安装与本机导入共用 |
| `capabilities/plugins/*` | 源服务、Codex 配置改写、skill 同步、本机扫描与导入、更新检查、批量更新分发（`apply-updates.ts`） |
| `mcp/server.ts` | 内嵌 Streamable HTTP 桥：鉴权、工具分发、审批中继 |
| `mcp/tools.ts` | 11 个数据工具的定义与写入实现 |
| `mcp/views.ts` | MCP 返回值投影与筛选口径（今天到期、子任务过滤等） |

## 渲染层 `src/renderer/src`

| 路径 | 职责 |
| --- | --- |
| `App.tsx` | 外壳、视图互斥、命令面板与全局通知 |
| `store/useWorkstation.ts` | 单一状态源与持久化绑定；组件不直接读写数据库 |
| `lib/*.ts` | 纯规则（容量、排程、SRS、解析、错误分类…），必须有同名测试 |
| `lib/errors.ts` / `components/ViewErrorBoundary.tsx` | 错误分类与视图级错误边界 |
| `lib/labels.ts` | 数据域 / 审计域 / 权限模式的中文名与时间格式 |
| `components/capability/ToolsTab.tsx` | 能力中心「内置工具」总览 |
| `components/settings/ProviderCard.tsx` | Provider 接线台（测试连接、拉取模型、加密保存） |
| `components/capability/McpTab.tsx` | 外部 MCP 页：Server 增删改测、JSON 导入导出、工具级权限、环境自检 |
| `components/learning/LearningStatsModal.tsx` | 学习统计弹层 |

## 共享 `src/shared`

`ipc.ts` 是 preload 桥的唯一类型契约，只做统一导出；各域定义在 `ipc/` 下（tasks / notes / learning / habits / agent / mcp / capability / audit / app / channels / ws-api）。调用方一律 import `shared/ipc`，不要走深路径。`agent-stream.ts`、`srs.ts`、`repeat.ts`、`date-key.ts` 等是主进程与渲染层共用的纯逻辑。

## 样式 `src/renderer/src/styles/sections`

导入顺序即层叠顺序（`styles/index.css`）：`00-base` → 各域 → `10-overlays` → `22-settings` → `11-motion` → `12-accessibility` → `13-responsive` → `14-theme` → `15-skin-classic` → 其余域。新增分节要插在语义相邻的位置，不要一律追加到末尾；同名选择器在后导入分节里会静默覆盖。
