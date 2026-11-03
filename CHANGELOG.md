# 更新日志

本文件记录 WorkStationForOne 的可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [Unreleased]

暂无。

## [0.36.6] - 2026-11-03

### 修复

- **任务行 hover 高亮线压住内容**：任务工作区的 `.w1-todorowmain` 与今日看板的 `.w1-task` 左侧内边距是 0，2px 的 inset 高亮线直接画在拖拽手柄和时间文字下面。两者改为 8px 左内边距；`13-responsive.css` 的 1180 断点还会把 `.w1-task` 覆盖回 0，一并修正。冒烟新增两条几何断言（内边距 ≥ 6px 且内容距左 ≥ 6px）。
- **首次读库前闪空态**：任务、笔记、Agent 会话栏、学习卡与能力中心在第一次读库结束前会先渲染「还没有…」再跳成真实内容。新增 `components/StatePlaceholder.tsx` 骨架，并按域引入 `tasksReady / notesReady / sessionsReady / learningReady` 读取标记；成功、失败与无 preload 桥三种路径都必须结束占位——`capture` 没有桥，卡住会表现成永远停在 LOADING。
- 能力中心读取失败的横幅增加「重试」，不再只能关掉重开设置页。

### 验证

- 908 项单元测试、冒烟 340 项、`npm run verify` 252 项全通过；1440×900 与 1180×720 双主题五视图共 20 张截图，布局审计无横向溢出（`.w1-ambient` 是预期的画布外光场）。

## [0.36.5] - 2026-11-02

### 修复

- **Codex 配置写入的私有目录断言没有生效**：`assertPrivateCodexHome` 存在，但两个写入点（插件启停、本机导入）都没调用它，断言实际只在测试里跑过。现在 `setCodexPluginEnabled` 内部强制校验，并要求传应用数据根——即使将来新增调用点忘了校验，也写不到用户自己的 `~/.codex/config.toml`。
- 删除死代码 `applyImportedCodexState`：它的语义（按本机原状态写启停）与现行策略（导入一律停用未信任）冲突，且没有任何生产调用点。

### 验证

- 908 项单元测试（新增 1 条：写在应用目录外时被拒绝且原文件不被修改）；冒烟 338 项全通过。

## [0.36.4] - 2026-11-02

### 修复

- **运行时校验偶发卡死**：帧率断言依赖 `requestAnimationFrame`，而 Chromium 在窗口被系统判定完全不可见时会直接暂停 rAF。命令行里的 `--disable-*` 与 `setAlwaysOnTop` 都挡不住这种情况，于是整轮验证卡在 30 秒超时。现在测量前先恢复窗口并检查 `document.visibilityState`；确认不可见时把帧率这一条记为「跳过」并写清原因，而不是判失败，布局与性能指标的其余断言照常执行。

### 验证

- 正常路径实测 242.3 FPS；用探针强制走不可见分支，确认记为跳过、不卡死、仍为 252/252。

## [0.36.3] - 2026-11-02

### 新增

- **更新真的可以执行**：能力中心的更新横幅新增「全部更新」。主进程新增 `capabilities/plugins/apply-updates.ts`，按候选类型分发——Claude 插件走 `plugin update`，内置 MCP 走 `applyUpdate`，Codex 插件先 `plugin marketplace upgrade` 刷新快照再重装（Codex 没有 `plugin update` 子命令），启用中的 Codex 插件重装后重新复制 skill。
- 逐条独立执行：单条失败不回滚其它条目，失败项带原因保留在横幅里供重试；整批结果写一条 `capability.apply-updates` 审计。更新完成后横幅显示「已更新 N 个」，而不是直接消失。

### 修复

- 横幅文案过期：市场页仍写「Codex 不加载 Claude 插件」，双 Agent 支持后已不成立，改为说明 Codex 从同一市场安装并同步 skill 到私有 `codex-home`。

### 验证

- 908 项单元测试；冒烟 338 项全通过（新增 4 条：真实候选产出、横幅「全部更新」按钮、插件更新到新版本、单条失败不影响其它条目），0 控制台错误。

## [0.36.2] - 2026-11-02

### 变更

- **preload 契约按域拆分**：`src/shared/ipc.ts` 985 → 136 行，只保留统一导出；各域定义移到 `src/shared/ipc/{tasks,notes,learning,habits,agent,mcp,capability,audit,app,channels,ws-api}.ts`。调用方仍 import `shared/ipc`，不要改成深路径。
- **能力中心 MCP 页独立**：`McpTab.tsx` 接管自定义/目录 Server、JSON 导入导出、工具级权限与环境自检的状态和请求，`CapabilityPanel.tsx` 1861 → 1019 行。

### 验证

- 902 项单元测试、冒烟 334 项全通过、0 控制台错误。

