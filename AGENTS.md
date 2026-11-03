# WorkStationForOne

仅支持 Windows 的 Electron 桌面应用。产品范围与架构见 `docs/superpowers/specs/2026-10-23-workstation-design.md`；改动范围前先读它。

## 命令

在仓库根目录运行。
- `npm install` — 安装依赖。
- `npm run dev` — 启动 electron-vite 开发服务器，支持 HMR。
- `npm run build` — 生产构建，输出到 `out/`。
- `npm start` — 预览上一次构建；先运行 `npm run build`。
- `npm run typecheck` — 类型检查 main/preload 与 renderer 配置。
- `npm test` — 运行全部 Vitest 单元测试。
- `npm test -- src/renderer/src/lib/schedule.test.ts` — 运行单个测试文件。
- `npm run check` — Biome 检查格式与 lint（Rust 单二进制，不依赖 Prettier / ESLint）。
- `npm run check:fix` — 自动修复格式与可安全修复的 lint 问题。
- `npm run fmt` — 只格式化，不跑 lint。
- `npm run smoke` — 先构建，再跑 UI 交互冒烟（真实主进程 + preload + 临时 SQLite）。覆盖面与各测试缝见 `docs/development/smoke.md`。
- `npm run verify` — 构建后启动真实主进程（临时 `WS_DATA_DIR` + 临时 Chromium profile），运行 252–254 项运行时断言（起始主题不同会差 2 项分支）：五视图互斥、双主题/双皮肤持久化、跨重启数据。验证期间自动补齐 dark/prism 基线、置顶聚焦并关闭后台节流，避免真实应用偏好和窗口遮挡干扰性能断言。帧率项在窗口被系统判定不可见时（Chromium 会暂停 rAF）记录为「跳过」而不是失败，只跳过这一条，布局与性能指标的其余断言照常执行。
- `npm run capture -- .screenshots/shell-1440.png 1440 900 .screenshots/audit-1440.json` — 构建、保存截图并写入布局审计。
- `npm run capture -- .screenshots/shell-1180.png 1180 720 .screenshots/audit-1180.json dark` — 在最小窗口尺寸下做同样的检查；主题参数为 `dark|light`，视图参数为 `today|tasks|agent|notes|learning|settings`，均可省略审计路径后按任意顺序追加（如 `... 1440 900 light tasks`、`... 1440 900 dark settings`）。
- `npm run capture -- .screenshots/tasks-1180.png 1180 720 dark tasks` — 只截某个视图并省略审计路径。
- `npm run icon` — 从 `resources/icon.svg` 与 `resources/icon-small.svg` 重新生成 `resources/icon.png` 和多尺寸 `resources/icon.ico`。
- `npm run package` — 构建并生成便携版到 `dist/WorkStationForOne/`（Electron 运行时 + `resources/app`），双击 `WorkStationForOne.exe` 即可运行。不引入打包器：electron-vite 的产物已自包含，主进程不 require 第三方包。`dist/` 已忽略。验证时必须先清掉 `ELECTRON_RUN_AS_NODE`，否则 Electron 会把自己当 Node 跑并立刻退出。

始终通过上述封装脚本启动 Electron。本环境可能设置 `ELECTRON_RUN_AS_NODE=1`；封装脚本会清除它并正确解析 electron-vite CLI。直接调用 `electron` 或 `electron-vite` 可能失败。应用是单实例的：启动新窗口前先关闭已有窗口。

## 安全与进程边界

- 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。渲染进程没有 Node、数据库或文件系统访问权；需要时扩展窄接口的类型化 preload 桥。
- 禁止添加或默认启用 `--dangerously-skip-permissions` 或 `--dangerously-bypass-approvals-and-sandbox`。应用内 Codex 分两种策略：没有激活 Codex Provider 时继续走 `codex exec` 只读（`--sandbox read-only` + `approval_policy="never"`）；激活了工具自己的 Codex Provider 时走 `codex app-server --stdio`，线程使用 `:workspace` 权限与 `approvalPolicy="on-request"`，命令、文件改动与额外权限请求接到同一张审批卡；允许可按单次或本会话生效，工作区持久只对 MCP 与本地只读工具开放。两条路径都不得加 `--dangerously-*`，不写 `~/.codex`、不改 CC Switch、Codex Desktop 或 Claude Desktop。真实模型验证必须单独征得用户同意。
- 本地 MCP 服务器只绑定 `127.0.0.1`，使用随机端口和按会话生成的 Bearer Token。Token 不得进入日志、审计记录、命令行参数或仓库文件；MCP 配置只写进每轮临时文件（`--mcp-config`），子进程结束即删。MCP 提供读 / 写工具，写入受域权限与询问卡约束，不做任意 SQL / 文件 / Shell。
- 默认不存储 API Key，继承现有 CLI 登录状态；只有用户显式保存的自定义 Provider 会把 Key 以 `safeStorage` 加密 BLOB 存进本机库，且永不回显、不写日志、不进命令行。Provider 按 `claude|codex` 分目标，各自最多一个 active；工具启动 Claude/Codex 时只注入对应目标的配置，不改 CC Switch、Codex Desktop 或 Claude Desktop。
- v1 坚持本地优先：不添加云同步、遥测或托管服务。
- 不要自动重试可能产生副作用的回合。重试必须是用户显式操作。
- 不请求或渲染隐藏思维链。展示工具调用、输出与权限请求。
- 禁止提交密钥或个人配置。

## 架构与约定

