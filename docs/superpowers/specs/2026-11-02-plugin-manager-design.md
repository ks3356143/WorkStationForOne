# 插件可视化管理、启动更新检查与可配置存储位置（v0.36.0 / DB v30）

- 状态：设计待评审
- 日期：2026-11-02
- 范围：Claude / Codex 双 Agent 的插件与技能可视化管理、官方与第三方 Git 源、详情预览、启动时自动检查更新并提示、可配置的存储根目录与迁移
- 关联：`docs/superpowers/specs/2026-10-23-workstation-design.md`、`AGENTS.md`

## 1. 背景与目标

能力中心目前只有 Claude 插件：官方市场走应用私有 `market-src` 镜像，只能浏览这一个源；安装 / 更新 / 卸载靠隔离 `CLAUDE_CONFIG_DIR` 调 Claude CLI；预览已有源文件树与 `SKILL.md`。Codex 侧完全没有插件管理。

Codex 0.166 已有完整插件体系（本机实测，2026-11-02）：

- `codex plugin add|list|remove`
- `codex plugin marketplace add|list|upgrade|remove`
- 市场源支持本地路径、`owner/repo[@ref]`、HTTPS / SSH Git 地址
- **市场清单格式与 Claude 相同**：`.claude-plugin/marketplace.json`；写成 `.codex-plugin/` 反而报「不支持 manifest」
- 插件状态写在 `<CODEX_HOME>/config.toml` 的 `[plugins."name@market"] enabled = true`
- 插件内容落在 `<CODEX_HOME>/plugins/cache/<market>/<plugin>/<version>/`，其中有 `skills/`
- `codex plugin list --json` 对**本地**市场返回空数组，文本输出才有内容
- `CODEX_HOME` 隔离有效：临时 home 内安装、卸载、移除市场全程不触碰 `~/.codex`
- `codex app-server` 的 `initialize` 回包带 `codexHome`，确认使用指定目录

目标：不打开终端也能管理两个 Agent 的插件——添加官方与第三方 Git 源、浏览、看详情、安装、启用、更新、卸载；并在每次打开工作台时自动检查插件、技能、MCP 与内置工具的更新，用非阻断提示告知。同时允许用户把整个应用数据根目录换到非 C 盘位置，迁移后不保留原目录。

## 2. 范围与非目标

**范围**

- 存储根目录可配置：位置文件、目录布局、复制式迁移、迁移后删除原目录。
- DB v30：`plugin_sources` 源表；`agent_plugins` 增加 `agent` 与 `source_id`。
- `PluginSourceService`：Git 源的克隆 / 刷新 / 注册 / 移除，共用一套 `.claude-plugin/marketplace.json` 解析。
- `PluginService` 双适配器：Claude 走既有 CLI 路径，Codex 走 `CODEX_HOME` 隔离路径。
- 统一市场视图：源列表 + 已安装 + 市场列表，按 Agent 过滤；详情弹层复用现有源文件树与 `SKILL.md` 预览。
- 启动更新检查：插件、技能、内置目录 MCP 三类；内置工具只随应用升级变化，不参与。
- 底部更新提示条 + 设置页「更新」区，手动执行更新。
- 从本机只读扫描并导入：列出 `~/.claude` 与 `~/.codex` 已有的插件市场与插件，用户在界面上勾选后复制进应用私有目录。

**非目标**

- 不托管插件市场服务，不做远程 registry。
- 不做插件代码安全扫描或自动执行插件脚本。
- 不做自动安装更新：查到只提示，执行必须由用户点击（已确认）。
- **不改写本机 `~/.claude`、`~/.codex`；不向它们注册任何市场或插件。** 与环境完全隔离，导入是单向复制。
- 不改 Claude / Codex 的插件格式，只在应用私有目录内注册。
- 不实现 Codex 的远程市场（`remote marketplaces`）；本轮只处理本地与 Git 源。
- 不替换现有 MCP 管理与内置工具开关。
- 存储位置只支持「一个根目录」整体搬迁，不支持把数据 / 插件 / 备份拆到不同磁盘。
- 不支持运行中热切换：切换一律在下次启动时执行。