## [0.36.1] - 2026-11-02

### 变更

- **代码模块化**：主进程拆出 `validate.ts`（IPC 入参守卫统一入口）、`ipc/plugin-handlers.ts`、`ipc/agent-validators.ts`、`ipc/settings-audit.ts`、`db/capabilities-rows.ts`（列清单与行映射只写一遍）、`agent/codex-parser.ts`、`capabilities/mcp-secrets.ts`、`capabilities/plugins/components.ts`、`mcp/views.ts`。渲染层拆出 `components/capability/ToolsTab.tsx`、`components/settings/ProviderCard.tsx`、`components/learning/LearningStatsModal.tsx`，并新增 `lib/collections.ts` 与 `lib/labels.ts`。样式拆出 `22-settings.css`（原 10-overlays 的 946 行设置与 Provider 规则），CHANGELOG 旧版本归档到 `CHANGELOG-archive.md`，AGENTS.md 的冒烟覆盖面和当前状态移入 `docs/`。
- **删除死代码**：`capabilityHandlerIPC`、`pluginConfigDir`、`listPluginDirs`、store 的 `clearRemovedTask`，以及重复的 `assertId` / `assertText` / 对象守卫 / 空补丁守卫 / 审计闭包 / 密钥解密循环 / 插件 id 拆分 / MCP 视图筛选实现。

### 修复

- **导入插件的信任判断漏判**：本机导入用的是另一套组件探测，不识别 `.mcp.jsonc`，只带该文件的插件会被当成普通插件而跳过启用前的信任确认。现在市场安装与本机导入共用 `capabilities/plugins/components.ts`。
- **今日容量条被压扁**：`.w1-cap` 与能力中心根节点同名，后导入分节的 `flex: none` 覆盖了容量条的 `flex: 1`；容量条根节点改为 `.w1-capbar`。
- **能力中心分节覆盖设置面板宽度**：`19-capability.css` 里的 `.w1-settings-sheet.wide` 把 1040px 静默压回 860px，已删除并把设置样式集中到 `22-settings.css`。

### 验证

- 902 项单元测试、冒烟 0 失败 0 控制台错误；新增 `components.test.ts` 覆盖 `.mcp.jsonc` 探测与 id 拆分。

## [0.36.0] - 2026-11-02

### 新增

- **可配置存储位置**：设置页「数据」区可选择任意目录作为应用数据根，重启时执行迁移（复制 → 完整性校验 → 落位 → 切指针 → 删原目录）。位置记录在 `%APPDATA%\WorkStationForOne\location.json`，不进数据库；`WS_DATA_DIR` 仍优先。失败任一步都回滚并继续用原目录，残留 `.migrating-*` 下次启动自动清理。
- **插件双 Agent 归属**（DB v30）：`agent_plugins` 主键改为 `(agent, id)`，同一插件可在 Claude 与 Codex 各装一次；新增 `plugin_sources` 表管理官方与第三方 Git 源。
- **插件源服务**：支持本地目录与 Git 源，克隆 / 刷新 / 注册到两个 Agent 的私有环境；只认 `.claude-plugin/marketplace.json`（实测 Codex 也读这个格式），拒绝越界 source，地址白名单挡住 shell 元字符。
- **Codex 插件适配器**：启停改写私有 `config.toml` 的 `[plugins."name@market"] enabled`，只动目标行；写前断言路径必须在应用私有 `codex-home` 内，`~/.codex` 永不写入。
- **本机配置导入**：只读扫描 `~/.claude` 与 `~/.codex` 的市场与已装插件，界面勾选后复制进私有目录；扫描不改任何文件（测试断言内容哈希不变），导入后一律停用未信任。
- **启动更新检查**：应用启动 6 秒后检查插件与内置目录 MCP 的新版本，只产出候选列表并提示，不自动安装；离线与源不可达静默跳过。

### 修正

- `WS_DATA_DIR` 保持「直接指向 data 目录」的既有语义，不再被根目录派生多套一层 `data/`，否则测试与冒烟会读到另一份空库。
- 冒烟两处测试自身缺陷：工具开关断言未等 React 重渲染；审计断言只取最近 40 条，新增审计类型会把早期记录挤出窗口。

### 测试

- 876 项单元测试通过。

## [0.35.0] - 2026-11-02

### 新增

- **外部 MCP 按 Agent 归属**（DB v28）：`mcp_servers.targets` 取 `both | claude | codex`，默认 `both`。`runtimeServers('claude')` 与 `codexRuntime()` 各自只下发对应归属的 Server，`claudeToolPolicy()` 同步过滤，避免某个 MCP 只在一边稳定时两边都拿到工具。改归属不重置启用与信任；v27 旧库升级后既有 Server 一律视为 `both`。
- 能力中心外部 MCP 卡显示归属标签（仅非 `both` 时显示），表单增加「用于」选择，审计摘要带 `for=claude|codex`。