- `src/main` 是唯一允许持有数据库、子进程、MCP 服务器、权限与审计的进程。`src/preload` 暴露窄的类型化桥。`src/renderer` 只负责 UI。
- `src/shared/ipc.ts` 只是统一导出入口，各域类型定义在 `src/shared/ipc/` 下（tasks / notes / learning / habits / agent / mcp / capability / audit / app / channels / ws-api）。新增类型加到对应域文件并在 `ipc.ts` 里再导出；调用方一律 import `shared/ipc`，不要走深路径。入参校验统一用 `src/main/validate.ts`，不要每个 handler 手写一遍。
- 保持模块有深度：把纯规则放进小接口并测试（`lib/schedule.ts`、`lib/agent.ts`、`lib/todo.ts`、`lib/todo-parser.ts`、`shared/date-key.ts`）。组件只做编排，不重复业务规则。
- 任务日期一律用本地日期键 `YYYY-MM-DD`（`shared/date-key.ts`），不要用 `Date` 对象或 UTC 字符串存库；今天/逾期/即将到来的口径集中在 `lib/todo.ts`，组件不要自行比较日期。
- 任务快速添加语法解析在 `lib/todo-parser.ts`，只做确定性规则，不接模型。新增语法先写解析测试。解析走 `tokenizeTaskInput()`，命中片段用等长空白覆盖（不是删除），因此区间下标始终映射回原始输入；`parseTaskInput()` 是它剥掉 `spans` 的包装，对外签名保持不变。要加高亮种类只改 `TokenKind`。
- 键盘速查表由 `lib/shortcuts.ts` 的 `SHORTCUT_GROUPS` 驱动：`?` 只在非输入场景打开（`isTypingTarget` 判定 input / textarea / select / contenteditable），状态栏与命令面板各有一个入口。改键位要同时改三处，`shortcuts.test.ts` 会先失败。
- 快速添加与全局捕获窗都用 `components/fields/HighlightedInput`：`<input>` 内部无法给子串上色，所以用一层镜像只画 token 底纹，input 自己画字与光标。镜像与 input 的字体度量由同一个 `--hl-font` 变量驱动，父级改字号只改变量；组合输入期间不渲染 span，避免拼音候选阶段底纹乱跳。
- 中文里「一点 / 两点」更常是量词（有一点问题、两点意见）：无时段前缀时不得当作钟点，带「下午 / 凌晨」等前缀才识别。截止语「前 / 之前 / 以前」并入日期，但不能吞掉「前台」「前面」，改动时保留这些边界测试。
- Agent 现在真的驱动本机 CLI：`main/agent/claude.ts` 用 `claude -p --input-format stream-json --output-format stream-json --permission-prompts host --permission-mode manual`，用户消息以 stream-json 写入 stdin，事件在 `shared/agent-stream.ts` 解析后经 `agent:event` 推给渲染层。提示词只走 stdin，命令行里不含用户文本；`shell: false`。CLI 的读工具与 11 个 MCP 工具（5 读 + 6 写）放进 `CLAUDE_ALLOWED_TOOLS`；桥内 `approval_request` 不进入白名单，由 `--permission-prompt-tool` 单独指定；CLI 写入类工具（Edit / Write / Bash）不得加入白名单，统一经本机桥 `approval_request` 中继到审批卡（`can_use_tool` 仅作为 adapter 兼容路径保留）。MCP 写工具也在允许列表里，但主进程会按 `mcp_domain_modes` 再拦一次，不能绕过域权限。stdin 必须保持打开到本轮 `result` 再关闭，否则无法回写 `control_response`。不得加 `--dangerously-*`。CLI 路径可用 `WS_AGENT_CLI` 覆盖（冒烟指向 `scripts/stub-agent.cjs`），找不到 CLI 或执行失败必须明确报错，不得静默退回 `demoReply()`——它只用于无 preload 桥的浏览器调试。
- 工具审批：CLI 的 `can_use_tool` 控制请求由 `startClaudeRun` 转成 `permission` 事件，主进程保存原始 input 与 `tool_use_id`，用户选择允许（一次 / 本会话 / 此工作区）或拒绝后才回 `control_response`；拒绝要带原因。所有有本地桥的 Claude 会话都改用 `--permission-prompt-tool mcp__workstationforone__approval_request`：真实 CLI 在 print 模式下既不会为外部 MCP 的 `ask` 工具、也不会为原生 `Write` / `Bash` 发 `can_use_tool`，必须由本机桥中继成同一张审批卡；中继复用会话 / 工作区规则与审计，窗口不可用或会话结束按拒绝，`AskUserQuestion` 自动拒绝。原生 `Write` / `Bash` 与外部 MCP 写入均已实测，敏感工具卡不出现「此工作区允许」。所有工具都可「本会话允许」；MCP 工具与本地只读工具另可「此工作区允许」持久放行（见审批规则），敏感工具不落库；`AskUserQuestion` 在 v1 自动拒绝，不要把问答混进工具审批卡。自动化只用 stub 的 `control_request` 链路验证，真实模型验证必须有可用 provider 并单独征得用户同意。
- 会话状态按 session ID 限定作用域：`threads` 以它为键，`pendingReplyTo` / `permission.sessionId` 用于选择当前会话。新增会话或审批流程时保持这一约定。
- Agent Provider（DB v20）：`provider_profiles` 存名称、目标（`claude|codex`）、`wire_api`、Base URL、模型与**加密后的** token；token 用 Electron `safeStorage`（Windows DPAPI）加密，列表接口绝不返回 token，渲染层也永不回显。每个目标默认没有激活配置，表示继承对应 CLI。所有 Claude 会话都传 `--setting-sources project` 与 `--strict-mcp-config` 屏蔽用户级 settings 与全局 MCP；Claude 自定义 Provider 启动时再把 `ANTHROPIC_BASE_URL / MODEL` 与鉴权变量只注入子进程环境——官方 `api.anthropic.com` 用 `ANTHROPIC_API_KEY`（x-api-key），其它 Anthropic 兼容端点用 `ANTHROPIC_AUTH_TOKEN`（Bearer），两种变量互斥并会移除继承环境里的另一种，避免 shell 里的旧 Key 抢占；Codex 自定义 Provider 使用应用自己的 `codex-home/config.toml`（`env_key = "WS_CODEX_PROVIDER_TOKEN"`），token 只进子进程环境，`CODEX_HOME` 指向应用数据目录，`shell_environment_policy.exclude` 再把 token 从 Codex 启动的 shell 环境里剔除，不读/不改 `~/.codex` 或 CC Switch。Codex CLI 0.166 起只支持 `wire_api=responses`，设置页不再提供 Chat，主进程也会拒绝保存 Codex + Chat；DB 里的旧值保留，但 `runtime('codex')` 会按 Responses 运行。设置页「测试连接」由主进程做一次最小 HTTP 探测（Codex `/responses`、Claude `/v1/messages`），按同一鉴权推断先发对应头，401/403 再回退另一种；Key 留空时复用当前已保存 token；12 秒超时、不落库、不写日志、不回显 token。模型字段可「拉取模型」：主进程按目标请求 OpenAI 兼容 `/models`（根路径 404 回退 `/v1/models`）或 Anthropic `/v1/models`（同样先试对应鉴权头，401/403 回退另一种），只返回模型 id，保留手动输入兜底；Key 同样不离开主进程。
- 审批规则（DB v27）：`approval_rules` 只存 `agent + workspace + tool_name` 的工作区级精确放行；MCP 工具与本地只读 `Read/Grep/Glob/LS` 可持久，Bash / Shell / Write / Edit / NotebookEdit / Patch / Permissions / Task / WebFetch / WebSearch 只能「本会话允许」或单次。会话规则在主进程内存，应用退出即失效；工作区规则可在设置「审批规则」撤销。四条链路（Claude `can_use_tool` 兼容路径、Claude `approval_request` 中继、Codex app-server、本地 MCP 桥）在发卡前同步查规则；桥的裸工具名按会话 Agent 还原为 `mcp__workstationforone__*` / `MCP · workstationforone/*`，同一规则同时压掉适配器卡与桥卡。规则查询 / 审计失败按未命中处理（fail closed），规则落库失败不阻塞当前允许；不得用规则绕过 MCP 域权限、工具策略或沙箱，也不得加通配符 / 持久拒绝 / `--dangerously-*`。真实 Claude（DeepSeek `/anthropic`）已验证：首次桥卡「此工作区允许」→ 二次同工具无卡 → 撤销后第三次被拒；外部 MCP 写入工具，以及无外部 MCP 会话里的原生 `Write` / `Bash`，都经 `approval_request` 中继弹卡并在允许一次后执行。真实 CLI 在 print 模式下没有触发 `can_use_tool`，该路径仅兼容保留。
- Agent CLI 启动统一走 `main/agent/cli.ts`：Windows 上 npm 生成的 `.cmd` 不能直接 `spawn`（会 EINVAL），解析器会读包装里的真实入口，原生 `.exe` 直接启动、`.js` 交给 Electron-as-Node；除直接引号入口外，也支持 `SET "VAR=%~dp0\..."` 变量包装（npx.cmd / npm.cmd），并取最后一个脚本入口而不是 `npm-prefix.js`。Claude 与 Codex 共用 `WS_AGENT_CLI` / `WS_CODEX_CLI` 测试缝；外部 MCP 测试用 `resolveCommand()`。找不到入口要明确报错，不要退回演示回复。
- Agent 工作区（DB v21）：`agent_sessions.workspace` 存每个会话自己的绝对目录；主进程在 `agent:update-session` 校验绝对路径、存在且为目录，`agent:send` 只从数据库取工作区，不允许渲染层临时指定 cwd。`workspace` 为空时拒绝启动并要求先选择；Claude、Codex exec、Codex app-server 都使用该目录，不再使用 `process.cwd()`。原生目录选择器在 `agent:pick-workspace`，取消返回 null；`WS_PICK_WORKSPACE` 是自动化测试缝，跳过对话框但仍走同一校验。Agent 顶栏显示目录名与完整路径，未选择时显示说明卡并禁用输入框。
- Codex 适配器（v0.17.0）：继承 CLI 时走 `codex exec --json` 只读；激活 Codex Provider 后走 `codex app-server --stdio`，流程是 `initialize → initialized → thread/start|resume → turn/start`，提示词只走 stdin JSON-RPC，审批用同一个 JSON-RPC 回写 `accept|decline`，`turn/completed` 后结束进程。线程固定 `permissions=':workspace'` + `approvalPolicy='on-request'`，不传 `danger-full-access`；`item/agentMessage/delta` 负责流式正文，`item/*` 映射工具卡，`reasoning` 不渲染。续接用 `thread/resume` + `agent_sessions.resume_id`；找不到 thread 明确报错，不静默新开。`item/permissions/requestApproval` 允许时只授予本次回合请求的权限。测试缝 `WS_CODEX_CLI` 指向 `scripts/stub-codex.cjs`，stub 同时回放 exec 与 app-server；不要为此加危险参数，真实模型验证必须单独征得用户同意。
- Codex 外部 MCP（v0.28.0）：只对激活 Codex Provider 的 app-server 会话下发，继承 CLI 的 `codex exec` 不接（隔离 `codex-home` 没有 CLI 登录态）。`main/capabilities/codex-mcp.ts` 把启用且已信任的 Server 转成配置与策略：stdio 写 `command / args / env_vars`，HTTP 写 `url / env_http_headers`，密钥值只进 app-server 子进程环境，配置里只有 `WS_MCP_<SERVER>_E_<KEY>` / `_H_<HEADER>` 变量名；所有名字加入 `shell_environment_policy.exclude`，仍然不写 `~/.codex`。外部 Server 默认 `default_tools_approval_mode = "prompt"`，allow 工具写 `approval_mode = "auto"`，deny 写 `disabled_tools`；app-server 的 `mcpServer/elicitation/request` 再按 `policies[server][tool]` 兜底。Codex 0.166 已在临时 `CODEX_HOME` 用 `codex mcp list --json` 验证这些字段可解析；真实 elicitation 的 `_meta` 不带 `tool_name`，handler 用 `message` 中的工具名兜底（实测命中 `MCP · e2e-codex-http/write_probe`）。真实 `deepseek-flash` 已在隔离 `CODEX_HOME` 调用本地 stdio 外部 MCP 的 `echo` 并返回 `external-mcp-ok`；本地 HTTP 外部 MCP（自定义请求头 + `write_probe` 写入工具）已用真实 Codex app-server + DeepSeek 验证：config.toml 只出现 `env_http_headers` 变量名，elicitation 卡「允许一次」后工具执行，密钥值不进配置，`shell_environment_policy.exclude` 含该变量。
- 智能体会话持久化（DB v16）：`agent_sessions` + `agent_messages`，消息工具卡存 JSON；`resume_id` 保存 Claude 自己的会话 id。Agent 页不播种演示会话，空库显示空态并提供「新建 Claude / Codex 会话」；用户消息立即落库，助手消息在本轮结束时连同工具卡落库，流式中间态不逐 token 写库。启动时把所有遗留 `run/wait` 重置为 `idle`，并按 localStorage 的 `workstation.agentActive` 恢复选中会话。`hydrateAgent()` 必须用数据库结果覆盖内存种子。
- 多会话并发（v0.21.0）：主进程按会话串行、跨会话并行——`agent:send` 只拒绝同一 `sessionId` 的第二个运行。渲染层用 `streams[sessionId] = { runId, messageId }`、`pendingPrompts[]` 与 `toolPermissions / mcpPermissions` 按会话保存状态；`useAgentRun` 用 `runId → sessionId` 映射路由事件，runId 返回前先缓冲。工具审批请求 id 在主进程加 `runId:` 前缀再发给渲染层，否则 Codex app-server 的进程内小整数 id 会串台。后台会话的审批不打断当前聊天：输入栏上方给「其它会话有 N 项待审批」，状态栏汇总。不要退回全局 `typing` / 单张 `toolPermission`。
- Agent 会话导出（v0.38.0）：顶栏「导出」把当前会话写成 Markdown（标题、双方正文、工具摘要），主进程 `agent:export-session` 弹保存对话框并写文件，渲染层不碰路径；纯生成器 `main/agent/export.ts` 不要塞进 handler。`WS_EXPORT_PATH` 是自动化测试缝（跳过对话框但仍走同一生成与写入），不得把内部 id、Token 或工作区密钥写进导出。
- Agent 会话重命名（v0.38.0）：会话行双击 / F2 / 悬停 `✎` 进入行内输入，Enter 保存、Esc 取消、失焦保存；空标题忽略，标题上限 80 字。复用 `agent:update-session` 的 `title` 补丁，store `renameAgentSession` 先更新内存再持久化，不新增 IPC；编辑期间行内渲染 `input.w1-sessrename`，不要嵌套 button。
- Agent 会话删除（v0.38.0）：只删应用内 `agent_sessions`（消息外键级联，`agent_runs` 保留为用量历史），不触碰外部 CLI 的 JSONL。顶栏「删除」两段确认（4 秒内第二次点击才执行），运行中禁用并由主进程 `agent:delete-session` 再拒绝；删除活跃会话后按列表顺序回选下一个，空则回空态。不要把删除做成单点即删，也不要在删除时清理工作区目录。
- Agent 会话置顶（v0.38.0，DB v32）：`agent_sessions.pinned` 只影响排序（置顶优先，其余按更新时间），不改变运行状态或消息。会话行悬停的 ☆/★ 走现有 `agent:update-session` 的 `pinned` 补丁；rail 与舰队共用 `lib/agent.ts` 的 `sortPinnedFirst()`（稳定排序），不要在组件里另写比较。取消置顶不删除会话。
- Agent 会话归档（v0.38.0，DB v33）：`archived` 只影响可见性，消息、工作区与运行历史都保留。归档入口在舰队控制台；rail 与会话搜索过滤归档项，舰队新增「已归档」筛选，归档行只保留「取消归档」。归档活跃会话后回选第一个未归档会话，空则回空态；运行中、排队或有待审批的会话禁止归档（主进程 `agent:update-session` 再拒绝运行中的归档）。不要在 rail 里增加第二套归档状态。
- Agent 会话分叉（v0.38.0）：助手消息悬停「分叉」，主进程 `agent:fork-session` 在事务里复制到此消息为止的消息到新会话，复制工作区但不复制 `resumeId`；模型上下文从新回合开始，不是 CLI 侧真分叉。新会话默认未置顶/未归档，标题加「· 分叉」；不要在渲染层自行复制消息或复用源会话的 resume id。
- Agent 会话搜索（v0.38.0）：会话栏 `SessionRail` 搜索框同时匹配标题与消息正文；主进程 `agent:search-sessions` 用 `LIKE` 查 `agent_sessions` + `agent_messages`，**必须转义 `% _ \`**，标题命中标记 `title`、正文命中返回 160 字片段并标记 `message`，最多 40 条。渲染层 160ms 防抖、Esc 清空、竞态用序号丢弃旧结果；无 preload 桥或请求失败时退回本地标题/元信息过滤，不能显示空结果。正文命中返回 `messageId`（标题命中为 null），点击结果走 `openAgentMessage(sessionId, messageId)`：切会话后由 AgentDock 按 `data-message-id` 滚动到消息并加 `.w1-msg-jump` 高亮 1.8 秒，跳转完成即清空 `agentJumpMessageId`。
- 全局搜索（v0.38.0）：命令面板 `Ctrl+K` 同时搜任务、笔记、Agent 会话与学习卡；命令命中优先，无命令命中时搜索置顶。任务走 `openTask()`（`taskJumpId` 由任务视图消费并展开详情），笔记走 `openNote()` 直接打开详情，学习卡走 `openLearningItem()`（清空筛选、展开卡片、滚入视野并高亮 1.8 秒），会话走 `openAgentMessage()`。远程笔记/会话搜索 160ms 防抖，归档会话不进入结果；不要再建一套跳转状态。
- Agent 消息操作与滚动（v0.37.0）：助手回复悬停显示「复制」，只复制正文，不复制工具输出；失败回复（`error` 且非导入）显示「重试」，`retryMessage()` 只把原用户提示重新排队、不重复写用户消息，同一会话有在途回合或排队提示时不重复入队；不得自动重试。线程只在用户原本贴底（96px 内）时跟随新内容或审批卡；读历史时不抢滚动，改为输入栏上方「当前会话有 1 项待审批 · 查看」，点击把 `.w1-perm` 滚入视野。
- 工作区与技能扩展（v0.26.0）：Agent 顶栏「文件」打开只读 `WorkspaceSheet`：主进程 `main/agent/workspace.ts` 递归列出工作区（跳过 `.git/node_modules/dist`，限 300 项 / 4 层），点击文件用 `readWorkspaceText()` 预览（拒绝越界、二进制与 >128 KB 文件）；「打开目录」只按会话 id 取数据库中已校验的工作区。Write/Edit/Patch 工具卡的路径汇总成「本回合产物」。Claude 插件支持本地导入（裸 `SKILL.md` 会自动包成 `.claude-plugin/plugin.json` + `skills/`，完整插件直接复制），只落在应用私有 `claude-plugins/local`；可查看源文件树、SKILL.md 预览与打开目录，本地插件移除只删私有目录。市场按安装量排序、显示热度、分批加载 48 个，并支持按名称排序。
- 预设与用量（v0.26.0，DB v25）：`agent_presets` 保存 name/agent/workspace；舰队控制台「存预设」取当前会话，「预设」区一键用相同工作区新建会话，可删除。`agent_runs` 由主进程在 `agent:send` 记录开始、在 onExit 记录成功/取消/成本/时长/轮次；舰队「用量」展示近 7 天汇总与每日运行柱，只统计应用内运行。
- 舰队控制台（v0.24.0）：`components/FleetSheet.tsx` 是应用内所有 Claude / Codex 会话的统一总览，入口有三处——左侧舰队区的「打开舰队控制台」、状态栏「舰队 N」、命令面板「打开舰队控制台」。页面按 Agent 分组，显示运行 / 待审批 / 空闲、工作区、消息数、排队中、当前标记与审批卡数量；可按状态筛选，一键打开会话、停止有 `runId` 的运行、直接新建 Claude / Codex 会话。它管理本应用启动或恢复的会话，并可从「导入本机」把外部 CLI 会话按 resume id 接入；不嵌入外部终端窗口。Esc 关闭并把焦点还给触发元素。
- 本机会话导入（v0.27.0 → v0.30.0）：`main/agent/discover.ts` 只读扫描 `~/.claude/projects` 与 `~/.codex/sessions` 的 JSONL，解析标题、工作区与 resume id；Claude 优先用 `summary`，其次第一条非 meta / 非 tool_result 的用户消息；Codex 取 `session_meta.payload.session_id|id` 与第一条用户 `response_item`，环境说明与 `# AGENTS.md` 不当标题。扫描只读 128 KB 头 / 240 行，跳过符号链接，最多 300 个文件、每个 Agent 60 条，并按 mtime 倒序；`WS_SESSION_SCAN_ROOT` 是自动化缝，用临时 home 替代真实用户目录。`main/agent/history.ts` 在导入时读取文件尾部 2 MB，提取最近 200 条用户/助手正文与工具卡：Claude `tool_use` / `tool_result` 配对回填状态，Codex `function_call` / `function_call_output` 同理；跳过 Claude thinking / tool_result 正文 / meta、Codex developer / environment_context，以及空白正文；工具输入只留压缩摘要，每条消息最多 20 个工具卡，不导入命令输出。消息 ID 固定为 `import-<agent>-<resumeId>-<序号>`，重复导入幂等。DB v26 给 `agent_messages` 加 `origin`（默认 `app`，导入为 `import`）；仓储 `importMessages()` 在事务内批量写入。`agent:import-session` 校验 agent、resume id、标题长度与工作区（必须存在的绝对目录），已存在同一 `agent + resumeId` 时复用会话并补历史，返回 `{ session, messages }`。导入只写数据库，不改外部配置；后续回合仍由原 CLI 续接，所以导入前要关闭外部窗口避免并发写入。渲染层 `importAgentSession()` 把历史映射进线程、选中并切到 Agent 视图；FleetSheet 已导入行显示「补历史」而不是禁用。UI 明示「只读扫描 · 导入前关闭外部窗口 · 历史只读」。
- 能力中心（v0.22.0 → v0.25.0，DB v24）：设置页「基础 / 能力中心」三块——Claude 插件、外部 MCP、内置工具。`agent_plugins` 只存应用私有插件索引；安装/更新/卸载用隔离的 `CLAUDE_CONFIG_DIR` 调 Claude CLI 的 `plugin marketplace / install / update / uninstall`，插件目录固定落在 `<data>/agent/claude-plugins/`，启动 Claude 时只通过 `--plugin-dir` 按会话加载，绝不写 `~/.claude`。官方市场不直接用 CLI 的完整 clone（本机网络会卡在 120 秒，且本地目录不能使用保留名 `claude-plugins-official`）：应用先做 `git clone --depth 1 --sparse` 到 `<data>/agent/claude-plugins/market-src`，把 manifest 改名 `wsfo-official` 后让 CLI 注册本地目录，界面仍显示「Claude 官方」；刷新市场时 `git fetch/reset` 后重列。真实网络验证到 315 个插件。Claude 启动参数现在始终带 `--setting-sources project` 与 `--strict-mcp-config`，用户级 settings 与全局 MCP 不进入会话。`mcp_servers` + `mcp_server_secrets` 保存自定义/内置目录的外部 Server，密钥用 `safeStorage` 加密、列表只回 key、启动时解密进临时 `--mcp-config`；新装默认停用未信任，带 hooks/MCP 的插件与所有外部 Server 启用前必须二次确认。DB v23 增加 `tools_json / last_test_at / last_error`，`McpServerService.test()` 通过 `main/capabilities/mcp-client.ts` 对 stdio / HTTP Server 做一次 `initialize + tools/list`（10 秒超时，stdio 命令经 `resolveCommand()` 解析 Windows `.cmd` 包装），只允许已信任 Server 测试，结果落库供界面显示工具清单；HTTP 失败按 401/403「凭据被拒绝」、404「端点不存在」、429「请求受限」、5xx「服务异常」等可读原因返回，并带上远端 `error_description` / `message`，错误体中的请求头凭据会抹掉；改配置会清空测试结果。测试结束用 `taskkill /T` 清理整棵子进程树，避免 npx / uvx 拉起的 Server 残留。真实 `npx @modelcontextprotocol/server-sequential-thinking` 已验证返回 `sequentialthinking`，且 probe 后无残留进程。DB v24 增加 `mcp_server_tools`：测试时同步工具名、描述与 `readOnlyHint`，每个工具可设 `allow|ask|deny`，默认 ask；Claude 启动时只把 allow 放进 `--allowedTools`、deny 放进 `--disallowedTools`，ask 在 Claude 会话经本机桥 `approval_request` 中继到审批卡（原生工具同样）。能力中心还提供环境自检（node/npx/uvx/git/claude/codex 的路径与版本，不自动安装）与 `mcpServers` JSON 导入导出；导出只保留 env/header key，不泄露值。内置目录目前 4 个（Memory / Sequential Thinking / Fetch / Time），更新检查走 npm / PyPI 版本查询；“内置工具”只列本地 11 个数据工具，不是 Claude / Codex CLI 自带工具，也不是本机安装的 stdio MCP。外部 MCP 按归属下发（v0.35.0，DB v28：`mcp_servers.targets` 取 `both|claude|codex`，默认 `both`；`runtimeServers('claude')`、`codexRuntime()`、`claudeToolPolicy()` 都按归属过滤，改归属不重置启用与信任，旧库升级后一律 `both`），进入 Claude 会话，并在激活 Codex Provider 时进入 app-server 会话（v0.28.0；继承 CLI 的 exec 不接）；不改 CC Switch、`~/.codex`、Claude Desktop。
- 公网带密钥远程 MCP（0.36.6 实测）：Context7 `https://mcp.context7.com/mcp` 用 `Authorization: Bearer ctx7sk…` 实测通过——应用内添加、信任并测试返回 `resolve-library-id` / `query-docs`；有效 Key 调用 `resolve-library-id` 返回真实库结果（`/reactjs/react.dev`），无效 Key 返回 “Invalid API key. Please check your API key.”。Key 只从本机临时文件读进进程，不写日志 / 审计 / 仓库，验证后删除。
- 远程 MCP OAuth（v0.38.0，DB v31）：认证方式存 `mcp_servers.auth`（`headers|oauth`），授权状态在 `mcp_oauth`。登录走 401 → `resource_metadata` → 受保护资源元数据 → 授权服务器元数据 → DCR → PKCE S256 → 回环回调（仅 `127.0.0.1` 的 43110–43119 + `/oauth/callback`）→ Token 交换；`state` 一次性、5 分钟超时。授权 / Token 端点只接受 https 或回环 http（`127.0.0.1` / `localhost`），本地 mock 全链路测试在 `oauth/e2e.test.ts`。Token / Client Secret 只用 `safeStorage` 加密落库，渲染层只拿状态；`runtimeServers()` 是 async，OAuth Server 注入 `Authorization: Bearer`，手写 Authorization 被忽略；刷新失败时跳过该 Server 并标记「登录已过期」，不阻塞整轮会话。日志、审计、命令行、配置文件都不得出现明文 Token；登录 / 退出只记 Server 名称。真实 Notion 浏览器授权待用户在场补测；401 发现、PRM、AS 元数据、DCR 与 S256 已网络探测。
- 存储位置（v0.36.0）：数据根目录从 `%APPDATA%\WorkStationForOne\location.json` 解析，优先级 `WS_DATA_DIR` > 位置文件 > 默认 APPDATA 目录。`location.json` 只存路径，不能放进数据库（库在根目录内会循环）。`DatabaseContext.layout` 是唯一路径来源，`data / agent / codex-home` 都从它派生，不要再各自拼 `dirname(database.file)`。设置页只写 `pending`，迁移在下次启动、开库之前执行：复制 → `PRAGMA integrity_check` 与表数量校验 → 落位 → 切指针 → 删旧根；任一步失败都回滚并继续用原目录。旧根只在等于 `previous` 时才删，删除失败不阻断启动。`WS_DATA_DIR` 保持「直接指向 data 目录」的既有语义，不要把它当根目录再套一层 `data/`，否则冒烟会读到另一份空库。
- 备份恢复（v0.38.0）：设置页「数据」列出快照（时间、大小、恢复前快照标记），恢复走两段确认；主进程先只读校验（`integrity_check`、版本不高于当前、必须有任务表），再用 `VACUUM INTO` 留一份 `-pre` 安全快照，然后写 `<dataDir>/restore.json`。真正的替换在下次启动开库之前：当前库改名留底 → 复制备份 → 开库校验并迁移 → 成功记 `applied`；失败自动换回原库并记 `failed`，不阻断启动。运行中不替换数据库；「立即重启」才调用 `app.relaunch`。`restore.json` 在 dataDir 而不是库里，`pre` 路径不暴露给渲染层；同一秒重复备份自动加 `-2` 后缀，避免 `VACUUM INTO` 目标已存在。
- 插件源与双 Agent（v0.36.0，DB v30）：`plugin_sources` 存官方与 Git 源；`agent_plugins` 主键是 `(agent, id)`，同一插件可在 Claude 与 Codex 各装一次，旧库升级后一律 `agent='claude'`、`source_id=''`。市场清单只认 `.claude-plugin/marketplace.json`——实测 Codex 0.166 也读这个格式，写成 `.codex-plugin/` 会报「不支持 manifest」。真实官方市场的 `source` 有三种形态：相对路径字符串 53 个、`{source:'url'}` 163 个、`{source:'git-subdir'}` 99 个；解析必须按形态分支，否则 315 个只剩 53 个。源服务用 `git clone --depth 1`，`shell:false`，地址白名单挡住空白与 shell 元字符，`GIT_TERMINAL_PROMPT=0` 防止私有仓库卡住；`source` 指向仓库外的清单直接拒绝。本地目录源只引用不复制，移除时不删用户目录。调用 CLI 前先 `mkdir` 配置目录：Codex 直接拒绝不存在的 `CODEX_HOME`。
- 官方源的注册限制（v0.36.0）：Claude 保留 `claude-plugins-official` 这个名字，只接受 `anthropics` 组织的 GitHub 源，先 clone 到本地再 `marketplace add <本地路径>` 会被拒。注册时 GitHub 地址转成 `owner/repo` 传给 Claude，Codex 仍用本地快照路径。
- 插件隔离（v0.36.0，实测确认，回归时照此复查）：
  - Claude 用 `--setting-sources project` + `--strict-mcp-config` + `--plugin-dir <应用私有目录>`。抓 `claude -p "" --output-format stream-json --verbose` 的第一条 `system/init` 事件，看 `skills` 字段：应当只有内置 skill 与 `插件名:skill名` 形式的应用私有 skill，不含 `~/.claude/skills` 里的任何名字。不要加 `--bare`——它会把内置 skill 一起清空（实测 18 → 0），并停用 hooks。
  - `--plugin-dir` 是**追加**语义（官方说明 "for this session only"），不屏蔽默认目录；隔离靠的是 `--setting-sources project`。升级 CLI 后必须重跑上面那条命令复查。
  - Codex 用 `CODEX_HOME=<应用私有 codex-home>`。skills 只从 `<CODEX_HOME>/skills` 与安装目录内置的 `.system` 读取，不跟随软链与目录联接，必须真实复制；`skills/config/write` 只改运行时状态、不落盘，不能用来持久注册。实测同步后 `skills/list` 从 34 增至 36 并包含该 skill。
  - 两组用户目录全程只读：`~/.claude/plugins`、`~/.codex/{config.toml,skills,plugins/cache}` 的数量与内容在验证前后必须一致。
