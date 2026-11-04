# 工具面管理与优先级设计（2026-11-04）

> 目标：把「CLI 原生工具 / 外部 MCP / 技能」收进一个按 Agent 管理的工具面；只注入用户启用的工具，并在系统提示里声明优先级，让模型自动选择用户配置的实现，同时保留现有审批与域权限。

## 1. 背景与问题

现在的能力中心能分别管理 Claude 插件、外部 MCP 和本地数据桥工具，但：

- computer use / agent-desktop 这类能力都作为 MCP Server 接入，启停入口在 MCP 分区，和 CLI 原生工具不在同一张清单里，冲突时模型没有优先级依据。
- Claude 原生工具没有应用级开关；Codex 的 computer use / browser use / web search 也没有暴露给用户。
- 技能启用后会被自动发现，但用户无法表达「同类工具优先用我配置的」。
- 模型可能继续调用已停用的工具，或选择用户不想要的实现。

## 2. 范围

做：

- 按 Agent（Claude / Codex）统一的工具清单：CLI 原生工具、外部 MCP、技能。
- 原生工具开关；MCP / 技能沿用现有启停，并增加顺序。
- 启动会话时只注入启用项，并生成「工具优先级」系统说明。
- Claude 用 CLI 参数落实禁用；Codex 用进程级 `-c` 参数与应用层拒绝兜底。
- 数据持久化（DB v41）与能力中心界面。

不做：

- 不关闭 Read / Grep / Glob 这类基础读取能力以外的硬编码限制；所有开关都由用户显式设置。
- 不做每个会话单独的工具预设；先按 Agent 全局生效。
- 不做自动路由或工具选择模型；优先级只通过系统提示声明。
- 不改变 MCP 域权限、审批规则、计划模式与沙箱的现有边界。

## 3. 术语

- **CLI 原生工具**：Claude / Codex 自带工具（Bash、Edit、WebFetch、Shell、Patch、computer use 等），不是本应用的数据桥工具。
- **外部 MCP**：用户在能力中心添加的 stdio / HTTP MCP Server。
- **技能**：通过插件市场或本机导入安装、按 Agent 归属的 skill。
- **数据桥工具**：应用本地 MCP 桥提供的 11 个任务 / 笔记 / 学习 / 习惯工具，保持现有管理方式。

## 4. 数据模型（DB v41）

```sql
CREATE TABLE agent_tool_prefs (
  agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex')),
  tool_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent, tool_key)
);
```

`tool_key` 命名：

- `native:<id>`：CLI 原生工具组，`enabled` 生效。
- `mcp:<serverId>`：外部 MCP，启停仍以 `mcp_servers.enabled/trusted` 为准，这里只写 `sort_order`。
- `skill:<pluginId>`：技能 / 插件，启停仍以 `agent_plugins.enabled/trusted` 为准，这里只写 `sort_order`。

缺省：没有行的原生工具视为启用；排序值相同时保持仓储返回顺序（MCP / 技能按名称，稳定排序）。删除 MCP 或插件时级联清掉对应 prefs 行（在服务层显式删除，避免依赖外部键）。

## 5. 原生工具目录

Claude（按组开关，展开为 CLI 工具名）：

| id | 名称 | CLI 工具 |
| --- | --- | --- |
| `file-read` | 读取文件 | Read, Grep, Glob, LS |
| `file-write` | 修改文件 | Write, Edit, MultiEdit, NotebookEdit |
| `shell` | 执行命令 | Bash, BashOutput, KillShell |
| `web` | 访问网络 | WebFetch, WebSearch |
| `task` | 子任务 | Task |
| `todo` | 待办清单 | TodoWrite |

Codex：

| id | 名称 | 落实方式 |
| --- | --- | --- |
| `web` | 网络搜索 | 进程参数 `-c web_search="disabled"` |
| `computer-use` | Computer Use | 进程参数 `-c features.computer_use=false` |
| `browser-use` | Browser Use | 进程参数 `-c features.browser_use=false` |
| `file-write` | 修改文件 | 应用层拒绝 `Patch` / `fileChange` 审批，并拒绝自动放行 |
| `shell` | 执行命令 | 应用层拒绝 `Shell` 审批；默认保持开启，关闭前界面提示会失去命令能力 |

Codex 的 `shell` 关闭只拦审批与工具执行，不改变沙箱；关闭后 Codex 仍可对话，但无法执行命令。界面必须显示这条说明。

## 6. 注入规则

### 6.1 Claude

`buildClaudeArgs` 增加：

- `disabledTools: string[]`：并入 `--disallowedTools`，与现有 MCP deny 列表合并去重。
- `appendSystemPrompt?: string`：非空时追加 `--append-system-prompt <text>`。

禁用原生组只从 `--disallowedTools` 移除能力，不修改 `--allowedTools` 中的本机桥与只读工具；计划模式仍优先，计划模式下的写入拒绝不受工具开关影响。

### 6.2 Codex