## 3. 关键事实与约束

| 事实 | 影响 |
| --- | --- |
| 两种 Agent 清单同名同格式 | 一份解析器，两个注册动作 |
| Codex 只认 `.claude-plugin/marketplace.json` | 不得生成 `.codex-plugin/` |
| `plugin list --json` 对本地市场为空 | 插件状态必须自己算：读 `config.toml` 与 `plugins/cache/` |
| 状态落 `config.toml` | 不能用 CLI 以外的方式伪造启用状态 |
| `CODEX_HOME` 生效于 app-server | 应用内 Codex 会话能看到应用私有插件 |
| 本机 `~/.codex` 已有 3 个市场 | 只作为**只读导入来源**；导入后复制进应用私有目录，不回写 |
| Codex 官方文档支持 `plugins.<plugin>.enabled` | 停用只能改写 `config.toml`，这是官方途径而非旁路 |
| Cherry Studio 的数据目录在设置里是灰的（issue #7467），社区用 `mklink` 绕 | 应用内迁移是加分项，没有现成实现可抄，必须自己保证复制与校验正确 |

### 3.1 与同类产品的差异

Electron 套壳产品的常见做法是「不给改，让用户自己建符号链接」，Cherry Studio 即如此：设置页路径只读，官方 issue #7467 至今未支持；便携版才提供 `--user-data-dir` 启动参数。本项目选择做完整的应用内迁移，因此额外承担以下责任：

- 位置文件必须放在默认 `%APPDATA%` 下，不能放进数据库（库在根目录内，会循环）。
- 迁移必须「复制 → 校验 → 切换 → 删旧根」，任何一步失败都要能回退。
- 不模仿 `mklink` 方案：符号链接在 Windows 需要管理员权限，且用户移动目标目录后链接会静默失效。

## 4. 存储根目录（先于插件实现）

### 4.1 位置文件

数据根目录不能存在数据库里（库就在根目录内），因此用独立小文件：

```
%APPDATA%\WorkStationForOne\location.json
```

```json
{
  "root": "D:\\WorkStationForOne",
  "pending": null,
  "previous": null
}
```

| 字段 | 含义 |
| --- | --- |
| `root` | 当前生效的根目录；缺省或文件不存在时用 `%APPDATA%\WorkStationForOne` |
| `pending` | 已选定但尚未迁移的目标；启动时处理 |
| `previous` | 上一次确认过的根目录，仅用于删除校验 |

- 只存路径，不存任何业务数据。
- 默认情况不创建该文件，保持零配置。
- `WS_DATA_DIR` 环境变量仍**优先于**位置文件（测试缝不变）。
- 文件损坏或 `root` 非法时：记 console、回退默认目录，不阻断启动。

### 4.2 目录布局

```
<root>/
  data/          workstation.db、backups/
  agent/         claude-plugins/（含 config/）、plugin-sources/
  codex-home/    Codex 隔离配置与插件缓存
```

`dirname(database.file)` 现有的三处派生（`appDataDir`、备份目录、`codexHome`）改成从统一解析结果取，不再各自拼路径。

### 4.3 迁移流程

设置页「数据」区新增「存储位置」，显示当前根目录与「更改」。选择新目录后只写 `pending`，提示「重启后迁移」。

启动时读到 `pending`，按序执行：

1. **路径校验**：新路径是绝对路径；不等于当前根目录；不是当前根目录的父目录或子目录；不存在或为空目录。任一不满足则中止并保留 `pending` 为失败原因（`pendingError`）。
2. **复制**：整根目录复制到 `<target>.migrating-<时间戳>`。
3. **校验**：对复制出的 `data/workstation.db` 执行 `PRAGMA integrity_check` 与 `user_version`，并比对源库的表数量。
4. **落位**：把临时目录改名为 `<target>`。
5. **切换**：写 `root = <target>`、`previous = <旧根>`、`pending = null`。
6. **删除旧根**。