### 测试

- 798 项单元测试通过；新增 4 项覆盖归属持久化、v27 升级默认值、运行时与工具策略过滤、改归属不重置状态。

## [0.34.3] - 2026-11-01

### 验证

- **Codex 外部 MCP 写入**：临时库复制 DeepSeek Token 激活 Codex Provider，真实 `codex app-server` + 本地 HTTP 外部 MCP（`X-E2E-Key` 请求头，`write_probe` 写入工具）。能力中心测试连接列出工具；模型调用触发 `MCP · e2e-codex-http/write_probe` 审批卡，允许一次后工具执行、文件写入、工具卡完成。`codex-home/config.toml` 只出现 `env_http_headers` 变量名，不出现密钥值；`shell_environment_policy.exclude` 包含该变量；无控制台错误。
- 794 项单元测试、322 项冒烟通过；无代码变更。
- 仍未实测：需要密钥的成功鉴权公网 Server、其他 Codex Provider、OAuth 类远程 MCP。

## [0.34.2] - 2026-11-01

### 修复

- **原生工具审批**：真实 Claude 2.1.316 在 print 模式下同样不会为原生 `Write` / `Bash` 发 `can_use_tool`，会直接拒绝。`approval_request` 中继现在覆盖所有有本地桥的 Claude 会话，不再只限于存在外部 MCP 的会话；`AskUserQuestion` 在中继层自动拒绝。
- 原生工具与外部 MCP 的审批卡、会话 / 工作区规则和审计保持同一套；敏感工具仍不出现「此工作区允许」。

### 验证

- 真实 DeepSeek `/anthropic` + Claude CLI，无外部 MCP 的临时会话：`Write` 卡 → 允许一次 → 文件写入；`Bash` 卡 → 允许一次 → 重定向文件写入；两次 requestId 均为 `bridge-...`，工具卡完成，无控制台错误。
- 794 项单元测试、322 项冒烟通过。
- 仍未实测：需要密钥的成功鉴权公网 Server、真实 Codex 外部 MCP 写入工具。

## [0.34.1] - 2026-11-01

### 改进

- **远程 MCP 鉴权错误**：HTTP 401 / 403 显示「凭据被拒绝」、404「端点不存在」、429「请求受限」、5xx「服务异常」，并带上远端 `error_description` / `message`；错误体里出现请求头凭据时会抹成 `[已隐藏]`。

### 验证

- **公网远程 MCP**：DeepWiki `https://mcp.deepwiki.com/mcp`（SSE）测试连接列出 3 个工具；真实 Claude + DeepSeek 调用 `read_wiki_structure`（`facebook/react`），审批卡「允许一次」后返回真实仓库文档结构，工具卡状态完成、无控制台错误。
- **鉴权差异**：Semgrep `https://mcp.semgrep.ai/mcp` 无凭据时返回「MCP 凭据被拒绝（401）：Authentication required」，不再只有裸状态码。
- 793 项单元测试、322 项冒烟通过。
- 仍未实测：需要密钥的成功鉴权公网 Server（当前没有对应凭据），以及真实 Codex 外部 MCP 写入工具。

## [0.34.0] - 2026-11-01

### 修复

- **外部 MCP 写入审批**：真实 Claude 2.1.316 在 print 模式下不会为外部 MCP 的 `ask` 工具发 `can_use_tool`，而是直接 `permission_denied`。本机桥新增 `approval_request` 中继工具，Claude 会话存在外部 MCP 时通过 `--permission-prompt-tool` 接管；中继复用现有工具审批卡、会话 / 工作区规则与 MCP 审计。中继只在有外部 MCP 的 Claude 会话暴露，没有外部 MCP 的会话仍走原有控制请求路径。
- 中继把 CLI 的 `{tool_name,input,tool_use_id}` 转成 allow / deny 决策返回；拒绝、应用窗口不可用、会话结束都按拒绝收尾，不默认放行。

### 验证

- 真实 DeepSeek `/anthropic` + Claude CLI + 本机 Streamable HTTP 外部 MCP `write_probe`：审批卡出现（含「此工作区允许」）→ 允许一次 → 工具真实执行并写入 nonce → 模型原样回报 `E2E_WRITE_OK`；数据库工具卡状态为完成，无控制台错误。
- 同一真实会话里 Claude 原生 `Write` 也经中继弹卡（requestId `bridge-...`，无「此工作区允许」），允许一次后文件落盘、工具卡完成；没有外部 MCP 的会话仍保留原 `can_use_tool` 路径。
- 792 项单元测试、322 项冒烟通过；冒烟断言能力中心会话收到 `--permission-prompt-tool mcp__workstationforone__approval_request`。
- 仍未实测：公网远程 HTTP MCP Server 的鉴权差异，以及真实 Codex 外部 MCP 写入工具。

