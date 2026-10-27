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
- `npm run smoke` — 先构建，再跑 149 项 UI 交互冒烟。加载真实主进程与 preload，UI 操作直接写进临时 SQLite（`userData`、`sessionData`、数据库都隔离到 `%TEMP%`），并断言「preload 桥可用」与「操作已落库」；跨重启持久化仍由 `npm run verify` 覆盖。
- `npm run verify` — 构建后启动真实主进程（临时 `WS_DATA_DIR`），运行 244 项运行时断言：五视图互斥、双主题/双皮肤持久化、跨重启数据。
- `npm run capture -- .screenshots/shell-1440.png 1440 900 .screenshots/audit-1440.json` — 构建、保存截图并写入布局审计。
- `npm run capture -- .screenshots/shell-1180.png 1180 720 .screenshots/audit-1180.json dark` — 在最小窗口尺寸下做同样的检查；主题参数为 `dark|light`，视图参数为 `today|tasks|agent|notes|learning`，均可省略审计路径后按任意顺序追加（如 `... 1440 900 light tasks`）。
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
- 格式与 lint 统一走 Biome（`biome.json`，Rust 单二进制）。不要引入 Prettier / ESLint。配置里关掉的规则都是与项目设计冲突的：`<i>//</i>` 是终端风格装饰而非注释、带 `role` 的 div 是虚拟列表容器、无障碍降级必须用 `!important` 压过后导入的分节、跨分节特异性倒置是导入顺序的结果。新增例外优先写 `// biome-ignore <rule>: 原因`，不要全局关规则。
- main 与 preload 以 CJS 构建（没有 `"type": "module"`）。未验证 Electron preload 与 sandbox 行为前，不要切换模块格式。
- Vitest 覆盖 `src/**/*.test.ts` 与 `scripts/**/*.test.mjs`，运行在 Node 环境。添加 `.tsx` 测试前，先有意识地配置 DOM/组件测试环境。

## UI 契约

- 中文优先文案。保持 B‴ 极光 HUD：玻璃卡片、渐变/辉光、直角、终端式元素。默认夜间，支持白天模式；白天同样使用极光玻璃语言，不得退化为通用极简 UI。
- 外壳固定为「左侧主导航 + 单个全宽工作区」：今日 / 任务 / Agent / 笔记 / 学习互斥渲染，不得恢复常驻右栏或让看板与 Agent 同屏。Agent 视图内部才是「会话列表 + 聊天区」两栏，任务视图内部是「清单栏 + 任务列表」两栏，学习视图内部是「科目栏 + 卡片列表」两栏。
- 今日卡只展示今天与逾期任务；任务全量管理放在「任务」工作区。不要恢复今日卡显示所有任务，也不要给任务另建一套数据源。今日卡末尾是「完成记录」热力图：只统计带 `completedAt` 的已完成任务，按本地日期归入近 26 周（周一起始）的格子，未来日期留空（`lib/heatmap.ts`）。
- 任务视图：容量条只统计 `planned_for = 今天` 且未完成的任务，可用时间按 09:00–22:00 窗口扣掉当前时刻计算（`lib/capacity.ts`）；「计划今天」面板只做计划/取消计划，时长在任务详情里设置；「排程预览」按截止日期 → 优先级贪心排入 09:00–22:00 空档、15 分钟对齐，已有时间的任务作为锚点，结果先预览再「接受全部」（`lib/planner.ts`）。
- 任务视图：智能清单（收集箱 / 今天 / 即将到来 / 全部 / 已完成）与自定义清单都来自同一 `tasks` 数组；新增或删除任务必须同步 SQLite。快速添加的 Enter、`Ctrl+Shift+N` 聚焦、Esc 收起详情、搜索 Esc 清空、中文输入法组合期间不提交是既有契约。详情关闭后焦点回到行标题；日期支持今天/明天/清除快捷按钮。权限卡里的任务顺延可携带 `toDueDate`，允许后必须同时更新截止日期，不能只改时间与标签。任务行支持拖拽改期：拖到智能清单/自定义清单改截止日期或清单，拖到今日时间轴写入时间（15 分钟对齐，规则在 `lib/dnd.ts`）；拖拽只是鼠标增强，键盘用户仍走详情编辑。
- 新增应用入口加到 `WorkspaceNav` 的 `VIEWS`，并为其提供独立工作区与导航命令；不要挤进顶栏或状态栏。视图切换用 `aria-current="page"` 标记当前项。
- 笔记是独立全宽工作区，不是弹窗；搜索框内有查询时 Esc 清空搜索，不关闭笔记页。Agent 与笔记的滚动容器各自独立，切换视图后保持原外壳尺寸。
- 表单里的日期、时间与带建议的单行字段一律用 `components/fields/` 的自建控件（`DatePicker` / `TimePicker` / `ComboSelect`），不要退回 `input[type=date|time]` 或 `datalist`：这些由系统绘制，CSS 盖不住，会露出生硬的白色弹层。三者共用 `Popover`（portal 到 `.w1` 根节点，因为 `.w1-view` 带 transform），弹层是「不透明玻璃 + 1px 棱镜边」，`.w1-pop` 已加进 `11-motion.css` 与无障碍/浅色/经典皮肤的白名单。日历网格与时间刻度规则在 `lib/pickers.ts`，改动先改那里的测试。弹层按 Esc 只关自己（`stopImmediatePropagation`）并把焦点还给触发按钮。
- 学习视图内部两态：卡片库（默认，科目栏 + 卡片列表）与复习态（占满整块舞台，`.w1-learn.review` 覆盖两栏 grid）。到期口径固定为 `active` 且 `nextReviewOn <= 今天`，排序与时长在 `lib/learning.ts`，组件不要自行比较日期；复习卡进入时对队列做一次快照，评分 1 的卡排到本场队尾但库里的 `next_review_on` 仍是今天。复习卡翻面用 `Space` / 点击，评分用 `1`–`4`，Esc 退出。
- 复习卡是 `<button>`，必须显式 `background-color: transparent`（UA 的 `buttonface` 会从玻璃层后透出灰块），并把 `.w1-lcard` 加进 `11-motion.css` 定义 `--glass-rim` 的选择器白名单，否则棱镜描边不生效。大块玻璃面要自带 `::before` 光场，否则整片压成实色。
- 今日看板末尾的学习卡与学习视图共用 `learningItems`：到期数与时长来自同一组纯函数，不得另建数据源；`开始复习` 走 store 的 `startLearningReview()`，同时切视图与进复习态。
- 动效统一使用 `--ease-*` / `--dur-*`（`styles/sections/00-base.css`）与 `src/renderer/src/lib/motion.ts`；列表重排走 `withViewTransition`（`lib/view-transition.ts`），系统减少动效或 `motion-off` 时自动退回同步更新，不要绕过它直接调 `startViewTransition`；高频键盘动作保持即时，hover 位移在粗指针设备下关闭，可点击控件使用统一的 `:active` 缩放反馈。
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