任一失败：删除临时目录，`location.json` 保持不变，继续用旧根启动，设置页显示失败原因。

### 4.4 删除旧根（不可逆，三道保护）

1. 删除前再确认新库可打开、表数量与源库一致。
2. 旧根必须等于 `previous` 且不等于默认目录之外的任意路径；路径含 `..` 或为空一律拒绝。
3. 删除失败不阻断启动，只在设置页留「旧目录未能删除，可手动清理：<路径>」。

### 4.5 边界

| 场景 | 处理 |
| --- | --- |
| 选中当前根目录 | 拒绝 |
| 父目录 / 子目录 | 拒绝（自嵌套） |
| 目标非空 | 拒绝，提示换空目录 |
| 目标不可写或空间不足 | 复制阶段中止，提示剩余空间 |
| 搬迁中断电 / 崩溃 | 下次启动发现残留 `.migrating-*`，提示「检测到未完成的迁移，已清理」，删除残留 |
| 便携版 | 根目录默认为 exe 同级 `data`，同样可改 |
| 切换后首次启动失败 | 位置文件已切换但库打不开时，回滚到 `previous` 一次并提示 |

### 4.6 UI 与 IPC

- 设置页「数据」区新增一行：当前路径、占用大小（可选）、「更改」「打开目录」。
- 选定后按钮变「重启后迁移到：<新路径>」，并显示「取消更换」。
- IPC：`capabilityStorageInfo`、`capabilityStoragePick`、`capabilityStorageCancel`。目录选择走原生 `dialog.showOpenDialog`，`WS_PICK_STORAGE` 是自动化测试缝。
- 迁移只在启动阶段发生，主进程不提供「立即迁移」。

## 5. 数据层（DB v30）

```sql
CREATE TABLE plugin_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('official', 'git')),
  url TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  root TEXT NOT NULL,
  last_synced_at INTEGER,
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`agent_plugins` 迁移：

```sql
ALTER TABLE agent_plugins ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude'
  CHECK (agent IN ('claude', 'codex'));
ALTER TABLE agent_plugins ADD COLUMN source_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_agent_plugins_key ON agent_plugins(agent, plugin_id);
```

- SQLite 不能直接改主键，新增唯一索引承担「同一 Agent 下插件唯一」的职责；原 `id` 主键保留。
- 现有行一律 `agent='claude'`、`source_id=''`，升级后行为不变。
- 内置官方源在迁移里不插行，由启动逻辑幂等创建（`kind='official'`，`name='wsfo-official'`），避免空库时迁移写入运行时路径。
- `last_error` 只存可读原因，最多 300 字，不含路径凭据。

## 6. 源服务

### 6.1 添加源

1. 校验名称（1–60，唯一）与地址：本地绝对路径必须存在；Git 只接受 `owner/repo`、`https://`、`ssh://`、`git@`。
2. 目标目录 `<data>/agent/plugin-sources/<slug>`；`slug` 由名称生成，冲突追加序号。
3. `git clone --depth 1`，有 `ref` 时加 `--branch <ref>`；超时 180 秒，`shell: false`。
4. clone 后校验 `<root>/.claude-plugin/marketplace.json` 存在且 `name` 为非空字符串，否则删除目录并报错。
5. 注册到两边（见 5.3），源行落库。
6. 失败回滚：删目录、删已注册项，不写半成品行。

本地路径源（`kind='git'` 但 url 是目录）不 clone，直接注册原路径；界面上标注「本地目录」。

### 6.2 刷新与移除