- `buildCodexAppServerArgs(cli, flags)` 在 `app-server` 子命令前插入 `-c key=value`，目前支持 `features.computer_use`、`features.browser_use`、`web_search`。
- `thread/start` / `thread/resume` 的 `developerInstructions` 增加工具优先级说明（与计划模式的 `[计划模式]` 前缀共存：计划模式文本在前，优先级文本在后）。
- `file-write` / `shell` 关闭时，在 `autoApprove` 与 permission 事件里返回拒绝文案，复用计划模式的拦截位置；不写入 `~/.codex`。
- 继承 CLI 的 `codex exec` 只读路径也读取同一份开关：`web_search` 用 `-c` 传入；`computer_use` / `browser_use` 通过 `features` 参数传入；写入本来就被沙箱拒绝。

### 6.3 工具优先级提示

只使用名称与极短描述，不包含密钥、命令、路径或参数。模板：

```text
[工具优先级]
用户已启用的 MCP 与技能优先：
- MCP：<server1>（<toolA>, <toolB>）；<server2>（...）
- 技能：<skill1>；<skill2>
当多个工具能完成同一件事时，优先使用上面列出的实现，不要调用已停用的工具。
可以直接调用这些工具与技能，不需要用户逐次点名；写入、命令与越权操作仍按审批规则执行。
```

规则：

- 只列 `enabled && trusted && 目标匹配` 的 MCP 与技能。
- 顺序来自 `agent_tool_prefs.sort_order`，其次稳定名称序。
- 没有启用项时省略对应行；全部为空时不追加系统提示。
- 文本放在 `shared/tool-surface.ts` 的纯函数 `buildToolPriorityPrompt(agent, surface)`，有单测。

## 7. 服务与接口

新增 `main/capabilities/tool-surface.ts`：

- `listToolSurface(agent)`：合并原生目录、启用的 MCP（含工具名）、启用的技能，带 `enabled` 与 `sortOrder`。
- `setNativeTool(agent, id, enabled)`：写 `agent_tool_prefs`。
- `moveTool(agent, key, direction)`：交换相邻项的 `sort_order`。
- `nativeToolPolicy(agent)`：返回 `disabledClaudeTools`、`codexFlags`、`codexDeniedTools`。
- `priorityPrompt(agent)`：调用纯函数生成文本。

新增 IPC（`capability:*`）：

- `toolSurface()` → `{ claude: ToolSurface, codex: ToolSurface }`
- `setNativeTool(agent, id, enabled)` → 最新 surface
- `moveTool(agent, key, direction)` → 最新 surface

`AgentCapabilityRuntime` 增加：

- `toolSurface(agent)`、`nativeToolPolicy(agent)`、`priorityPrompt(agent)`。

`agent:send` 启动前读取一次策略；MCP / 技能启停沿用现有仓储，不新增重复状态。

## 8. 界面

能力中心「工具」分区改为统一工具面：

1. 顶部切换 Claude / Codex。
2. `// CLI 原生工具`：每个原生组一行，开关 + 一句说明；Codex 的 shell 关闭时显示警告。
3. `// MCP 服务`：只列当前 Agent 归属的 Server；开关复用现有信任流程；右侧 `↑/↓` 排序；显示工具数与逐工具策略入口（跳到 MCP 分区）。
4. `// 技能`：只列当前 Agent 的插件；开关复用现有信任流程；`↑/↓` 排序。
5. `// 数据桥工具`：保留现有 11 个本地数据工具，明确标注「应用内置数据工具，不是 CLI 原生工具」。

排序只影响提示顺序与 MCP 配置顺序，不改变启停。任何开关都提示「下一次会话生效」，与现有内置工具文案一致。

## 9. 错误与边界

- 关闭全部网络工具时，界面提示「模型无法联网」；不阻止保存。
- 关闭 shell 时提示 Codex 将无法执行命令；不阻止保存。
- `agent_tool_prefs` 写入失败不回滚当前会话（沿用设置失败提示），下次启动重读。
- 优先级提示生成失败时降级为空，不影响会话启动；记 console。
- 计划模式、审批规则、MCP 域权限、沙箱仍是更高优先级；工具开关不能绕过它们。
- 不把 MCP 密钥、命令、URL 写进系统提示；只写 Server 名称与工具名。

## 10. 测试

单元：

- 原生目录映射与 `disabledClaudeTools` 展开。
- Codex flags 生成与 `codexDeniedTools`。
- 优先级提示：顺序、过滤停用、空输入、无密钥。
- DB v41 迁移、读写 prefs、排序交换、删除级联清理。
- `buildClaudeArgs` 包含 `--disallowedTools` 与 `--append-system-prompt`；`buildCodexAppServerArgs` 的 `-c` 位置正确。
- `threadParams` 的 `developerInstructions` 与计划模式前缀共存。

冒烟：

- 工具分区可切换 Agent，原生开关落库并在下一次 Claude 会话的参数里出现。
- 关闭 Claude `web` 后，stub `能力中心检查` 的 `--disallowedTools` 含 `WebFetch` / `WebSearch`。
- 优先级提示包含启用 MCP / 技能名称，且不含密钥。
- Codex 开关落库；`codex app-server` 参数包含对应 `-c features.*=false`。
- 排序后提示顺序变化；停用 MCP / 技能不进入提示。

## 11. 版本与迁移

- 版本 0.58.0，DB v41；迁移只建表，不写默认行（缺省即启用）。
- 旧库升级后所有原生工具默认启用，行为与现在一致；MCP / 技能排序按名称稳定。
- 文档更新：AGENTS、README、docs/status、docs/development/smoke.md。