- 已实现：任务域与笔记域 SQLite 持久化（`src/main/db/`，Electron 内置 `node:sqlite`，WAL + `PRAGMA user_version` 前向迁移），类型化 preload 桥 `window.ws`，勾选与权限变更结果落库，启动时以数据库内容覆盖种子数据。
- 已实现：任务工作区与完整任务字段。`tasks` 迁移到 v6：v3 新增 `notes / due_date / priority / list`，v4 新增 `deleted_at` 做软删（删除保留 30 天后清理，撤销只需清空该列），v6 新增 `planned_for / estimate_minutes` 区分「计划做」与「截止」；仓库支持 `create / update / remove / restore`；今日卡只含今天与逾期；快速添加、去向提示、清单派生、搜索（Esc 清空）、行内详情、快捷日期、焦点归位和 `Ctrl+Shift+N` 已接入。权限卡顺延会同步截止日期；笔记总数独立保存在 `noteTotal`，导航与上下文用量使用数据库总数而非预览条数。
- 已实现：夜间/白天双主题（默认夜间），状态栏与命令面板可切换；主题写入 `localStorage`，启动首帧前应用，并通过 `app:set-theme` 窄 IPC 同步窗口背景与标题栏配色。
- 已实现：全局快速捕获窗（`Ctrl+Alt+Space`）。独立 560×168 无边框窗口走同一 preload，用 `capture:create` 落库后广播 `tasks:changed`，主窗口调用 `refreshTasks()` 重新拉库；失焦或 Esc 自动隐藏。
- 已实现：今日看板「完成记录」热力图。近 26 周 × 7 天（周一起始），四档色阶与「项完成 / 天有记录 / 最多一天」统计，规则在纯函数 `lib/heatmap.ts`；种子数据中今天已完成的两条任务带 `completedAt`，首次启动即可见当天格子。没有 `completedAt` 的旧数据不计入，也不要迁移伪造。
- 已实现：外壳「左侧主导航 + 单个全宽工作区」。今日（模块流）、任务（清单栏 + 任务列表）、Agent（会话栏 + 聊天区）、笔记（全宽工作区）、学习（科目栏 + 卡片列表 / 复习态）互斥渲染；左侧导航同时承载舰队总览、外部启动器与设置；命令面板可直接跳转视图或新建任务。
- 已实现：学习域 v1（间隔重复闪卡）。`learning_items` / `learning_reviews` 迁移到 v7，调度规则在 `shared/srs.ts`（1 重来 / 2 困难 / 3 良好 / 4 简单，间隔上限 365 天、ease 1.3–3.0），主进程按本机当天计算，`review` 不接收日期；`lib/learning.ts` 负责到期队列、时长估算与科目分组；种子 24 张（英语二 16 个真题高频词 + 互联网 8 个概念），仅空库写入。
- 笔记搜索：FTS5 `trigram` 分词（`unicode61` 无法检索中文）；**查询少于 3 字符时自动回退 `LIKE`**，写查询前请先看 `src/main/db/notes.ts` 的 `planSearch`。
- 全部笔记页用固定行高虚拟滚动（`ROW_HEIGHT` 与 CSS `.w1-nvrow` 高度必须一致），分页每页 60 条。
- 数据库位置：`%APPDATA%\WorkStationForOne\data\workstation.db`；设置 `WS_DATA_DIR` 可覆盖，冒烟与运行时校验据此使用临时库，避免改写真实数据。
- 迁移前会自动 `VACUUM INTO` 备份到库文件旁。迁移 SQL 不得替用户伪造语义（例如给历史任务填「今天到期」）。
- 未实现：习惯/会话两域持久化、任务的子任务 / 循环 / 提醒 / 清单重命名、真实 Claude/Codex 适配器、本地 MCP 服务器、设置、审计、备份与打包。
- 渲染进程不直接访问数据库；新增数据能力必须走 `src/shared/ipc.ts` 的类型契约 + `src/main/ipc/` 的 handler，并在主进程校验入参。preload 桥目前暴露 `tasks / notes / capture / learning / app` 五组接口，`runtime-verify.mjs` 会断言这个集合，扩面时同步更新。

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