- 刷新：`git fetch --depth 1 origin <ref>` + `git reset --hard FETCH_HEAD`，再对两边执行 `marketplace upgrade`；更新 `last_synced_at`，失败写 `last_error`。
- 官方源刷新沿用现有 `git fetch` / `reset` 逻辑，不允许移除。
- 移除：先对两边 `marketplace remove <name>`，再删本地目录与源行。**已安装插件保留**，提示「源已移除，已装的 N 个插件仍在，可在已安装列表卸载」。

### 6.3 注册

| Agent | 命令 | 环境 |
| --- | --- | --- |
| Claude | `claude plugin marketplace add <root>` | `CLAUDE_CONFIG_DIR=<data>/agent/claude-plugins/config`（与市场清单共用，源注册后市场才能看到） |
| Codex | `codex plugin marketplace add <root>` | `CODEX_HOME=<data>/codex-home` |

- 两边都通过现有 `resolveCommand()` 解析入口，`shell: false`，180 秒超时。
- 注册结果以命令退出码为准；失败时把 stderr 最后一行转成可读原因（截断 200 字）。
- **不提供任何向本机 `~/.claude` / `~/.codex` 注册的路径。** 两个 CLI 子进程都显式带私有配置环境变量，即使本机配置文件存在也只读不写。

### 6.4 从本机导入

单向复制，不联动、不回写。

#### 扫描

`main/capabilities/plugins/import-scan.ts`：

| 来源 | 读取 | 产出 |
| --- | --- | --- |
| Claude | `~/.claude/plugins/config.json` 与 `~/.claude/settings.json` 中的 `extraKnownMarketplaces` / `enabledPlugins` | 市场名、源地址、已装插件 id 与版本 |
| Codex | `~/.codex/config.toml` 的 `[marketplaces.*]` 与 `[plugins."name@market"]` | 市场名、source、source_type、已装插件与 enabled |
| 通用 | 两个 `plugins/cache/` 下的目录名 | 实际安装路径与版本 |

规则：

- 只读：任何文件都不写，`mtime` 不变。
- 解析失败只跳过该文件并记录原因，不中断整体扫描。
- 扫描结果不落库，只在打开导入面板时现读。
- `WS_SESSION_SCAN_ROOT` 风格测试缝：`WS_PLUGIN_SCAN_ROOT` 覆盖 home 根，供冒烟使用。

#### 导入

面板列出「市场」与「插件」两段，都可勾选：

- **导入市场**：把该市场的源地址加进 `plugin_sources`（`kind='git'`，`url` 取 source；本地路径源复制目录快照到应用私有目录），再按 5.1 注册到应用私有环境。已存在的同名源标「已导入」。
- **导入插件**：对选中插件走安装流程，装进应用私有目录；优先用市场安装，源不可达时回退为「复制该插件的 cache 目录」。
- 导入后状态一律**停用且未信任**（与现有新装规则一致）；带 hooks / MCP 的插件仍需二次确认。
- 导入写审计：`plugin.import agent=claude|codex count=N`。
- 幂等：同一 `agent + 插件 id` 已存在时跳过并提示。

#### 文案

面板顶部固定说明：「只读取本机配置，不会修改 `~/.claude` 或 `~/.codex`；导入后插件装在应用私有目录，与本机环境互不影响。」

## 7. 双适配器

### 7.1 统一接口

```ts
interface PluginAdapter {
  agent: 'claude' | 'codex'
  listInstalled(): Promise<PluginRecord[]>
  install(plugin: string, market: string): Promise<void>
  remove(plugin: string, market: string): Promise<void>
  setEnabled(plugin: string, market: string, enabled: boolean): Promise<void>
  pluginRoot(plugin: string, market: string): string | null
}
```

### 7.2 Claude

沿用现有 `ClaudePluginService`：`plugin install / uninstall / update`，`--plugin-dir` 加载，状态以数据库与安装目录为准。

### 7.3 Codex

