# WorkStationForOne

Windows 上的个人 AI 工作站。把「今日看板 + 任务清单 + Agent 工作区 + 笔记库 + 闪卡复习」收进一个窗口：左侧导航一次只打开一个全宽工作区，Agent 视图里驱动本机 Claude Code CLI 对话，任务、笔记、学习与习惯全部落在本机 SQLite。

> 当前版本 v0.8.0（2026-10-29）。任务（含清单、计划、重复、子任务）、笔记（含双链）、学习（MEM 科目 + FSRS-6 + CSV 导入导出 + 统计）、习惯、审计与 Agent 会话均已落库（DB v16）；Agent 通过本机 `claude` CLI 流式对话，读工具自动放行、写操作逐次审批，会话与消息重启后仍在；便携版可用。Codex 适配器与本地 MCP 桥尚未实现。

## 特点

- **一个窗口完成一天的调度**：左侧一级导航在今日 / 任务 / Agent / 笔记 / 学习之间切换；今日聚合任务摘要、习惯打卡、学习与复习、快速笔记四块看板，配时间轴与舰队状态。
- **完整的任务工作区**：收集箱、今天、即将到来、全部、已完成与自定义清单；快速添加支持「明天 15:00 提交周报 !高 #工作」这类中文输入，输入时预览解析结果、提交后提示去向；行内详情支持今天/明天/清除快捷日期、备注与优先级；今日卡标题栏也能「快速添加」，直接切到任务工作区并聚焦输入框。另有「计划今天」与容量条、排程预览、拖拽改期、重复任务、子任务、到点提醒、「只做三件事」、清单重命名与完成记录热力图。
- **Agent 是独立工作区**：默认空态，新建 Claude 会话后真实调用本机 `claude` CLI（stream-json），流式文本与工具调用卡直接进线程；会话标题取自首条消息，消息与工具卡落 SQLite，Claude 的 resume id 也保存下来，重启后能继续。读工具（Read / Glob / Grep / LS）自动放行；编辑、写入、Bash 等工具会弹出「允许一次 / 拒绝」审批卡，逐次裁决。
- **可扩展的外壳**：新应用作为一级导航项接入，各自拥有全宽工作区；看板与 Agent 不同屏，也不存在常驻右栏。
- **本地优先**：数据只存在本机 SQLite；不使用云同步、不上传遥测、不保存 API Key。
- **中文优先的 HUD 界面**：极光玻璃、直角、终端式元素；夜色与白天双主题，动效可整体关闭，也尊重系统的「减少动效」设置。
- **间隔重复复习**：面向 MEM 初试的闪卡，默认科目为英语二 / 管综数学 / 管综逻辑 / 管综写作；调度使用 **FSRS-6**（默认参数、90% 目标保留率），每张卡维护稳定度 / 难度 / 失误次数，评分 1 留在今天，当天重复复习走短期公式。支持 `{{c1::答案}}` 挖空卡与一键把笔记转成卡片。
- **学习统计**：学习视图的「统计」弹层用 FSRS 稳定度估算当前记忆保持率，按复习日分桶展示未来 7 天到期负载，按新卡 / 学习中（稳定度 < 21 天）/ 成熟卡展示掌握分布，并给出最近 14 天复习量与四档评分占比。
- **学习卡批量导入导出**：用 UTF-8 CSV（`科目,正面,背面,来源,类型,挖空原文`）批量灌入 MEM 词表与题库；导入前预览可导入 / 重复 / 错误行，按「科目 + 正面」去重，不覆盖已有卡；导出按当前科目筛出启用卡，直接用 Excel / WPS 编辑。
- **笔记全文搜索与双链**：SQLite FTS5 + trigram 分词，中文与英文都能检索，两字短词自动回退模糊匹配；弹层详情可编辑、删除与转卡。正文里用 `[[笔记首行]]` 互相引用，详情显示出链与被引用列表，输入 `[[` 自动补全唯一标题。
- **习惯与审计**：打卡按本地日期存库，显示连续天数；任务、笔记、学习、习惯的写入在仓储层留下审计记录。

![今日工作区](docs/screenshots/home.jpg)

![任务工作区](docs/screenshots/tasks.jpg)

![Agent 工作区](docs/screenshots/agent.jpg)

![全部笔记](docs/screenshots/notes.jpg)

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Electron 45（sandbox + contextIsolation，仅暴露窄 preload 桥） |
| 界面 | React 19、TypeScript、Zustand、Motion、cmdk |
| 数据 | Electron 内置 `node:sqlite`（WAL、`PRAGMA user_version` 前向迁移、FTS5，DB v16） |
| 构建 | electron-vite、Vite 8、Vitest、Biome |

不引入原生 SQLite 模块，因此没有 `@electron/rebuild` 与 ABI 匹配问题。

## 快速开始

需要 Node.js 22.12+（Vitest 5 的要求）与 Windows 10/11。

```bash
npm install
npm run dev
```