- Codex 插件启停（v0.36.0）：Codex 没有 `plugin enable` 子命令，启用状态只存在私有 `config.toml` 的 `[plugins."name@market"] enabled`（官方配置参考同样定义该键）。改写只动目标行的 `enabled`，其它表与注释逐字保留；**写前必须断言路径在应用私有 `codex-home` 内**，用户自己的 `~/.codex/config.toml` 永不写入。断言在 `setCodexPluginEnabled` 内部完成（它要求传应用数据根），不要只靠调用方记得先校验。应用只用 `codex app-server --stdio`，从不调 `codex app-server daemon`（后者会起共享守护进程）。
- 本机导入（v0.36.0）：`local-scan.ts` 只读 `~/.claude/plugins/known_marketplaces.json`、`installed_plugins.json` 与 `~/.codex/config.toml` 的 `[marketplaces.*]` / `[plugins.*]` 表，`WS_PLUGIN_SCAN_ROOT` 是测试缝。扫描不打开写句柄，测试断言内容哈希不变；Codex 本地源的 `\\?\` 长路径前缀要去掉才能识别。导入复制快照到私有目录，一律停用未信任，已在库里的跳过。
- 启动更新检查（v0.36.0 → v0.36.3）：启动 6 秒后检查插件与内置目录 MCP，只产出候选列表并推 `capability:update-available`，不在启动时自动安装；用户在能力中心点「全部更新」才执行（`capability:updates-apply`）。离线、超时、源不可达静默跳过只写日志；同一时刻只跑一次；退出时清理定时器。版本比较按数字段（1.10.0 > 1.9.0），版本缺失或来源未信任的候选跳过。 执行时逐条分发并各自 try/catch：Claude 插件走 `plugin update`，内置 MCP 走 `applyUpdate`，Codex 没有 `plugin update`，先 `plugin marketplace upgrade` 刷新快照再 `plugin remove` + `plugin add name@market` 重装，启用中的插件重装后重新复制 skill。单条失败不回滚其它条目，失败项带原因留在横幅里；整批结果写一条 `capability.apply-updates` 审计。
- 自动化测试用 `WS_DISABLE_CAPTURE_SHORTCUT=1` 跳过全局捕获快捷键，避免和 Cherry Studio 抢 `Ctrl+Alt+Space`；不要为此关闭用户的应用。Agent 冒烟必须继续指向 `scripts/stub-agent.cjs` 与 `scripts/stub-codex.cjs`，绝不能调用真实 Claude/Codex。
- 种子数据由 `data/mock.ts` 的 `createInitialData()` 从 `data/seed/*` 组合。测试用它重置 Zustand；必须返回全新对象，并保持这个门面是唯一入口。
- CSS 入口是 `styles/index.css`，按顺序导入各分节。新规则加到对应分节并保持导入顺序；层叠顺序是有意设计的。类名按「域前缀」取：`w1-` 全局外壳、`w1-todo*` 任务、`w1-n*` 笔记、`w1-l*` 学习。**改前先在整个工作区 grep 一遍**——后导入的分节会静默覆盖同名规则，学习卡行曾与导航启动器共用 `.w1-lrow`，把「Qoder / DeepSeek Harness」压成 14px 只显示省略号；现在学习卡行是 `.w1-litemrow`，冒烟有「外部启动器名称有宽度」兜底。`.w1-caprow` 也踩过同样的坑：任务视图的今日容量行与能力中心列表行同名，能力中心的 3 列 grid 把容量条压成 30px、按钮竖排；现在能力中心规则限定在 `.w1-caplist` 内。`.w1-cap` 同样撞过：容量条根节点与能力中心根节点同名，后导入的 `flex: none` 抹掉了容量条的 `flex: 1`；现在容量条是 `.w1-capbar`。`.w1-settings-sheet.wide` 也曾在 19-capability.css 里被写成 860px，静默覆盖 10-overlays 的 1040px——设置样式现在统一在 `22-settings.css`，不要再从其它分节覆盖它。
- 格式与 lint 统一走 Biome（`biome.json`，Rust 单二进制）。不要引入 Prettier / ESLint。配置里关掉的规则都是与项目设计冲突的：`<i>//</i>` 是终端风格装饰而非注释、带 `role` 的 div 是虚拟列表容器、无障碍降级必须用 `!important` 压过后导入的分节、跨分节特异性倒置是导入顺序的结果。新增例外优先写 `// biome-ignore <rule>: 原因`，不要全局关规则。
- main 与 preload 以 CJS 构建（没有 `"type": "module"`）。未验证 Electron preload 与 sandbox 行为前，不要切换模块格式。
- Vitest 覆盖 `src/**/*.test.ts` 与 `scripts/**/*.test.mjs`，运行在 Node 环境。添加 `.tsx` 测试前，先有意识地配置 DOM/组件测试环境。

## UI 契约

- 中文优先文案。保持 B‴ 极光 HUD：玻璃卡片、渐变/辉光、直角、终端式元素。默认夜间，支持白天模式；白天同样使用极光玻璃语言，不得退化为通用极简 UI。
- 外壳固定为「左侧主导航 + 单个全宽工作区」：今日 / 任务 / Agent / 笔记 / 学习互斥渲染，不得恢复常驻右栏或让看板与 Agent 同屏。Agent 视图内部才是「会话列表 + 聊天区」两栏，任务视图内部是「清单栏 + 任务列表」两栏，学习视图内部是「科目栏 + 卡片列表」两栏。
- 今日卡只展示今天与逾期任务；任务全量管理放在「任务」工作区。不要恢复今日卡显示所有任务，也不要给任务另建一套数据源。今日任务卡标题栏的「快速添加」必须复用 `composeTask()`（切视图 + 聚焦现有 QuickAdd），不要另建输入框或第二套提交逻辑。今日卡末尾是「完成记录」热力图：只统计带 `completedAt` 的已完成任务，按本地日期归入近 26 周（周一起始）的格子，未来日期留空（`lib/heatmap.ts`）。
- 任务视图：容量条只统计 `planned_for = 今天` 且未完成的任务，可用时间按 09:00–22:00 窗口扣掉当前时刻计算（`lib/capacity.ts`）；「计划今天」面板只做计划/取消计划，时长在任务详情里设置；「排程预览」按截止日期 → 优先级贪心排入 09:00–22:00 空档、15 分钟对齐，已有时间的任务作为锚点，结果先预览再「接受全部」（`lib/planner.ts`）。
- 任务周视图（v0.38.0）：「周视图」切换为周一起始的 7 列，按 `plannedFor ?? dueDate` 归组，拖拽写 `plannedFor`；规则在 `lib/week.ts`，子任务不进入，空列可放置。顶部「未排期」条收没有日期的未完成顶层任务，同样可拖入某天；拖拽后 toast 提供「撤销」写回原计划日期。切周视图时统一到「全部任务」并显示「本周」标题；点周卡片切回列表并走 `openTask()` 展开详情。不要在组件里另算周起点或分组。
- 任务视图：智能清单（收集箱 / 今天 / 即将到来 / 全部 / 已完成）与自定义清单都来自同一 `tasks` 数组；新增或删除任务必须同步 SQLite。快速添加的 Enter、`Ctrl+Shift+N` 聚焦、Esc 收起详情、搜索 Esc 清空、中文输入法组合期间不提交是既有契约。详情关闭后焦点回到行标题；日期支持今天/明天/清除快捷按钮。权限卡里的任务顺延可携带 `toDueDate`，允许后必须同时更新截止日期，不能只改时间与标签。任务行支持拖拽改期：拖到智能清单/自定义清单改截止日期或清单，拖到今日时间轴写入时间（15 分钟对齐，规则在 `lib/dnd.ts`）；拖拽只是鼠标增强，键盘用户仍走详情编辑。
- 习惯连续天数：`lib/habits.ts` 的 `currentStreak()` 在今天就打卡时从今天数，否则从昨天数——一天还没过完就清零，会逼人提前打卡保数字；`bestStreak()` 用于对比历史最好值。两条都是纯函数，组件只负责展示。
- MCP 数据桥（v0.15.0）：`src/main/mcp/server.ts` 在 Main 进程内嵌 Streamable HTTP JSON-RPC（`initialize / tools/list / tools/call`），只监听 `127.0.0.1` 随机端口，Bearer Token 按 Agent 回合发放并在回合结束时回收。11 个工具：5 个只读（`tasks_list / notes_search / learning_due / habits_summary / today_overview`）+ 6 个写入（`tasks_create / tasks_update / tasks_complete / habits_check / learning_review / notes_create`）。写入必须带 `idempotency_key`，同一会话重复键返回首次结果；每次调用写 `audit_log`（domain `mcp`, action `read|write|approve|deny`, target 会话 id，detail 只存参数摘要，不存 token）；写入与 `mcp/write` 审计在同一个可嵌套事务里，严格审计失败会回滚业务写入。工具名 `mcp__workstationforone__*` 进入 Claude 的允许列表；不改 Claude/Codex 用户的 MCP 配置。Codex MCP（0.20.x）：激活 Codex Provider 时，主进程为每回合向本地桥发放 Token，并在应用自己的 `codex-home/config.toml` 写入 `[mcp_servers.workstationforone]` 的 `url` 与 `bearer_token_env_var = "WS_CODEX_MCP_TOKEN"`；Token 只在 app-server 子进程环境，不落配置/日志/命令行，`shell_environment_policy` 同时剔除 Provider 与 MCP Token。Codex 的 MCP 工具调用通过 `mcpServer/elicitation/request`（`_meta.codex_approval_kind="mcp_tool_call"`）到达；本地桥的只读工具直接回 `accept`（仍写 `mcp/read` 审计），写入工具进入同一张工具审批卡，允许回 `{action:"accept",content:{}}`，拒绝回 decline。四域权限与审计仍由本地桥负责；Codex MCP 只在 app-server 路径启用，exec 只读路径不接 MCP。`WS_AGENT_CLI` 的 stub 会读临时配置并真实调用桥，冒烟断言读、写、任务刷新与审计。服务异常关闭后在同一端口指数退避重启，token 与幂等缓存保留；重启期间新回合拿不到端点，已有回合的调用可能失败，重启后重试即可。真实 DeepSeek 已验证 `today_overview` 读与 `tasks_create` 写及 audit read/write。
- MCP 按域权限（DB v19）：`mcp_domain_modes` 存 task / habit / learning / note 四域的 `read|ask|write`，默认任务可写、其余只读；设置页可切换，切换写 `system/settings` 审计。只读域直接返回 `denied_by_policy`；询问模式由 `main/mcp/permissions.ts` 串行排队，一次只展示一张审批卡，60 秒超时 / 回合取消 / 窗口不可用都按拒绝处理，决定写 `approve|deny` 审计；「本会话允许」只记住会话 + 当前工具。写入成功后主进程广播 `mcp:changed`，App 按域重新读库。
- 审计查看：设置页「活动记录」通过 `audit:recent` 只读展示最近记录，可按域筛选；没有删除入口。`audit_log` 仍挂在仓储层；`runMcpTool` 只记读取，MCP 写入的 `mcp/write` 由 server 在业务事务内 `recordStrict`，拒绝写入由 server 记录。
- 设置与状态：状态栏显示「MCP 桥」，点击只提示能力范围；没有 MCP 总开关。首次启动失败只记 console、不阻断应用启动（之后的重启由 server 自身负责）；没有崩溃后的 UI 状态提示。
- 审计：`audit_log`（DB v11，domain/action/target/title/source/detail）**挂在仓储层**而不是各个 IPC handler——MCP 或定时任务只要走仓储就一定留痕。普通审计写入失败只记 console，不让业务写入回滚；MCP 写入使用 `recordStrict`，审计失败会回滚业务写入。设置页的活动记录与 MCP 调用读同一张表。
- 子任务：`tasks.parent_id`（DB v10）。子任务**不进入任何清单、计数、排程与「只做三件事」**——所有聚合函数用 `lib/subtasks.ts` 的 `topLevel()` 先过滤；它们只在父任务详情里出现，行上显示 `1/2` 进度。删除父任务时在同一事务里连带软删子任务，避免留下看不见也删不掉的孤儿。
- 设置面板由左侧导航的「设置」与命令面板打开：外观（主题/皮肤/动效）、Agent Provider、MCP 域权限、审批规则、活动记录、数据（库目录、备份份数与目录、立即备份）、版本。数据路径来自 `app:info`，不要在渲染层拼路径。退出时 `before-quit` 必须先停 MCP 桥与提醒轮询再关库。设置面板宽 820px（能力中心 wide 1040px）；Provider 表单输入框 13.5px / 高 36px、字段标签 12.5px、目标卡名称 13.5px，设置分区标题 13px。不要退回 10.5–12px 的密集排版；装饰性微标签（`// CONNECTION BUS`、状态徽标）保持小字号。截图检查在 1440×900 与 1180×720 下做。
- 可读性阶梯（v0.36.7 → 0.36.8）：设置页 Provider 表单、任务详情与 Agent 审批卡属于「要读 / 要写」区域——正文与输入 13.5–14px、字段标签 11.5–12.5px、操作按钮 12–13.5px；任务详情侧栏 200px（1180 断点 174px），四档「重复」保持一行。`// CONNECTION BUS`、状态徽标、任务行元信息等装饰性终端标签保持 9–11px，不要一起放大。改这些区域时在 1440×900 与 1180×720 下截图。
- 到点提醒：主进程 `main/reminders.ts` 每 20 秒轮询数据库（不是给每条任务排定时器——任务随时会改时间/删除/完成，轮询让「当前真相」只有一个来源），命中「今天到期 + 正好到点 + 今天没提醒过」就发系统通知；错过的那一分钟不补发，避免打开应用被历史提醒刷屏。`WS_REMINDER_TICK_MS` / `WS_REMINDER_LOG` 是自动化测试缝。**退出阶段数据库已关闭，轮询必须跳过并兜底 try/catch**，否则 setInterval 抛错会弹出原生错误窗把验证挂死（踩过一次）。
- 提醒中心（v0.38.0）：状态栏「提醒」与命令面板入口；`lib/reminder-center.ts` 从任务派生今天「已错过 / 稍后」，点击走 `openTask()` 展开任务详情，行内可直接「完成」或「+10 分」延后。延后写回任务时间；`reminderKey` 带时间，主进程会在新时间再次提醒。只读派生、不新增提醒表、不补发系统通知；秒级倒计时不要放进主进程轮询。
- 重复任务：`tasks.repeat` 存 `daily|weekly|monthly`（DB v9），规则在 `shared/repeat.ts` 的 `nextDueDate()`——以**本次到期日**为基准推进（不是完成日，晚了几天完成也不会把节奏拖偏），每月遇到当月没有的日期就收敛到月末（1/31 → 2/28）。完成时由主进程 `completeTask()` 在**同一事务**内落完成态并插入下一实例，绝不拆成两次调用。
- 任务视图的「只做三件事」开关：从**全部未完成**任务里按「逾期 → 今天到期 → 计划今天 → 高优先级 → 其它」分档挑三条（`lib/focus.ts` 的 `topThree()`），同档内按截止日期 → 优先级 → 创建时间 → id 排序，保证同样数据得到同样名单；完成一件自动补位，退出后恢复原清单。分档而不是打总分，是为了让「为什么是这三件」说得清。
- 过期任务标记：`lib/todo.ts` 的 `staleDays()` / `isStale()` 按自然日算创建至今天数，默认阈值 14 天，已完成任务永不标记；没有 `createdAt` 的旧数据不标（不要用迁移伪造创建时间）。界面只读展示「N 天未动」，不参与排序。
- 清单重命名走单条 `UPDATE tasks SET list = ? WHERE list = ?`（`tasks:rename-list`），不要逐条 `updateTask`；校验在 `lib/todo.ts` 的 `listNameError()`：空名、超 80 字、与其它清单重名都拦下（重名等于静默合并两个清单）。入口是清单行的 `✎` 或该行按 `F2`，`Enter` 提交、`Esc` 取消。
- 新增应用入口加到 `WorkspaceNav` 的 `VIEWS`，并为其提供独立工作区与导航命令；不要挤进顶栏或状态栏。视图切换用 `aria-current="page"` 标记当前项。
- 笔记是独立全宽工作区，不是弹窗；搜索框内有查询时 Esc 清空搜索，不关闭笔记页。Agent 与笔记的滚动容器各自独立，切换视图后保持原外壳尺寸。
- 笔记行是 `<button>`（`.w1-nvrowbtn`），点开的是**弹层详情**而不是行内展开：全部笔记页用固定行高虚拟滚动，行内展开会让 `ROW_HEIGHT` 与真实高度脱节、整片列表错位。详情里改正文/标签、二次确认删除、转成学习卡。
- 笔记写入必须先落库再 bump `noteRevision`：`updateNote` / `removeNote` 先改内存副本让面板立刻反映，等 IPC 成功才递增 revision。反过来的话笔记页会抢在落库前重读数据库，读回旧正文（冒烟「笔记编辑后列表同步」就是抓这个的）。删除失败（主进程返回 `false`）要把那一行放回去。
- 挖空卡：`shared/cloze.ts` 解析 `{{c1::答案}}`，`parseCloze` 同时给出答案区间（`start`/`end`，用于高亮）与整段标记区间（`markerStart`/`markerEnd`，用于正面替换成 `[1]`）。正面由 `clozeFrontText()` 推导并存进 `title`，**改原文必须同步重算正面**（主进程校验与 store 各做一次），否则库里的标题和复习时看到的不一致。`learning_items` 的 `kind` / `cloze_source` / `note_id` 来自 DB v12，普通卡保持默认值、历史数据不改写。
- 笔记转卡走 `lib/note-card.ts` 的 `noteToCard()`：按第一句拆成问句正面、全段作背面；只有一句时退化成自述卡（正面截 40 字）。不要把整段同时塞进 title 和 notes——那样翻面等于什么都没问。
- 笔记双链：`shared/note-links.ts` 定义 `[[笔记首行]]` 的解析与命名规则，保存笔记时在**同一事务**内重写 `note_links`（DB v13）。重名标题与找不到的目标都不建边，链接同时存 `target_id` 与标题快照，所以目标改首行后旧链接仍指向它；`notes.titles` 只补全唯一命中。不要在渲染层另存链接或引入图数据库。
- 表单里的日期、时间与带建议的单行字段一律用 `components/fields/` 的自建控件（`DatePicker` / `TimePicker` / `ComboSelect`），不要退回 `input[type=date|time]` 或 `datalist`：这些由系统绘制，CSS 盖不住，会露出生硬的白色弹层。三者共用 `Popover`（portal 到 `.w1` 根节点，因为 `.w1-view` 带 transform），弹层是「不透明玻璃 + 1px 棱镜边」，`.w1-pop` 已加进 `11-motion.css` 与无障碍/浅色/经典皮肤的白名单。日历网格与时间刻度规则在 `lib/pickers.ts`，改动先改那里的测试。弹层按 Esc 只关自己（`stopImmediatePropagation`）并把焦点还给触发按钮。
- 学习视图内部两态：卡片库（默认，科目栏 + 卡片列表）与复习态（占满整块舞台，`.w1-learn.review` 覆盖两栏 grid）。到期口径固定为 `active` 且 `nextReviewOn <= 今天`，排序与时长在 `lib/learning.ts`，组件不要自行比较日期；复习卡进入时对队列做一次快照，评分 1 的卡排到本场队尾但库里的 `next_review_on` 仍是今天。复习卡翻面用 `Space` / 点击，评分用 `1`–`4`，Esc 退出。
- 学习调度只走 `shared/srs.ts` 的 `scheduleReview()`：主进程落库、复习评分按钮的间隔预览、无桥时的 store 回退都用同一个纯函数，不要在组件里复制公式。DB 里 `stability/difficulty` 为空表示旧卡，首次评分才建立 FSRS 状态；迁移不得回填伪造的记忆状态。
- 学习统计：`renderer/src/lib/learning-stats.ts` 是纯函数（未来 7 天分桶、逾期归今天、FSRS 保持率、21 天成熟阈值、14 天复习历史与评分分布），弹层直接读 `learningItems` 与只读的 `learning.reviewHistory(days)`，不要在主进程另算一份。保持率只统计有 `stability + lastReviewOn` 的启用卡，新卡不能按 0% 计入；评分分布的时间窗与 14 天柱必须共用同一个本地日期过滤。
- 学习卡 CSV：解析与序列化在 `shared/learning-csv.ts`（UTF-8 BOM、引号 / 逗号 / 换行、挖空从原文推导正面），上限 2MB / 1000 张。导入按 `科目 + 正面` 去重，一律作为今天到期的新卡、不携带 FSRS 状态；主进程 `createMany` 单事务写入。导出只包含启用卡，是内容交换而不是数据库备份。
- MEM 内容：`shared/mem-starters.ts` 同时供渲染层空库种子与 DB v15 迁移使用。v15 只在**已有学习数据**的库补 8 张管综卡（`WHERE EXISTS`），空库必须交给首次种子，否则只会写进 8 张、丢掉 16 张英语二；迁移不得删除历史「互联网」卡。
- 学习复习卡 3D 翻面（v0.38.0）：`.w1-lcard` 只做 `perspective`，旋转在 `.w1-lcardinner`（`preserve-3d`），玻璃底也在内层；两个 `.w1-lface` 用 `backface-visibility` 隐藏背面。**不要在 3D 子树里加 opacity 动画、`filter` 或 `backdrop-filter`**——会把 `preserve-3d` 压平，出现镜像正面或整张空白；毛玻璃放在不参与 3D 的 `.w1-lcard::before`。翻面时 `.w1-lsheen` 扫光，评级区由 `.w1-lcard.flipped + .w1-lratings` 点亮。改这里要在 review 态截正面 / 翻面 / 背面。
- 复习卡是 `<button>`，必须显式 `background-color: transparent`（UA 的 `buttonface` 会从玻璃层后透出灰块），并把 `.w1-lcard` 加进 `11-motion.css` 定义 `--glass-rim` 的选择器白名单，否则棱镜描边不生效。大块玻璃面要自带 `::before` 光场，否则整片压成实色。
- 今日看板末尾的学习卡与学习视图共用 `learningItems`：到期数与时长来自同一组纯函数，不得另建数据源；`开始复习` 走 store 的 `startLearningReview()`，同时切视图与进复习态。
- 首屏读库前不要先渲染空态：任务 / 笔记 / Agent 会话 / 学习卡在各自的 `tasksReady`、`notesReady`、`sessionsReady`、`learningReady` 未结束前用 `components/StatePlaceholder.tsx` 的骨架占位，否则会先闪一下「还没有…」。这些标记在成功、失败、无 preload 桥三种路径都必须置 `true`：卡在骨架比显示内存数据更糟，浏览器调试与 `capture` 都没有桥。
- 动效统一使用 `--ease-*` / `--dur-*`（`styles/sections/00-base.css`）与 `src/renderer/src/lib/motion.ts`；列表重排走 `withViewTransition`（`lib/view-transition.ts`），系统减少动效或 `motion-off` 时自动退回同步更新，不要绕过它直接调 `startViewTransition`；高频键盘动作保持即时，hover 位移在粗指针设备下关闭，可点击控件使用统一的 `:active` 缩放反馈。
- 通用入场动效（v0.38.0）：列表行用 `.w1-item-in`（学习 / 能力中心 / MCP 工具 / 舰队行），设置分区用 `.w1-setpane` 的 `w1-pane-in`，统计柱用 `w1-bar-grow`（`transform-origin: bottom`），复习卡换卡用 `.w1-lcardslot` 的 `w1-next-card`，热力图列用 `w1-heat-in`（按周 12ms 错峰），空态用 `w1-empty-in`，主操作按钮悬停扫光 `w1-btn-sheen`。今日卡已有 `.w1.is-booted .w1-bento > .w1-card` 的 `cardIn` 错峰入场，不要再叠加。**高频键盘入口（命令面板、快捷键）保持即时，不加动画**；新动效必须能被 `prefers-reduced-motion` 与 `.motion-off` 的全局规则关掉。
- 颜色一律走令牌：半透明色用 `rgb(var(--*-rgb) / α)`，不要在组件里写死 `rgba()` 或深浅主题分支；浅色覆盖集中在 `styles/sections/14-theme.css`。
- 主题状态在 `lib/theme.ts`：读取/写入 `localStorage`、应用 `<html data-theme>`，并通过 `window.ws.app.setTheme` 同步窗口背景与标题栏。`src/renderer/public/theme-init.js` 在样式表之前同步写入 `data-theme`，避免重载/可见窗口的首帧闪色；它重复了存储键 `workstation.theme`，改键时两处一起改。新增主题相关逻辑复用这些函数。
- 动效是预期要求，使用 `motion/react`（`m` + `LazyMotion`、`domAnimation`）。尊重 `prefers-reduced-motion` 与 `motion-off` 开关。
- 未经明确同意，不得将视觉系统替换为通用/极简 UI，也不得引入 UI 组件库。
- 布局以 1440×900 为目标，且必须在 1180×720 下可用。两种尺寸都要检查。