- 安装：`codex plugin add <plugin>@<market>`。
- 卸载：`codex plugin remove <plugin>@<market>`。
- 启用 / 停用：改写 `<CODEX_HOME>/config.toml` 中 `[plugins."<plugin>@<market>"] enabled`。写前读取并只改这一行，其余保持原样；文件不存在视为未安装。
- 状态来源：`config.toml` 的 `enabled` + 目录存在性；`plugins/cache/<market>/<plugin>/<version>/` 的版本从目录名取。
- 会话加载：`codex app-server` 使用应用 `CODEX_HOME`，插件随会话生效；不需要额外启动参数。

### 7.4 市场列表

不解析 `codex plugin list` 的文本表格（列宽会变）。改由源服务直接读每个源的 `marketplace.json`，得到插件清单；已装状态由各适配器补齐。这样两侧同一套解析，列表也更快。

## 8. 更新检查

### 8.1 检查对象

| 类型 | 「有更新」的判据 | 执行动作 |
| --- | --- | --- |
| 插件（Claude） | 源版本号高于已装版本 | `plugin update` |
| 插件（Codex） | 源版本号高于 `cache/.../<version>` | `plugin add` 重装到新版本 |
| 技能 | 跟随所属插件；本地导入技能无来源，不参与 | 同插件 |
| 外部 MCP（内置目录） | npm / PyPI 版本高于已存 version | 现有 `applyUpdate` |
| 内置工具 | 无独立版本 | 不参与 |

### 8.2 触发时机

- 应用启动后延迟 6 秒执行一次，避免抢首屏。
- **每次启动都检查**（已确认），不做每日缓存。
- 离线、超时、非 200 都静默失败：只写 console，不弹窗。
- 同一时刻只允许一次检查；手动检查不受限制。

### 8.3 并发与超时

- 全部源刷新（git）串行，单个 180 秒超时。
- 插件版本比较不联网：刷新完成后读本地清单。
- MCP 版本查询并发上限 4，单个 8 秒超时（沿用现有实现）。

### 8.4 只提示，不自动装

「只提示，手动执行」（已确认）：

- 查到更新后发 `update:available` 事件给渲染层，渲染层显示底部提示条。
- 提示条：`3 个插件、1 个 MCP 可更新`＋「查看」「稍后」。
- 点「查看」打开设置页「更新」区，逐项列出名称、当前版本、可用版本、来源。
- 每一项都有「更新」按钮；不提供「全部更新」以外的批量入口，也不自动执行。
- 执行时显示该项进度；单项失败不中断其它项，结束时汇总「2 成功 · 1 失败（原因）」。
- 更新前后都写审计：`plugin.update` / `mcp.update`，detail 含名称与版本号。

### 8.5 未信任与安全

- 未信任的源不参与自动刷新，检查结果里标注「源未信任，跳过」。
- 未启用（停用）的插件仍参与更新检查，但更新后保持停用状态。
- 带 hooks 或 MCP 的插件更新到新版本时，仍需重新确认信任；未确认前保持停用。

## 9. IPC 与 preload

```ts
export interface PluginSourceRecord {
  id: string
  name: string
  kind: 'official' | 'git'
  url: string
  ref: string
  local: boolean
  lastSyncedAt: number | null
  lastError: string
  pluginCount: number
}

export interface PluginRecord {
  id: string
  name: string
  description: string
  version: string
  latestVersion: string
  agent: 'claude' | 'codex'
  sourceId: string
  sourceName: string
  enabled: boolean
  trusted: boolean
  installed: boolean
  hasUpdate: boolean
  components: string[]
  hasHooks: boolean
  hasMcp: boolean
  installPath: string
}

export interface UpdateCandidate {
  kind: 'plugin' | 'mcp'
  id: string
  name: string
  agent?: 'claude' | 'codex'
  current: string
  latest: string
  sourceName?: string
}
```

新增 channel（挂在 `capability` 组下，`ws` 顶级键不变）：