## [0.33.1] - 2026-11-01

### 验证

- **HTTP 外部 MCP**：冒烟新增本机 Streamable HTTP 探针，从设置页完成添加、信任、启用与连接测试；走 `initialize → notifications/initialized → tools/list`，`tools/list` 以 SSE 返回，校验解密后的 `X-Smoke-Key` 请求头、`mcp-session-id` 透传、两个工具落库，并断言 Claude 临时 MCP 配置里 `http-mcp=http`。
- 322 项冒烟、0 失败、0 控制台错误；无数据库与业务代码变更。
- 仍未实测：公网远程 HTTP MCP Server 的鉴权差异，以及真实写入类外部 MCP 工具经模型调用的审批链路。

## [0.33.0] - 2026-11-01

### 新增

- **官方 Anthropic 鉴权**：Provider 按 Base URL 主机自动选择鉴权方式——`api.anthropic.com` 注入 `ANTHROPIC_API_KEY`（x-api-key），第三方 Anthropic 兼容端点继续用 `ANTHROPIC_AUTH_TOKEN`（Bearer）。自定义 Provider 生效时会移除继承环境里的另一种变量，避免 shell 中的旧 Key 抢占。
- 「测试连接」与「拉取模型」按同一推断顺序先发对应鉴权头，凭据被拒（401/403）时自动回退另一种；Key 仍只在主进程与子进程环境出现。
- **Provider 卡连接摘要**：Base URL 下实时显示推断的鉴权方式（官方 `x-api-key` / 兼容端点 `Bearer`）与实际请求端点（如 `/anthropic/v1/messages`），填错路径时不必等 404；未填地址时「拉取模型」直接禁用。设置页加入 `npm run capture -- ... settings` 截图支持。

### 验证

- 新增鉴权推断、端点拼接、官方头优先、401 回退、环境变量互斥的单元测试；788 项单元测试、320 项冒烟通过，无数据库变更。
- 设置页在 1440×900 / 1180×720 暗色下截图与布局审计通过；DeepSeek `/anthropic` 的 Bearer 路径回归通过；官方 Anthropic 真实 Key 尚未实测。

## [0.32.1] - 2026-11-01

### 修复

- **Claude 本地 MCP 写工具**：把 `tasks_create / tasks_update / tasks_complete / habits_check / learning_review / notes_create` 放回 CLI 的 `--allowedTools`；最终闸门仍是主进程的本地 MCP 桥（域权限 + 审批卡）。修复真实 CLI 下 MCP 写工具被 CLI 直接拒绝、应用收不到审批事件的问题。
- **真实验证**：DeepSeek `/anthropic` Provider + 真实 Claude CLI：第一次桥卡「此工作区允许」创建任务；第二次同工具无卡自动写入；设置撤销后第三次桥卡拒绝、任务未创建；审计有 write / auto:workspace / approval-rule create / revoke。777 项单元测试通过；无数据库变更。

## [0.32.0] - 2026-11-01

### 新增

- **Provider 模型列表**：设置页模型字段新增「拉取模型」，由主进程请求 OpenAI 兼容 `/models`（根路径 404 回退 `/v1/models`）或 Anthropic `/v1/models`（`x-api-key` 失败回退 Bearer），返回模型 id 供选择并回填；保留手动输入兜底。Key 只留在主进程，12 秒超时、不落库、不回显。
- 冒烟覆盖 `/models` 返回与选择回填；单元测试覆盖 OpenAI / Anthropic 路径、`/v1` 回退、去重、错误脱敏与超时。

### 验证

- 777 项单元测试、319 项冒烟通过；运行时断言 252–254 不变；无数据库变更。

## [0.31.2] - 2026-11-01

### 修复

- **设置面板**：基础页宽度从 560px 加宽到 760px，能力中心页宽度到 1040px；最大高度提升到 720px。设置说明、Provider 表单与审批规则列表获得更宽松的阅读区。
- 验证：317 项冒烟通过；无数据库变更。

## [0.31.1] - 2026-10-31

### 修复

- **可读性**：全局界面字体改为苹方优先的非衬线字体（中文苹方，拉丁/数字保留终端等宽）；设置页、能力中心与审批提示的说明文字、字段标签和小号行字号整体放大，说明文字改用次级前景色与 500 字重。
- 验证：766 项单元测试、317 项冒烟通过；无数据库变更。

## [0.31.0] - 2026-10-31

### 新增

