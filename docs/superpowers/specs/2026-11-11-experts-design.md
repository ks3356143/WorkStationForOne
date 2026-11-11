# 「xx专家」与轻量专家市场 设计（v0.80.0）

日期：2026-11-11
状态：已获用户批准（全局激活 / 内置4个+自定义 / 本轮带轻量市场 / 参考 Coze 与 Claude 子代理社区）。

## 目标与边界

把「专家」做成可一键切换的打包：**人设提示词 + 默认 skill/MCP 工具组合 + ★优先**，复用现有
preset → 新建会话、全局工具面、`--append-system-prompt`/`developerInstructions` 三条管道，不新增智能、
不新增下载机制。另带一个轻量专家市场：Git 源里的 Claude 子代理 `.md` 目录，可浏览 + 一键导入。

参考范式：
- Coze/扣子：智能体 = 人设 + 插件 + 知识库；商店 = 浏览 + 一键复制。
- Claude Code 子代理社区：专家 = Markdown（YAML frontmatter `name/description/tools` + 正文人设），
  社区仓库（awesome-claude-code-subagents 等）已有上百个现成专家，作为推荐市场源。

非目标（本轮不做）：每会话独立工具面、远程市场更新/评分、知识库/RAG、工作流编排、微调模型。

## 交换格式（纯函数解析，可单测）

专家定义采用 Claude 子代理 `.md`：

```
---
name: backend-go-rust
description: Go/Rust 后端专家…
tools: Read, Grep, Glob, Bash        # 原生工具提示，仅展示，不直接映射★
mcp: [context7, deepwiki]            # 可选，我们的★激活键（mcp:<id>）
skills: [document-skills]            # 可选（skill:<id>）
---
（正文 = 人设 system prompt）
```

- `shared/expert-format.ts`：`parseExpertMarkdown(text): ExpertDef | null`（frontmatter 用最小 YAML
  子集解析：字符串/数组；不引重型 YAML 库），`serializeExpertMarkdown(def): string`。
- `ExpertDef { id, name, description, persona, tools: string[] /* mcp:/skill: 键 */, builtin?: boolean }`。
  原生 `tools` 行只作展示提示，不参与激活（激活只用 mcp/skill 键）。
- `shared/experts.ts`：`BUILTIN_EXPERTS`（前端 / Office / 运维 / 后端Go-Rust）用同格式 authored；
  `resolveExpertTools(keys, installedMcpIds, installedSkillIds)` 纯函数 → `{ apply: {key,kind,id}[], missing: string[] }`。

## 数据（DB v48，一次迁移）

- `agent_experts(id PK, name, description, persona, tools_json, builtin INTEGER DEFAULT 0, created_at, updated_at)`。
  内置不入库，列表时与自定义合并；导入/自定义 builtin=0。
- `agent_sessions` 增加 `persona TEXT NOT NULL DEFAULT ''`（会话级人设快照）。
- `expert_sources(id PK, name, url, ref, root, last_synced_at, last_error, created_at, updated_at)`，
  复用插件源的克隆/白名单/离线语义（`sources.ts` 的 `cloneSource/refreshSource/validateSourceUrl`）。

## 主进程服务

- `ExpertService`（`main/capabilities/experts.ts`）：
  - `list()`：内置 + `agent_experts`。
  - `save/remove`：仅自定义（builtin 拒绝删除/覆盖）。
  - `importMarkdown(text)`：解析 → 去重 id → 落库 builtin=0。
  - `export(id)`：序列化为 `.md` 文本（渲染层走保存对话框，主进程写文件，复用导出模式）。
- `ExpertMarketService`（同文件或 `expert-market.ts`）：
  - `addSource/removeSource/refresh`：克隆/刷新 Git 源，扫描 `**/*.md`（限深/限量，跳过 node_modules/.git），
    逐个 `parseExpertMarkdown`，失败跳过并计数；结果缓存 + `last_error` 可读。
  - `list()`：合并各源条目（带 source 名）+ 推荐源（社区仓库）提示。
  - `importEntry(sourceId, relPath)`：读文件 → `importMarkdown`。
- 激活 `activateExpert(agent, def)`：`resolveExpertTools` 后逐个——MCP 仅**已信任**才 `mcp.setEnabled(id,true)`
  （不自动信任），技能 `skills.setEnabled(id,true)`，再 `toolSurface.setPreferred(agent,key,true)`；
  返回 `{applied,missing}`。失败单条不阻断，汇总提示。
- 会话人设：`createSession` 接受 `persona`；发送路径（`ipc/agent.ts` 现有 `toolPriority` 处）把
  `session.persona` 拼到 `toolPriority` 前，同走 Claude `appendSystemPrompt` / Codex `developerInstructions`。

## IPC / preload

`shared/ipc/agent.ts`（或新 `experts.ts` 域）+ `channels.ts` + preload 窄桥：
`experts.list/save/remove/import/export`、`expertMarket.sources/addSource/removeSource/refresh/list/import`、
`experts.activate`、`createSession` 增加 `persona`。入参校验走 `main/validate.ts`。

## UI（FleetSheet，复用能力中心市场视觉）

- 「专家」区：内置+自定义卡片/行（名称/描述/工具徽标），一键「用此专家新建会话」（=激活+带人设建会话），
  自定义可新建/编辑/删除/导出；新建/编辑表单：name+description+人设 textarea+从已装 mcp/skill 多选。
- 「市场」视图：源管理（添加/移除/刷新）+ 条目浏览（搜索/按源过滤）+ 一键导入；导入后 toast 如实报告。
- 激活结果 toast：`已启用 N 项 · 缺失/未信任 M 项（列出）`。
- 中文优先、极光 HUD 令牌、`w1-` 前缀类名；改前 grep 防同名覆盖；双尺寸截图。

## 安全

- 导入/市场只落数据不执行；激活不自动信任 MCP；源地址走现有白名单 + `GIT_TERMINAL_PROMPT=0`、`shell:false`。
- 不写 `~/.claude`/`~/.codex`；人设/描述不含密钥（导入时不校验密钥但激活不注入任何 token）。
- 市场扫描限深/限量，拒绝越界路径（复用 `assertInsideRoot`）。

## 测试与验证

- 单测：`parseExpertMarkdown`/`serialize` 往返、`resolveExpertTools`（缺失/未信任/混合）、内置数据合法性、
  迁移 v48、激活只启用已信任。
- 冒烟：专家区渲染、自定义新建/删除、导入落库、专家会话 stub 收到人设、激活★落库、市场源添加/浏览/导入。
- 完整矩阵：typecheck / Biome / 全量单测 / 563+ 冒烟双尺寸双主题 / 250 verify；双尺寸截图。

## 实施清单（TDD，先红后绿）

1. `shared/expert-format.ts` + `experts.ts` + 单测。
2. DB v48 迁移 + 仓储 + 单测。
3. `ExpertService`/`ExpertMarketService` + 激活 + 单测。
4. IPC/preload/validate + 会话 persona 注入。
5. FleetSheet 专家区 + 市场视图 + 样式。
6. 冒烟 + 截图 + 完整验证 + 文档（CHANGELOG/README/status/AGENTS）+ 版本 0.80.0。