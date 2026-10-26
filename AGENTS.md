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
- `npm run smoke` — 先构建，再运行 UI 交互冒烟测试套件。
- `npm run capture -- .screenshots/shell-1440.png 1440 900 .screenshots/audit-1440.json` — 构建、保存截图并写入布局审计。
- `npm run capture -- .screenshots/shell-1180.png 1180 720 .screenshots/audit-1180.json dark` — 在最小窗口尺寸下做同样的检查；主题参数为 `dark|light`，视图参数为 `today|tasks|agent|notes`，均可省略审计路径后按任意顺序追加（如 `... 1440 900 light tasks`）。
- `npm run capture -- .screenshots/tasks-1180.png 1180 720 dark tasks` — 只截某个视图并省略审计路径。
- `npm run icon` — 从 `resources/icon.svg` 与 `resources/icon-small.svg` 重新生成 `resources/icon.png` 和多尺寸 `resources/icon.ico`。

始终通过上述封装脚本启动 Electron。本环境可能设置 `ELECTRON_RUN_AS_NODE=1`；封装脚本会清除它并正确解析 electron-vite CLI。直接调用 `electron` 或 `electron-vite` 可能失败。应用是单实例的：启动新窗口前先关闭已有窗口。

## 安全与进程边界

- 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。渲染进程没有 Node、数据库或文件系统访问权；需要时扩展窄接口的类型化 preload 桥。
- 禁止添加或默认启用 `--dangerously-skip-permissions` 或 `--dangerously-bypass-approvals-and-sandbox`。Codex 默认策略为 `on-request` + `workspace-write`。
- 本地 MCP 服务器实现时只绑定 `127.0.0.1`，使用随机端口和按会话生成的 Bearer Token。Token 不得进入日志、审计记录、命令行参数或仓库文件。
- 不存储 API Key；继承现有 CLI 登录状态。
- v1 坚持本地优先：不添加云同步、遥测或托管服务。
- 不要自动重试可能产生副作用的回合。重试必须是用户显式操作。
- 不请求或渲染隐藏思维链。展示工具调用、输出与权限请求。
- 禁止提交密钥或个人配置。

## 架构与约定

- `src/main` 是唯一允许持有数据库、子进程、MCP 服务器、权限与审计的进程。`src/preload` 暴露窄的类型化桥。`src/renderer` 只负责 UI。
- 保持模块有深度：把纯规则放进小接口并测试（`lib/schedule.ts`、`lib/agent.ts`、`lib/todo.ts`、`lib/todo-parser.ts`、`shared/date-key.ts`）。组件只做编排，不重复业务规则。
- 任务日期一律用本地日期键 `YYYY-MM-DD`（`shared/date-key.ts`），不要用 `Date` 对象或 UTC 字符串存库；今天/逾期/即将到来的口径集中在 `lib/todo.ts`，组件不要自行比较日期。
- 任务快速添加语法解析在 `lib/todo-parser.ts`，只做确定性规则，不接模型。新增语法先写解析测试。
- 中文里「一点 / 两点」更常是量词（有一点问题、两点意见）：无时段前缀时不得当作钟点，带「下午 / 凌晨」等前缀才识别。截止语「前 / 之前 / 以前」并入日期，但不能吞掉「前台」「前面」，改动时保留这些边界测试。
- Agent UI 位于 `components/agent/`；Agent 身份、CLI 预览与演示回复位于 `lib/agent.ts`。在真实 SDK 适配器落地前，`demoReply()` 是固定假数据；不得当作真实 Agent 输出展示。
- 会话状态按 session ID 限定作用域：`threads` 以它为键，`pendingReplyTo` / `permission.sessionId` 用于选择当前会话。新增会话或审批流程时保持这一约定。
- 种子数据由 `data/mock.ts` 的 `createInitialData()` 从 `data/seed/*` 组合。测试用它重置 Zustand；必须返回全新对象，并保持这个门面是唯一入口。
- CSS 入口是 `styles/index.css`，按顺序导入各分节。新规则加到对应分节并保持导入顺序；层叠顺序是有意设计的。
- main 与 preload 以 CJS 构建（没有 `"type": "module"`）。未验证 Electron preload 与 sandbox 行为前，不要切换模块格式。
- Vitest 覆盖 `src/**/*.test.ts` 与 `scripts/**/*.test.mjs`，运行在 Node 环境。添加 `.tsx` 测试前，先有意识地配置 DOM/组件测试环境。

## UI 契约