- `capabilityPluginSources` / `capabilityPluginSourceAdd` / `capabilityPluginSourceRefresh` / `capabilityPluginSourceRemove`
- `capabilityPlugins`（统一列表，接受 `{ agent?, sourceId?, query? }`）
- `capabilityPluginInstall` / `capabilityPluginRemove` / `capabilityPluginSetEnabled`
- `capabilityUpdatesCheck` / `capabilityUpdatesApply` / `capabilityUpdateAvailable`（主 → 渲染事件）
- `capabilityPluginScanLocal`（扫描本机）/ `capabilityPluginImport`（导入选中项）

入参校验沿用 `assertId` 模式；`agent` 只接受 `claude|codex`；URL 长度 ≤ 2000；名称 ≤ 60。

## 10. 界面

能力中心第一个标签由「Claude 插件」改为「插件」，结构：

1. **顶部**：Agent 分段（全部 / Claude / Codex）+「添加源」+「从本机导入」。
2. **源区**：每行显示名称、类型（官方 / Git / 本地）、插件数、上次刷新时间、错误徽标；行尾「刷新」「移除」（官方源无移除）。
3. **插件区**：已安装 / 市场两个子标签；「全部 Agent」时每行带 `C` / `X` 徽标；保留现有按安装量排序、分批 48 个、按名称排序。
4. **详情弹层**：复用现有源文件树 + `SKILL.md` 预览 + 组件清单；新增「版本 / 来源 / 适用 Agent / 更新可用」四行摘要。
5. **更新提示条**：底部常驻一条，仅在有待更新项时出现；带「查看」「稍后」；点「稍后」本次运行内不再提示。
6. **设置页「更新」区**：列出全部候选，逐项「更新」；顶部显示上次检查时间与「立即检查」。
7. **导入面板**：市场段 + 插件段，可勾选；顶部固定「只读本机、不修改」说明；导入后自动刷新列表并标「已导入」。

Codex 相关文案：安装位置写明「应用私有 `codex-home`，不影响你终端里的 Codex」。

样式复用 `w1-cap*` 前缀，新增 `.w1-capsrc*`、`.w1-capupd*`；1180×720 下源行与更新条不得横向溢出。

## 11. 审计

| 事件 | action | detail |
| --- | --- | --- |
| 添加 / 移除源 | `settings` | `plugin-source.add|remove name url` |
| 刷新源 | `settings` | `plugin-source.refresh name ok|fail` |
| 安装 / 卸载插件 | `settings` | `plugin.install|remove name@market` |
| 启用 / 停用插件 | `settings` | `plugin.enable|disable name@market` |
| 更新插件 / MCP | `settings` | `plugin.update name→version` / `mcp.update name→version` |
| 从本机导入 | `settings` | `plugin.import agent count` |

不记录 URL 中的凭据（Git 地址若含 `user:token@`，审计与错误文案都要抹掉）。

## 12. 安全边界

- 两种 Agent 都只写 `<data>/agent/` 下的私有目录；**任何情况下都不写 `~/.claude`、`~/.codex`**。
- 本机配置只读：导入扫描不打开写句柄，不改变 `mtime`；导入后复制进私有目录，与本机环境互不影响。
- 应用只用 `codex app-server --stdio`，从不调用 `codex app-server daemon`（后者会起共享守护进程）。
- 改写 `config.toml` 前断言路径以应用私有 `codex-home` 开头，否则抛错终止；冒烟断言真实 `~/.codex/config.toml` 的 `mtime` 全程不变。
- 插件安装、启用都要显式信任；带 hooks / MCP 的插件额外警告。
- 不执行插件内的脚本；预览只读清单与文本文件（沿用 128 KB / 二进制拒绝规则）。
- Git 命令 `shell: false`，地址白名单校验，禁止 `--upload-pack` 等可注入参数。
- 更新只提示不自动装；任何安装 / 更新都必须由用户点击。
- 源刷新失败不清空已装插件，只记录错误。