## 验证

- 代码改动：运行 `npm run typecheck`、`npm run check` 与 `npm test`。
- UI 或布局改动：还要运行 `npm run smoke`，并在 1440×900 与 1180×720 下截图，覆盖 `today|tasks|agent|notes|learning` 五视图。渲染进程控制台报错即视为失败。
- 主题改动：暗色与白天各截一套（`dark` / `light` 参数），检查两套的对比度、玻璃质感与横向/纵向溢出；双主题 × 双尺寸 × 五视图共 20 套。变体截图脚本会通过 `localStorage` 固定主题后重载，避免主题残留互相污染。
- 外壳或导航改动：运行 `npm run verify`（`scripts/runtime-verify.mjs`），确认五视图互斥、`aria-current`、无页面横向溢出、命令面板跳转、双主题持久化与任务跨重启持久化仍通过。

## 当前状态

已实现 / 未实现清单与最近验证结论见 `docs/status.md`；它是一份快照，改动功能后同步更新。

## 知识库取用规则

做界面设计前，先查知识库，不要凭空发挥：
1. 入口：`E:\1.工作相关内容\★陈叫叫个人知识库\1-开发技术\前端\美观设计\README.md`
2. 先按「按任务找」表定位到 1 篇最贴近的笔记，只读这一篇，不要整目录通读。
3. 需要成体系时按「按颗粒度拼装」取用：基础定规则 → 页面定整屏 → 组件定手感 → 模式定反馈。
4. 「案例」目录是外部参考：抄手法，不抄色值和尺寸。
5. 知识库里没有的再自己设计；做完把可复用部分按「知识库采集规则」回写。

## 知识库采集规则

当本项目出现值得沉淀的内容（用户确认的设计理念、精巧方案、重要踩坑）：
1. 在 `E:\1.工作相关内容\★陈叫叫个人知识库\0-收件箱\` 新建 md 文件，文件名 = 主题短语。
2. 内容只写三段：来源（项目名 + 日期）、场景、想法（完整描述，含关键代码）。
3. 不要自己分类，不要写到收件箱以外的目录，不要修改知识库其他文件。
4. 涉及密钥、客户名、生产配置的内容必须脱敏。
5. 没有写入权限时，按同样三段结构输出到对话里，由用户转交知识库。