- **审批规则**：MCP 工具与本地只读工具可按「Agent + 工作区」持久放行；Bash / Shell / Write / Edit / Patch / Permissions 等敏感工具仍只能单次或本会话允许。会话允许只存在主进程内存，应用退出失效。
- **卡片**：工具卡与 MCP 卡增加「本会话允许」「此工作区允许」；敏感工具不显示工作区按钮，主进程也会拒绝伪造的工作区作用域。
- **设置**：基础页新增「审批规则」列表，可按最近使用排序并撤销；规则创建、撤销与自动批准写入活动记录。
- **DB v27**：`approval_rules` 存 agent、工作区、规范工具名与最近使用时间，工作区路径按大小写与分隔符归一化。

### 修复

- **任务视图容量条**：能力中心与任务视图共用 `.w1-caprow`，后导入的 3 列 grid 把今日容量条压成 30px 并让按钮竖排；能力中心规则现限定在 `.w1-caplist` 内，容量条恢复原布局。

### 验证

- 766 项单元测试（审批规则纯函数、DB v27 迁移、规则服务与三条链路预检、IPC 入参校验）；317 项冒烟（敏感工具卡不出现「此工作区允许」、「本会话允许」后同轮自动放行、MCP 卡「此工作区允许」后不再弹卡、设置页显示 / 撤销规则与审计留痕）；252/252 运行时断言（新增「审批规则接口可用且为空」，接口返回空数组）。
- 20 张截图生成；五视图截图抽检未见横向溢出；审批卡与设置规则行按 CSS 契约核对（`.w1-pacts` 换行、`minmax` + 省略号）。

## [0.30.0] - 2026-10-30

### 新增

- **历史工具卡**：导入本机会话历史时，Claude 的 `tool_use` / `tool_result` 与 Codex 的 `function_call` / `function_call_output` 会转成现有工具卡，挂到相邻助手消息；执行结果回填「完成 / 失败 / 历史」状态，输入只保留一段压缩摘要。
- **边界**：工具卡沿用 `tools_json`，无数据库迁移；每条消息最多 20 个工具卡，完整命令输出与文件改动不导入。历史工具卡只读展示，不触发审批或重放。

### 验证

- 729 项单元测试（Claude 工具配对、Codex function call 状态、输入摘要、20 个工具上限、importMessages 工具卡往返）；300 项冒烟（导入线程出现 Read 工具卡与 `smoke-note.txt`、`tools_json` 落库）；运行时功能断言 252/253 通过，唯一失败是当前系统负载下主题切换 2 帧性能阈值（1994ms），待空闲复跑。
- 导入历史与工具卡在 1440×900 / 1180×720 的暗色 / 白天主题下无横向溢出。
- 本轮只覆盖 Claude `tool_use` 与 Codex `function_call`；其它自定义工具事件与完整输出不导入。

## [0.29.0] - 2026-10-30

### 新增

- **导入会话历史**：舰队控制台导入本机 Claude / Codex JSONL 时，顺带读取最近 200 条用户 / 助手正文（文件尾部 2 MB），导入后打开会话可直接看到历史，不再只有空聊天区。历史只读展示，新消息仍由原 CLI 续接，不会把旧历史重新喂给模型。
- **补历史**：已导入的会话不再禁用按钮，改为「补历史」，可重新扫描并补齐新增消息；重复导入使用固定消息 id，幂等覆盖，不产生重复行。
- **DB v26**：`agent_messages.origin` 标记 `app | import`；导入消息带固定 id 与原始时间，仓储批量写入使用事务。现有应用消息默认 `app`，不受影响。
- **界面**：导入会话顶部显示「导入自本机 CLI 的只读历史 · 新消息继续由 CLI 续接」，历史正文直接进入现有聊天流。

### 验证

- 728 项单元测试（历史解析、系统行过滤、200 条上限、DB v26 迁移、幂等导入、store 历史映射）；300 项冒烟（导入后线程出现历史正文、`origin='import'` 落库、补历史按钮）；251/251 运行时断言。
- 导入会话在 1440×900 / 1180×720 的暗色 / 白天主题下无横向溢出，历史说明条与消息行正常折行。
- 本轮只导入正文，工具卡 / 命令输出不进入历史；更早的 200 条之前的消息不导入。

## [0.28.0] - 2026-10-30

### 新增

- **Codex 外部 MCP**：激活 Codex Provider 后，能力中心里已启用且已信任的外部 MCP 会随应用自己的 `codex-home/config.toml` 下发到 `codex app-server` 会话；继承 CLI 的 `codex exec` 仍保持只读、不接外部 MCP。stdio Server 使用 `env_vars`，HTTP Server 使用 `env_http_headers`，密钥值只进 app-server 子进程环境，并全部加入 `shell_environment_policy.exclude`；配置里只出现环境变量名，不写 `~/.codex`。
- **审批与工具策略**：外部 Server 默认 `default_tools_approval_mode = "prompt"`，每次工具调用进入现有审批卡；`allow` 写为工具级 `approval_mode = "auto"`，`deny` 写进 `disabled_tools`，app-server 的 elicitation 处理再按同一策略兜底（allow 自动接受、deny 直接拒绝、ask 弹卡）。
- **界面**：能力中心 MCP 说明更新为「Claude 会话 + Codex Provider 会话」，并注明密钥只进子进程环境与继承 CLI 的 exec 不受影响。