窗口会自动打开，改代码热更新。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式启动，支持 HMR |
| `npm run build` | 生产构建，输出到 `out/` |
| `npm start` | 预览上一次构建 |
| `npm run typecheck` | 类型检查（main/preload 与 renderer 各一套配置） |
| `npm test` | 运行全部单元测试（554 项） |
| `npm run check` | Biome 检查格式与 lint（Rust 单二进制，不依赖 Prettier / ESLint） |
| `npm run smoke` | 构建后跑 UI 交互冒烟（208 项，真实主进程 + 临时 SQLite） |
| `npm run verify` | 启动真实主进程跑 251–253 项运行时断言（五视图、双主题/皮肤、跨重启） |
| `npm run capture -- .screenshots/home.png 1440 900 .screenshots/audit.json` | 截图并输出布局审计 |
| `npm run capture -- .screenshots/notes-1180.png 1180 720 .screenshots/audit-notes.json dark notes` | 指定主题 `dark|light` 与视图 `today|tasks|agent|notes|learning` 截图 |
| `npm run package` | 构建并生成便携版到 `dist/WorkStationForOne/` |
| `npm run icon` | 从 `resources/icon.svg` 重新生成 PNG 与多尺寸 ICO |

请始终通过上述封装脚本启动 Electron：开发环境可能设置了 `ELECTRON_RUN_AS_NODE=1`，脚本会清除它并正确解析 electron-vite。

## 目录结构

```
src/
  main/                 主进程：唯一持有数据库、子进程与权限
    db/                 连接、迁移与任务 / 笔记 / 学习 / 习惯 / 审计 / 智能体会话仓储
    ipc/                IPC handler 与入参校验
    agent/              Claude CLI 适配器与事件流
  preload/              暴露 window.ws 的窄类型化桥
  renderer/             界面（无 Node、无数据库、无文件系统权限）
    src/components/     左侧导航、今日看板、任务 / Agent / 笔记 / 学习工作区、自建表单控件
    src/lib/            纯函数规则（日程、任务筛选、快速添加解析、排程、重复、热力图、学习）
    src/store/          Zustand 状态
  shared/ipc.ts         IPC 通道常量与跨进程类型契约
  shared/date-key.ts    本地日期键与日期运算
  shared/srs.ts         FSRS-6 调度（纯函数，主进程执行）
  shared/learning-csv.ts 学习卡 CSV 解析 / 序列化
  renderer/src/lib/learning-stats.ts 未来负载、保持率与掌握度（纯函数）
  shared/repeat.ts      重复任务推进规则
  shared/cloze.ts       挖空卡解析
resources/              应用图标源文件与产物
scripts/                开发、构建、冒烟、运行时校验、截图、打包脚本
docs/superpowers/specs/ 产品与架构设计规格
```

## 数据

- 位置：`%APPDATA%\WorkStationForOne\data\workstation.db`
- 已落库：任务（清单、截止/计划日期、时长、优先级、备注、完成时间、重复、子任务）、笔记（含 FTS5 索引与双链）、学习卡片（含 FSRS 稳定度 / 难度 / 失误次数）与复习记录、习惯与按日打卡、智能体会话与消息（含工具卡与 resume id）、审计日志
- 备份：每天首次启动用 `VACUUM INTO` 生成快照到 `<库目录>/backups/`，保留最近 10 份；命令面板可手动备份
- 全局快速捕获：`Ctrl+Alt+Space` 随时记一条，落库后主窗口即时刷新

删除该目录即可回到初始状态。

## 安全边界

- 渲染进程没有 Node、数据库或文件系统访问权；所有能力经 `src/shared/ipc.ts` 的类型契约 + 主进程入参校验。
- Agent 提示词只走 stdin，子进程 `shell: false`，不添加 `--dangerously-*`，只开放只读工具白名单。
- 应用是单实例的；关闭窗口即退出。
- 仓库不包含任何密钥、登录态或个人配置。

## 已知限制

- 工具审批只有「允许一次 / 拒绝」，没有「本会话始终允许」或持久规则；宿主内问答（AskUserQuestion）会被自动拒绝。
- Agent 依赖本机 `claude` CLI 已登录且模型可用；当前配置指向的模型若被网关拒绝，会明确显示 API 错误。
- Codex 适配器与本地 MCP 服务器尚未实现；Agent 页不预置演示会话，首次进入是空态。
- 审计日志已有记录，但还没有查看入口。
- 笔记双链只按「唯一首行」解析：重名或找不到的目标不建立链接；目标改首行后旧链接仍指向它，但正文里显示的是保存时的标题快照。
- 学习域使用 FSRS-6 默认参数，不提供参数优化器；暂无导入导出、拼写与作文题型。
- 到点提醒只覆盖任务；学习到期不会推送系统通知。
- 仅支持 Windows；默认夜间主题，可在状态栏或命令面板切换到白天模式。

## 文档

- 设计规格：[docs/superpowers/specs/2026-10-23-workstation-design.md](docs/superpowers/specs/2026-10-23-workstation-design.md)
- 协作约定：[AGENTS.md](AGENTS.md)
