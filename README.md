# WorkStationForOne

Windows 上的个人 AI 工作站。把「看板 + Agent 控制面」放进一个窗口：左边调度 Claude Code / Codex 会话，中间是任务、习惯、学习与笔记，右边与 Agent 对话并审批它对数据的写入。

> 当前处于开发早期（v0.1.0）。任务与笔记已落库；真实 Agent 适配器、MCP、审计与打包尚未实现。

![主界面](docs/screenshots/home.webp)

## 特点

- **一个窗口完成一天的调度**：任务与日程、习惯打卡、学习复习、快速笔记四块看板，配时间轴与会话舰队状态。
- **权限可见、可审**：Agent 想改任务时间，会弹出一张逐行 diff 的权限卡（旧值划线、新值高亮），你点「允许一次」才写入。
- **本地优先**：数据只存在本机 SQLite；不使用云同步、不上传遥测、不保存 API Key。
- **中文优先的 HUD 界面**：极光玻璃、直角、终端式元素；夜色与白天双主题，动效可整体关闭，也尊重系统的「减少动效」设置。
- **笔记全文搜索**：SQLite FTS5 + trigram 分词，中文与英文都能检索，两字短词自动回退模糊匹配。

![全部笔记](docs/screenshots/notes.webp)

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Electron 45（sandbox + contextIsolation，仅暴露窄 preload 桥） |
| 界面 | React 19、TypeScript、Zustand、Motion、cmdk |
| 数据 | Electron 内置 `node:sqlite`（WAL、`PRAGMA user_version` 前向迁移、FTS5） |
| 构建 | electron-vite、Vite 8、Vitest |

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
| `npm test` | 运行全部单元测试（113 项） |
| `npm run smoke` | 构建后跑 UI 交互冒烟测试（59 项检查） |
| `npm run capture -- .screenshots/home.png 1440 900 .screenshots/audit.json` | 截图并输出布局审计 |
| `npm run capture -- .screenshots/day.png 1440 900 light` | 以白天模式截图（末位参数为主题） |
| `npm run icon` | 从 `resources/icon.svg` 重新生成 PNG 与多尺寸 ICO |

请始终通过上述封装脚本启动 Electron：开发环境可能设置了 `ELECTRON_RUN_AS_NODE=1`，脚本会清除它并正确解析 electron-vite。

## 目录结构

```
src/
  main/                 主进程：唯一持有数据库、子进程与权限
    db/                 连接、迁移、任务与笔记仓储
    ipc/                IPC handler 与入参校验
  preload/              暴露 window.ws 的窄类型化桥
  renderer/             界面（无 Node、无数据库、无文件系统权限）
    src/components/     看板卡片、会话坞、浮层
    src/lib/            纯函数规则（日程、命令、舰队统计、虚拟滚动）
    src/store/          Zustand 状态
  shared/ipc.ts         IPC 通道常量与跨进程类型契约
resources/              应用图标源文件与产物
scripts/                开发、构建、冒烟、截图、图标生成脚本
docs/superpowers/specs/ 产品与架构设计规格
```

## 数据

- 位置：`%APPDATA%\WorkStationForOne\data\workstation.db`
- 已落库：任务（含完成状态、时间变更）、笔记（含全文索引）
- 尚未落库：习惯、学习复习、会话与消息——这些目前仍是内存种子数据，重启会重置

删除该目录即可回到初始状态。

## 安全边界

- 渲染进程没有 Node、数据库或文件系统访问权；所有能力经 `src/shared/ipc.ts` 的类型契约 + 主进程入参校验。
- 应用是单实例的；关闭窗口即退出。
- 仓库不包含任何密钥、登录态或个人配置。

## 已知限制

- 尚未接入真实 Agent：对话区回复是固定演示数据，不会真正调用 Claude 或 Codex。
- 设置、审计、MCP 服务端、每日备份与安装包均未实现。
- 仅支持 Windows；默认夜间主题，可在状态栏或命令面板切换到白天模式。

## 文档

- 设计规格：[docs/superpowers/specs/2026-10-23-workstation-design.md](docs/superpowers/specs/2026-10-23-workstation-design.md)
- 协作约定：[AGENTS.md](AGENTS.md)