## 13. 边界情况

- **源仓库没有 `.claude-plugin/marketplace.json`**：添加失败并删除半成品目录。
- **源 plugin 的 `source` 指向仓库外**：解析时拒绝（`..` 越界），并在源行标错误。
- **同名源**：拒绝，提示改名。
- **同一插件在两个源**：以 `plugin@market` 区分，可并存。
- **插件在 Codex 侧已装但应用数据库无记录**：列表以 CLI / 缓存目录为准补录，`source_id` 留空。
- **更新源后插件被移除**：已装记录保留并标「来源已消失」，可卸载。
- **启动时无网络**：静默失败，不提示，不重试。
- **检查与安装并发**：检查期间允许安装，检查结果按 id 去重。
- **Codex 未安装**：Codex 分段显示「未检测到 codex CLI」，所有 Codex 操作禁用并给出原因。
- **本机没有 `~/.claude` 或 `~/.codex`**：导入面板显示对应段「未检测到本机配置」，另一段仍可用。
- **本机配置解析失败**：只跳过该文件并给出原因，不阻断另一段。
- **导入时源不可达**：回退为复制 cache 目录快照，标「离线导入」。
- **旧库升级**：v29 → v30 现有 Claude 插件全部保留，`agent='claude'`。

## 14. 测试与验证

### 14.1 单元测试

- `plugin-sources.test.ts`：slug 生成与冲突；URL 校验（含拒绝 `--upload-pack`）；manifest 校验（缺 `name`、非法 JSON、`source` 越界）；本地目录源不 clone；刷新失败保留旧状态。
- `plugin-adapters.test.ts`：Codex `config.toml` 只改目标行（保留其它表与注释）；缓存目录版本解析；未安装时返回空。
- `plugins.test.ts`：双 Agent 列表合并、`agent + id` 唯一、旧库升级。
- `updates.test.ts`：版本比较（含 `1.10.0 > 1.9.0`）；未信任源跳过；离线静默；只返回候选不执行。
- `import-scan.test.ts`：用临时 home 覆盖 `WS_PLUGIN_SCAN_ROOT`；解析 Claude `config.json` / `enabledPlugins`、Codex `config.toml` 的 marketplaces 与 plugins；损坏文件只跳过；断言扫描前后文件 `mtime` 与内容不变。
- `storage.test.ts`：位置文件读写与损坏回退；`WS_DATA_DIR` 优先级；路径校验矩阵（相同 / 父 / 子 / 非空 / 相对路径）；迁移成功链（复制 → 校验 → 改名 → 切换 → 删旧根）；复制后校验失败时回滚且不删旧根；残留 `.migrating-*` 清理；旧根删除失败时只提示。
- 现有 `mcp-servers.test.ts` 的版本检查用例保持通过。

### 14.2 冒烟

- 扩展 `scripts/stub-plugin-cli.cjs` 增加 Codex 分支（`plugin marketplace add|remove`、`plugin add|remove`），写入临时 `CODEX_HOME`。
- fixture 源目录放进 `scripts/fixtures/plugin-market/`（含 1 个带 SKILL.md 的插件）。
- 断言：添加本地源 → 列表出现插件 → 安装 → 已安装出现 → 详情能看到 SKILL.md → 停用 → 卸载 → 移除源；全程 `CODEX_HOME` 落在临时目录。
- 导入：`WS_PLUGIN_SCAN_ROOT` 指向临时 home（预置 `~/.claude` 与 `~/.codex` 的最小配置）→ 打开导入面板 → 勾选一个市场与一个插件 → 导入 → 列表出现且为停用未信任 → 断言两个临时 home 下的文件内容与 `mtime` 未变。
- 更新提示：stub 返回更高版本 → 启动后出现提示条 → 点「查看」进设置页 → 点「更新」→ 版本变化 → 提示条消失。

### 14.3 运行时校验