### 验证

- 721 项单元测试（新增 Codex MCP 运行时、密钥环境变量名、TOML 序列化与引号、工具策略、app-server 外部 allow / ask / deny 审批）；298 项冒烟（外部 MCP 说明、Codex Provider 配置包含 `memory` 与本地桥且不含 Provider 密钥）；251/251 运行时断言。
- 用 Codex CLI 0.166 在临时 `CODEX_HOME` 验证 `env_vars`、`env_http_headers`、`default_tools_approval_mode`、`disabled_tools` 与工具级 `approval_mode` 可被 `codex mcp list --json` 解析。
- **真实调用验证**：用现有 Codex Provider（`deepseek-flash`）在隔离 `CODEX_HOME` 与临时工作区挂载本地 stdio 外部 MCP，模型实际调用 `echoprobe/echo`，`mcpServer/elicitation/request` 到达并接受，工具返回 `external-mcp-ok`，回合正常完成。真实 elicitation 的 `_meta` 不带 `tool_name`，应用按 `message` 中的工具名解析策略，已补对应回归。
- 能力中心 MCP 页在 1440×900 / 1180×720、暗色 / 白天均无横向溢出。
- 本轮真实调用只验证 stdio 外部 MCP；HTTP 外部 MCP 与真实写入类工具仍需单独验证。

## [0.27.0] - 2026-10-30

### 新增

- **导入本机会话**：舰队控制台新增「导入本机」，只读扫描本机 Claude / Codex CLI 的 JSONL 会话（Claude `~/.claude/projects`、Codex `~/.codex/sessions`），解析会话 id、标题、工作区与更新时间。已导入的会话标为「已导入」，工作区目录不存在的禁止导入；导入只建立应用内会话并保存 resume id，不复制历史、不改外部配置，后续消息仍交给原 CLI 续接。导入前应先关闭外部窗口，避免同一会话被两处同时写入。
- **扫描边界**：只读文件头 128 KB、最多 240 行，跳过符号链接；总数上限 300 个文件、每个 Agent 最多 60 个会话。标题优先使用 Claude 摘要，其次为第一条真实用户消息；系统提醒、命令回显、Codex 环境说明不会被当成标题。自动化可用 `WS_SESSION_SCAN_ROOT` 指向临时 home，不读取真实用户目录。
- **界面**：舰队控制台头部新增「导入本机」开关，面板按 Claude / Codex 分组显示标题、工作区路径、更新时间和导入状态；导入成功立即进入舰队列表并选中为当前会话。窄窗口下导入面板内部滚动，不挤压模态框。

### 验证

- 712 项单元测试（新增本机会话解析、去重、工作区失效、导入参数校验与 store 导入选中）；296 项冒烟（`WS_SESSION_SCAN_ROOT` 指向临时 home，打开舰队 → 只读扫描 → 导入 → 断言舰队新增、resume id / 工作区落库、按钮变为已导入）；251/251 运行时断言。
- 舰队导入面板在 1440×900 与 1180×720 的暗色 / 白天主题下均无横向溢出，模态框与导入列表滚动正常。
- 导入本身不调用模型；真实 Claude / Codex 会话的续接质量仍需单独验证（本轮只验证元数据扫描与落库）。

## [0.26.0] - 2026-10-30

### 新增

- **市场体验**：技能市场按安装量排序（热度 / 名称），卡片显示安装数，默认分批加载 48 个并提供「加载更多」。
- **本地技能**：支持导入裸 `SKILL.md`、`skills/` 目录或完整插件到应用私有目录；自动包裹插件清单，安装后仍默认停用。支持源文件列表、SKILL.md 预览与打开目录；本地插件移除只删私有目录。
- **工作区文件与产物**：Agent 顶栏「文件」打开只读文件树，跳过 `.git / node_modules / dist`；点击文件预览文本（越界/二进制/超过 128 KB 均拒绝）；Write / Edit / Patch 工具卡汇总为「本回合产物」。通过 portal 渲染，使用全屏遮罩。
- **会话预设（DB v25）**：`agent_presets` 保存名称 / Agent / 工作区；舰队控制台「存预设」保存当前会话，预设区一键用相同工作区新建，可删除。
- **用量统计（DB v25）**：`agent_runs` 记录每轮开始/结束、成功/取消、成本、时长、轮次；舰队「用量」展示近 7 天汇总与每日运行柱。

### 验证