- 中文优先文案。保持 B‴ 极光 HUD：玻璃卡片、渐变/辉光、直角、终端式元素。默认夜间，支持白天模式；白天同样使用极光玻璃语言，不得退化为通用极简 UI。
- 外壳固定为「左侧主导航 + 单个全宽工作区」：今日 / 任务 / Agent / 笔记互斥渲染，不得恢复常驻右栏或让看板与 Agent 同屏。Agent 视图内部才是「会话列表 + 聊天区」两栏，任务视图内部是「清单栏 + 任务列表」两栏。
- 今日卡只展示今天与逾期任务；任务全量管理放在「任务」工作区。不要恢复今日卡显示所有任务，也不要给任务另建一套数据源。
- 任务视图：智能清单（收集箱 / 今天 / 即将到来 / 全部 / 已完成）与自定义清单都来自同一 `tasks` 数组；新增或删除任务必须同步 SQLite。快速添加的 Enter、`Ctrl+Shift+N` 聚焦、Esc 收起详情、搜索 Esc 清空、中文输入法组合期间不提交是既有契约。详情关闭后焦点回到行标题；日期支持今天/明天/清除快捷按钮。权限卡里的任务顺延可携带 `toDueDate`，允许后必须同时更新截止日期，不能只改时间与标签。
- 新增应用入口加到 `WorkspaceNav` 的 `VIEWS`，并为其提供独立工作区与导航命令；不要挤进顶栏或状态栏。视图切换用 `aria-current="page"` 标记当前项。
- 笔记是独立全宽工作区，不是弹窗；搜索框内有查询时 Esc 清空搜索，不关闭笔记页。Agent 与笔记的滚动容器各自独立，切换视图后保持原外壳尺寸。
- 动效统一使用 `--ease-*` / `--dur-*`（`styles/sections/00-base.css`）与 `src/renderer/src/lib/motion.ts`；高频键盘动作保持即时，hover 位移在粗指针设备下关闭，可点击控件使用统一的 `:active` 缩放反馈。
- 颜色一律走令牌：半透明色用 `rgb(var(--*-rgb) / α)`，不要在组件里写死 `rgba()` 或深浅主题分支；浅色覆盖集中在 `styles/sections/14-theme.css`。
- 主题状态在 `lib/theme.ts`：读取/写入 `localStorage`、应用 `<html data-theme>`，并通过 `window.ws.app.setTheme` 同步窗口背景与标题栏。`src/renderer/public/theme-init.js` 在样式表之前同步写入 `data-theme`，避免重载/可见窗口的首帧闪色；它重复了存储键 `workstation.theme`，改键时两处一起改。新增主题相关逻辑复用这些函数。
- 动效是预期要求，使用 `motion/react`（`m` + `LazyMotion`、`domAnimation`）。尊重 `prefers-reduced-motion` 与 `motion-off` 开关。
- 未经明确同意，不得将视觉系统替换为通用/极简 UI，也不得引入 UI 组件库。
- 布局以 1440×900 为目标，且必须在 1180×720 下可用。两种尺寸都要检查。

## 验证

- 代码改动：运行 `npm run typecheck` 与 `npm test`。
- UI 或布局改动：还要运行 `npm run smoke`，并在 1440×900 与 1180×720 下截图，覆盖 `today|tasks|agent|notes` 四视图。渲染进程控制台报错即视为失败。
- 主题改动：暗色与白天各截一套（`dark` / `light` 参数），检查两套的对比度、玻璃质感与横向/纵向溢出；双主题 × 双尺寸 × 四视图共 16 套。变体截图脚本会通过 `localStorage` 固定主题后重载，避免主题残留互相污染。
- 外壳或导航改动：运行 `.screenshots/runtime-verify.mjs`，确认四视图互斥、`aria-current`、无页面横向溢出、命令面板跳转、双主题持久化与任务跨重启持久化仍通过。

## 当前状态

- 已实现：任务域与笔记域 SQLite 持久化（`src/main/db/`，Electron 内置 `node:sqlite`，WAL + `PRAGMA user_version` 前向迁移），类型化 preload 桥 `window.ws`，勾选与权限变更结果落库，启动时以数据库内容覆盖种子数据。
- 已实现：任务工作区与完整任务字段。`tasks` 迁移到 v4：v3 新增 `notes / due_date / priority / list`，v4 新增 `deleted_at` 做软删（删除保留 30 天后清理，撤销只需清空该列）；仓库支持 `create / update / remove / restore`；今日卡只含今天与逾期；快速添加、去向提示、清单派生、搜索（Esc 清空）、行内详情、快捷日期、焦点归位和 `Ctrl+Shift+N` 已接入。权限卡顺延会同步截止日期；笔记总数独立保存在 `noteTotal`，导航与上下文用量使用数据库总数而非预览条数。
- 已实现：夜间/白天双主题（默认夜间），状态栏与命令面板可切换；主题写入 `localStorage`，启动首帧前应用，并通过 `app:set-theme` 窄 IPC 同步窗口背景与标题栏配色。
- 已实现：外壳「左侧主导航 + 单个全宽工作区」。今日（模块流）、任务（清单栏 + 任务列表）、Agent（会话栏 + 聊天区）、笔记（全宽工作区）互斥渲染；左侧导航同时承载舰队总览、外部启动器与设置；命令面板可直接跳转视图或新建任务。
- 笔记搜索：FTS5 `trigram` 分词（`unicode61` 无法检索中文）；**查询少于 3 字符时自动回退 `LIKE`**，写查询前请先看 `src/main/db/notes.ts` 的 `planSearch`。
- 全部笔记页用固定行高虚拟滚动（`ROW_HEIGHT` 与 CSS `.w1-nvrow` 高度必须一致），分页每页 60 条。
- 数据库位置：`%APPDATA%\WorkStationForOne\data\workstation.db`；设置 `WS_DATA_DIR` 可覆盖，冒烟与运行时校验据此使用临时库，避免改写真实数据。
- 迁移前会自动 `VACUUM INTO` 备份到库文件旁。迁移 SQL 不得替用户伪造语义（例如给历史任务填「今天到期」）。
- 未实现：习惯/学习/会话三域持久化、任务的子任务 / 循环 / 提醒 / 清单重命名、真实 Claude/Codex 适配器、本地 MCP 服务器、设置、审计、备份与打包。
- 渲染进程不直接访问数据库；新增数据能力必须走 `src/shared/ipc.ts` 的类型契约 + `src/main/ipc/` 的 handler，并在主进程校验入参。