- `preload` 桥组集合不变；新增断言：`ws.capability.pluginSources` 是函数且返回数组。
- 更新断言数量。

### 14.4 真实验证（需用户同意）

- 真实 Git 第三方源：添加 → 刷新 → 安装一个插件 → 在真实 Codex 会话中确认该插件的 skill 生效。
- 官方源照旧。

### 14.5 提交前检查

`npm run typecheck`、`npm run check`、`npm test`、`npm run smoke`、`npm run verify`，以及 20 套截图。

## 15. 兼容与迁移

- DB v29 → v30 只加表与加列；现有 Claude 插件保留，`agent='claude'`。
- 旧设置页「Claude 插件」入口不变，只改标签名与内容。
- Codex 相关功能全部默认关闭，未安装 codex 时不显示任何报错。
- 未设置位置文件时目录与现状完全一致（`%APPDATA%\WorkStationForOne\data`），升级后路径不变。
- 首次设置根目录后会搬迁整个根目录；从此 `%APPDATA%\WorkStationForOne` 只剩 `location.json`。
- 版本：`0.36.0`。`package.json` 是唯一版本来源。

## 16. 影响域

| 区域 | 变更 |
| --- | --- |
| `src/main/storage/location.ts` | 新增：位置文件读写、路径校验、根目录解析 |
| `src/main/storage/migrate.ts` | 新增：复制式迁移、校验、切换、删旧根 |
| `src/main/db/index.ts` | 根目录改从统一解析取，`WS_DATA_DIR` 仍优先 |
| `src/main/index.ts` | 启动时处理 `pending`，三处派生路径改用解析结果 |
| `src/main/ipc/capability.ts` | 存储位置三个 channel + 目录选择 |
| `src/main/db/database.ts` | v30 迁移 |
| `src/main/db/capabilities.ts` | `agent` / `source_id`、源表读写 |
| `src/main/capabilities/plugins/sources.ts` | 新增：Git 源服务 |
| `src/main/capabilities/plugins/adapters.ts` | 新增：双 Agent 适配器 |
| `src/main/capabilities/plugins/updates.ts` | 新增：更新检查 |
| `src/main/capabilities/plugins/import-scan.ts` | 新增：本机配置只读扫描 |
| `src/main/capabilities/claude-plugins.ts` | 接入统一接口，保留现有 CLI 与预览 |
| `src/main/capabilities/index.ts` | 组装源服务与更新检查 |
| `src/shared/ipc.ts` | 记录类型与 channel |
| `src/preload/index.ts` | 新方法 |
| `CapabilityPanel.tsx` | 标签改名、源区、插件区、详情、更新条、导入面板 |
| `SettingsSheet.tsx` | 「更新」区、存储位置 |
| 样式 | `.w1-capsrc*`、`.w1-capupd*`、`.w1-setstorage*` |
| `scripts/stub-plugin-cli.cjs` / `smoke.cjs` / `runtime-verify.mjs` | 测试缝与断言 |
| `AGENTS.md` / `CHANGELOG.md` / `README.md` | 契约、DB v30、存储位置、验证数量 |

## 17. 待你确认的一处

**Codex 插件启用状态要改写 `config.toml`**

Codex 没有 `plugin enable` 子命令。官方配置参考把 `plugins.<plugin>.enabled` 定义为标准键（同类还有 `plugins.<plugin>.mcp_servers.<server>.enabled` 控制插件自带 MCP），社区文档也写明「禁用但不卸载用 `enabled = false`，改完重启生效」。也就是说，写这个键就是 Codex 的官方停用方式，不是旁路。

范围限定：只改**应用私有** `<data>/codex-home/config.toml`（你自己的 `~/.codex/config.toml` 永不写入），且只改目标插件的 `enabled` 行，其余内容（其它表、注释、Provider 配置）原样保留。改完提示「重启该会话生效」，与 Codex 行为一致。

需要你确认这一点。