- 703 项单元测试（工作区越界/二进制/大文件、本地技能导入与详情、预设/用量仓储、市场排序与用量纯函数）；294 项冒烟（本地技能导入/详情/移除、工作区文件树/预览、预设保存/删除、用量统计、运行用量落库）；251/251 运行时断言。
- 工作区与舰队用量界面在 1440×900 / 1180×720 暗色与白天检查无横向溢出。
- 外部终端窗口导入仍未实现；只统一应用内会话。

## [0.25.0] - 2026-10-30

### 新增

- **MCP 工具级权限（DB v24）**：`mcp_server_tools` 保存工具名、描述、只读标记与 `allow|ask|deny`；连接测试同步工具元数据，改配置清空重测。Claude 启动时只把 allow 放进 `--allowedTools`、deny 放进 `--disallowedTools`，ask 继续走同一张审批卡；自动批准默认只建议用于只读工具。
- **环境自检**：能力中心显示 node / npx / uvx / git / claude / codex 的路径与版本，缺失项单独标红；只读检查，不自动安装系统工具。
- **MCP JSON 导入导出**：支持 `mcpServers` 结构批量导入，重名跳过、逐条报错，导入后默认停用未信任；导出保留命令/参数/URL 与 env/header key，**不导出密钥值**。
- **界面**：工具行可展开为「自动 / 询问 / 禁止」三档；导出面板支持全选 JSON；已安装列表增加分组标题。

### 验证

- 694 项单元测试（新增工具同步/审批保留、环境自检、JSON 解析与脱敏导出、Claude allow/deny 参数）；286 项冒烟（环境标签、JSON 导出/导入、工具级权限设置、移除不残留）；251/251 运行时断言。
- 1440×900 / 1180×720 暗色与白天下的能力中心环境条、工具面板与 JSON 面板无横向溢出。

## [0.24.0] - 2026-10-30

### 新增

- **舰队控制台**：状态栏「舰队 N」、左侧舰队区与命令面板三处入口；按 Claude / Codex 分组展示所有应用内会话的状态、工作区、消息数、排队与审批数量。
- **统一操作**：全部 / 运行中 / 待审批 / 空闲筛选；打开会话、停止有 runId 的运行、直接新建 Claude / Codex 会话；汇总运行数与待审批数。
- **边界**：只统一 WorkStationForOne 自己启动或恢复的会话，不扫描、不接管外部终端窗口；外部窗口导入留到后续单轮。

### 验证

- 687 项单元测试、282 项冒烟（舰队入口、分组列表、汇总、筛选、打开会话）、251/251 运行时断言；舰队控制台在 1440×900 / 1180×720 暗色与白天布局检查无横向溢出。
- 仍只验证应用内会话；真实模型与外部窗口未涉及。

## [0.23.0] - 2026-10-30

### 新增

- **外部 MCP 连接测试与工具发现（DB v23）**：`mcp_servers` 增加 `tools_json / last_test_at / last_error`；已信任的 stdio / HTTP Server 可执行一次 `initialize → notifications/initialized → tools/list`，10 秒超时，结果写入本机库，能力中心显示连接状态、工具数与工具名。
- **Windows 命令解析**：stdio 测试命令经统一的 `resolveCommand()` 解析 `.cmd` 包装，`npx` / `uvx` / `node` 不会因直接 spawn 包装而 EINVAL；HTTP 测试携带 `mcp-session-id`，支持 SSE 与 JSON 响应。
- **真实市场镜像**：Claude CLI 自带的 marketplace add 会做完整 clone，本机网络会卡住，且本地目录不能使用官方保留名。应用改为 `git clone --depth 1 --sparse` 到私有 `market-src`，manifest 改名 `wsfo-official` 后注册本地目录，界面显示「Claude 官方」；真实网络验证到 315 个插件，`agent-sdk-dev` 安装路径可用。CLI 的 multi-line pretty JSON 解析与 `npx.cmd` 的 `SET` 变量包装也一并修正。
- **真实 MCP 验证**：`npx @modelcontextprotocol/server-sequential-thinking` 完成 initialize 并返回 `sequentialthinking`；`resolveCommand()` 现在能正确从 npx 包装里取 `npx-cli.js`（不是 `npm-prefix.js`）。测试结束用 `taskkill /T` 清理整棵子进程树，避免 npx / uvx 拉起的 MCP Server 残留后台。
- **界面优化**：MCP 已安装列表增加「已安装 N」小标题与「启用并信任后可测试连接」提示；市场首次加载文案改为 1–2 分钟的官方镜像说明。
- **管理体验**：自定义 Server 可在能力中心添加、信任、启用、测试、移除；修改命令/URL/参数会清空旧测试结果，避免显示过期工具清单。

### 验证

- 687 项单元测试（新增 stdio / HTTP MCP 探测、信任门槛、测试失败留痕、DB v23 迁移、pretty JSON 与 npm 变量包装）；277 项冒烟（自定义 stdio MCP 添加 → 信任 → 连接测试 → 工具清单 → 移除；Claude 子进程仍只收到启用的 Memory 与私有插件）；251/251 运行时断言。
- 真实验证：官方市场 315 个插件；`sequential-thinking` MCP 工具发现；`agent-sdk-dev` 通过本地镜像 CLI 安装。
- 仍未验证：真实模型内的技能触发；外部 MCP 仍只注入 Claude，其它第三方 MCP Server 的连接仍需逐个测试。

## [0.22.0] - 2026-10-30

### 新增

- **能力中心（DB v22）**：`agent_plugins`、`mcp_servers`、`mcp_server_secrets` 三张表；设置页新增「基础 / 能力中心」分区，包含 Claude 插件、外部 MCP 与内置工具目录。
- **Claude 插件市场**：通过隔离的 `CLAUDE_CONFIG_DIR` 调用 Claude CLI 读取官方市场、安装/更新/卸载插件；插件只落在应用数据目录，Claude 会话通过 `--plugin-dir` 按会话加载，不写 `~/.claude`。新装默认停用，带 hooks/MCP 的插件必须二次确认信任。
- **外部 MCP 管理**：内置 4 个免配置目录（Memory / Sequential Thinking / Fetch / Time），支持自定义 stdio / HTTP Server；env 与 header 值用 `safeStorage` 加密，列表只回 key；启动 Claude 时解密进临时 `--mcp-config`。新装默认停用未信任，启用需二次确认；支持 npm / PyPI 版本检查与更新。
- **隔离**：Claude 会话始终带 `--setting-sources project` 与 `--strict-mcp-config`，用户级 settings 与全局 MCP 不进入应用会话；外部 MCP 目前只注入 Claude，Codex exec / app-server 保持原状。
- **内置工具目录**：展示本地 MCP 桥的 11 个数据工具与读写/域信息；不新增任意 Shell / 文件工具。

### 验证

- 678 项单元测试（新增 DB v22 迁移、插件目录/市场解析、MCP 加密与更新、隔离参数）；274 项冒烟（stub 插件市场安装/启用、MCP 添加/信任/启用、子进程收到私有 `--plugin-dir` 与 `--strict-mcp-config`）；251/251 运行时断言；能力中心在 1440×900 与 1180×720 的暗色/白天布局均无横向溢出。
- 仍未验证：真实 Claude 市场网络拉取、真实模型内的技能触发、真实第三方 MCP Server 连接；这些需要联网与真实 Provider 单独测试。

## [0.21.0] - 2026-10-30

### 新增

- **多会话并发**：同一会话仍保持串行，不同会话可以同时启动各自的 CLI 子进程。渲染层用 `streams[sessionId]`、按会话排队的待发送提示词与 `runId → sessionId` 事件路由；A 会话慢速运行时，B 会话可以正常发送、流式回复并结束，互不锁输入框。
- **审批与后台会话**：工具审批卡与 MCP 写入审批卡按会话保存，后台会话的审批不会抢占当前聊天；输入栏上方提示「其它会话有 N 项待审批」，状态栏汇总待审批数量并可直达。
- **审批 id 隔离**：主进程把工具审批请求 id 加上 `runId:` 前缀再发给渲染层，再按前缀路由回对应运行。Codex app-server 的进程内小整数 id 与 stub 的固定 id 在并发时不会串台。
- **并发冒烟**：慢速 stub 让两个 Claude 会话同时运行，断言后发会话先完成、慢会话仍在等待，随后各自独立收尾；两个会话同时弹审批卡（stub 故意复用同一个进程内 `request_id`），允许甲后甲完成、乙仍等待，再拒绝乙，验证作用域前缀与按会话落卡。

### 验证

- 661 项单元测试（新增独立流、按会话排队、审批卡互不覆盖、结束只清自己的卡）；265 项冒烟；251/251 运行时断言。

## [0.20.1] - 2026-10-30

### 优化

- **Codex MCP 只读免重复审批**：`isReadOnlyMcpTool()` 从本地桥的工具定义判断只读工具；Codex 的只读 MCP elicitation 直接回 `accept`，仍写 `mcp/read` 审计。写入工具继续进入工具审批卡，允许后才调用桥。
- **真实读写回归**：DeepSeek `deepseek-flash` 的 `today_overview` 读取不再弹卡，`tasks_create` 写入仍弹卡并落库；审计 read/write 均在，无控制台错误。

### 验证

- 655 项单元测试、254 项冒烟、251/251 运行时断言。

更早的版本（0.1.0–0.20.0）见 [CHANGELOG-archive.md](CHANGELOG-archive.md)。
