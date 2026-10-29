# 学习域 v1：间隔重复闪卡

- 状态：已实现（2026-10-27）；调度已于 2026-10-29 升级为 FSRS-6（DB v14）
- 日期：2026-10-27
- 范围：学习域数据持久化、卡片管理、复习闭环、今日看板联动；不含 MCP、统计报表、导入导出

> 2026-10-29 更新：本文记录 v1 的 SM-2 设计与规则，作为历史基线；现行调度是 FSRS-6，公式与默认参数见 `shared/srs.ts` 与主设计规格 §0。

## 1. 目标与边界

让「学习与复习」从硬编码假数据变成可用的间隔重复系统：用户能建卡、按科目归类，每天打开看到真正到期的卡片，逐张翻面评分，系统按记忆规律安排下一次复习。

首屏目标（与设计文档 G2 对齐）：打开今日看板 3 秒内知道今天有多少张卡到期、大概要花多久；点「开始复习」直接进入复习态，不需要配置任何东西。

首期科目按用户实际备考内容设定：**考研英语二（204）**与**互联网知识**。前者为闭卷 180 分钟、满分 100：完形填空 10、阅读 Part A 40、阅读 Part B（新题型）10、英译汉 15、小作文 10、大作文（图表）15；大纲词汇约 5500，真题高频约 1000–2000。v1 只做「识别型」词汇卡（看到英文能反应中文），不做拼写与作文模板；考试倒计时、题型训练、真题库均不在本期。

非目标：FSRS 参数拟合、Anki/CSV 导入、复习统计图表、到期提醒推送、学习域 MCP 工具（`learning_due` / `learning_review` 留到 MCP 阶段）、习惯域。

## 2. 导航与视图

- `View` 增加 `'learning'`，顺序为 **今日 / 任务 / Agent / 笔记 / 学习**，编号 01–05；现有四项编号不变。
- `WorkspaceNav` 的 `VIEWS` 增加学习项，meta 显示 `${dueCount} 张到期`（无到期时显示 `今日已完成`）。
- 新增 `LearningView` 占满工作区，内部两态：**卡片库**（默认）与 **复习**。两态在同一个视图内切换，不弹窗、不新增右侧常驻栏。
- 命令面板增加「打开学习」「开始复习」两条命令；`runtime-verify` 与冒烟的五视图互斥断言同步更新。

## 3. 数据模型（迁移 v7）

沿用设计文档 §8.2 的预留表，按本地日期存复习日（与任务 `due_date` 同一套约定，不用时间戳）。

```sql
CREATE TABLE learning_items (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  repetitions INTEGER NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  interval_days INTEGER NOT NULL DEFAULT 0 CHECK (interval_days BETWEEN 0 AND 365),
  ease REAL NOT NULL DEFAULT 2.5 CHECK (ease BETWEEN 1.3 AND 3.0),
  next_review_on TEXT NOT NULL CHECK (next_review_on GLOB '????-??-??'),
  last_reviewed_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_learning_due ON learning_items(active, next_review_on);
CREATE INDEX idx_learning_subject ON learning_items(subject, active);

CREATE TABLE learning_reviews (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at INTEGER NOT NULL
);

CREATE INDEX idx_learning_reviews_item ON learning_reviews(item_id, reviewed_at DESC);
```

- `subject` 即科目（`英语二`、`互联网`）；`title` 是卡片正面（词/概念），`notes` 是背面（释义、例句、解释）。
- `active = 0` 表示停用，不进入到期队列；v1 不做硬删除，停用即「收起来」。
- 迁移不替用户补数据。种子仅在空库写入，共 24 张：英语二 16 个考研真题高频词（`analyze / significant / consequence / approach / maintain / consume / decline / evidence / factor / indicate / involve / issue / occur / require / respond / tend`），每张配自写的中文释义与一句真题风格例句；互联网 8 个概念（HTTP、DNS、TLS、CDN、缓存、幂等、限流、CAP）。全部自写，不搬运版权词表。
- 种子的 `next_review_on` 为相对今天的混合值（约 7 张今天到期、其余分散在未来 1–14 天），保证首次启动即可复习。

## 4. 调度规则（`src/shared/srs.ts`）

纯函数，主进程执行，渲染进程只用于展示间隔预览。

```ts
export interface SrsState {
  repetitions: number
  intervalDays: number
  ease: number
}
export interface SrsResult extends SrsState {
  nextReviewOn: string
}
export function scheduleReview(
  state: SrsState,
  rating: 1 | 2 | 3 | 4,
  today: string
): SrsResult
```

规则（`today` 为本地日期键，间隔上限 365 天，ease 限制在 1.3–3.0）：

| 评分 | repetitions | intervalDays | ease | nextReviewOn |
| --- | --- | --- | --- | --- |
| 1 重来 | 归零 | 0 | −0.20 | 今天（留在到期队列） |
| 2 困难 | +1 | 首次 1、二次 6、之后 `round(prev × 1.2)` | −0.14 | today + interval |
| 3 良好 | +1 | 首次 1、二次 6、之后 `round(prev × ease)` | 不变 | today + interval |
| 4 简单 | +1 | 首次 2、二次 8、之后 `round(prev × ease × 1.3)` | +0.10 | today + interval |

所有间隔取整后至少 1 天（重来为 0），最多 365 天。日期推进复用 `shared/date-key.ts` 的 `addDaysKey`，不经过 UTC 时间戳。

「重来」只在**本场复习队列**里排到队尾，不新增跨天排期；它在库里的 `next_review_on` 仍是今天，因此今天剩余到期数不会因重来而减少，关闭应用后重新进入依然到期。

## 5. 到期队列与展示派生（`src/renderer/src/lib/learning.ts`）

```ts
export interface LearningItem { id, subject, title, source, notes, repetitions, intervalDays, ease, nextReviewOn, lastReviewedAt?, active }
export type LearningScope = { kind: 'all' } | { kind: 'inactive' } | { kind: 'subject'; subject: string }
export function dueQueue(items: LearningItem[], today: string): LearningItem[]
export function estimatedMinutes(dueCount: number): number
export function subjectBreakdown(items: LearningItem[]): { subject: string; count: number }[]
export function filterItems(items: LearningItem[], scope: LearningScope, query: string): LearningItem[]
```

- `dueQueue`：`active` 且 `nextReviewOn <= today`，按 `nextReviewOn` 升序、`ease` 升序（难的先来）、`title` 升序；上限 50 张（与设计文档 `learning_due` 一致）。
- `estimatedMinutes`：每张 1.5 分钟，向上取整；0 张为 0。
- `subjectBreakdown`：按到期数降序、科目名次之；今日卡最多显示三堆，其余并入「其他」。
- `filterItems`：`inactive` 只列停用卡，且忽略到期日；`subject` 列该科目下的启用卡；`all` 列全部启用卡；`query` 去空白后按标题/来源/备注做大小写不敏感的子串匹配。
- 左栏科目顺序：科目名按到期数降序，再按名称升序；「全部」「已停用」固定在最前与最后。
- 复习会话开始时对 `dueQueue` 做一次快照，本场只处理快照；评分 1 的卡重新排到快照队尾。

## 6. IPC 契约

`src/shared/ipc.ts` 新增：

```ts
export interface LearningItemRecord {
  id: string
  subject: string
  title: string
  source?: string
  notes?: string
  repetitions: number
  intervalDays: number
  ease: number
  nextReviewOn: string
  lastReviewedAt?: number
  active: boolean
}
export interface LearningDraft {
  subject: string
  title: string
  source?: string
  notes?: string
  nextReviewOn?: string
}
export interface LearningPatch {
  subject?: string
  title?: string
  source?: string
  notes?: string
  nextReviewOn?: string
  active?: boolean
}
export interface LearningApi {
  list: () => Promise<LearningItemRecord[]>
  bootstrap: (items: LearningItemRecord[]) => Promise<void>
  create: (draft: LearningDraft) => Promise<LearningItemRecord>
  update: (id: string, patch: LearningPatch) => Promise<void>
  review: (id: string, rating: 1 | 2 | 3 | 4) => Promise<LearningItemRecord>
}
```

- `WsApi` 增加 `learning`；preload 桥从 `tasks / notes / capture / app` 变为五组，`runtime-verify` 的键集合断言同步改为 `app, capture, learning, notes, tasks`。
- `create` 未传 `nextReviewOn` 时默认今天，新卡立即进入到期队列；传入时按传入日期。
- 主进程校验（`src/main/ipc/learning.ts`）：id 非空字符串；`subject` 去空白后 1–40 字；`title` 1–200 字；`source` / `notes` ≤ 2000 字；`nextReviewOn` 必须匹配 `YYYY-MM-DD`；`rating` 为 1–4 整数；`active` 为布尔。
- `review` 不接收日期：主进程用 `shared/date-key.ts` 的 `dateKey()` 取本机当天，作为调度基准，渲染进程无法伪造「今天」。事务内按当前卡计算 `scheduleReview` → 更新 `learning_items` → 插入 `learning_reviews`（`reviewed_at = Date.now()`）→ 返回更新后的记录。评分 1 不改 `next_review_on`。
- 渲染进程不直接持有复习算法结果，只展示返回记录；无 preload 时与任务/笔记一致，停留在内存种子并记录 `persistenceError`。

## 7. 界面

### 7.1 学习工作区 · 卡片库

- 布局沿用任务视图的「左侧清单栏 + 右侧列表」：左栏为科目（全部 / 英语二 / 互联网 / 其它实际科目 / 已停用），右栏为卡片列表。
- 列表行：正面标题（主）、`source`（次）、下次复习日（今天/明天/逾期/具体日期，口径集中在 `lib/learning.ts`）、当前间隔（`0 天` / `6 天`）。行首方点标记；停用卡整体降透明度。
- 顶部：搜索框（按标题/来源/备注过滤，Esc 清空）、`新建卡片` 按钮、到期数摘要。
- 行内展开编辑：科目、正面、来源、背面、下次复习日（今天/明天/清除）；保存 / 取消 / 停用（或启用）。新建卡片在同一区域展开空表单，不用弹窗。
- 空状态：无卡片时提示「先建一张卡，明天就能开始复习」；搜索无结果提示「没有匹配的卡片」。

### 7.2 学习工作区 · 复习态

- 顶部进度 `3 / 12`、科目标签、`退出复习`（Esc）。
- 大卡正面只显示 `title`；点「显示答案」或按 `Space` 翻面，背面显示 `source` 与 `notes`。
- 翻面后四个评分按钮：重来 / 困难 / 良好 / 简单，按钮上显示本次将产生的间隔（用 `scheduleReview` 预览，如 `1 天`、`6 天`、`16 天`、`35 天`）；键盘 `1`–`4` 直接评分。
- 评分 1 的卡排到本场队尾；其余卡从队列移除。队列清空后显示完成态：本场张数、重来次数、耗时，按钮「回到卡片库」。
- 队列为空时进入复习态直接显示「今天没有到期卡片」并给回卡片库的入口。

### 7.3 今日看板 · 学习与复习卡

- 数据来自 `learningItems`：到期数用 `dueQueue`，预计时长用 `estimatedMinutes`，堆叠条按 `subjectBreakdown` 前三分段（无到期时显示「今天没有到期卡片」）。
- `开始复习` 调用 store 的 `startLearningReview()`：`activeView = 'learning'` 且复习态打开。
- 卡片位置、尺寸与现有两列布局不变；不新增第三列。

### 7.4 视觉与动效

- 复用现有玻璃卡、行、方点与 `--ease-*` / `--dur-*`；新增 `styles/sections/17-learning.css`，颜色全部走令牌，不写死 `rgba()`，不做深浅主题分支。
- 翻面用 `m` 的 opacity/transform 过渡，系统减少动效或 `motion-off` 时直接切换；评分后下一张卡用现有 `withViewTransition` 之外的轻量淡入，不引入新依赖。
- 新增的玻璃表面若使用 `backdrop-filter`，同步补进 `12-accessibility.css` 的实色回退清单；1180×720 下两者都不得横向溢出。

## 8. 影响域

| 区域 | 变更 |
| --- | --- |
| `src/shared/ipc.ts` | `LearningApi`、IPC 通道、`WsApi.learning` |
| `src/preload/index.ts` | 暴露 `learning` 五组桥 |
| `src/main` | 迁移 v7、`db/learning.ts`、`ipc/learning.ts`、注册 handler |
| `src/shared/srs.ts` | 新纯函数 |
| `src/renderer/src/types.ts` | `View` 增加 `learning` |
| `App.tsx` / `WorkspaceNav.tsx` / `CommandPalette.tsx` | 第五视图渲染、导航、命令 |
| `TodayDashboard` / `ReviewCard` | 真实数据 + 开始复习入口 |
| store | `learningItems`、`learningReady`、`learningReviewOpen`、`hydrateLearning`、`startLearningReview` |
| 样式 | 新增 `17-learning.css`，补无障碍回退与 1180 响应式 |
| 脚本 | `smoke.cjs` 五入口与复习断言、`runtime-verify` 桥键与五视图断言 |
| 文档 | AGENTS.md（五视图契约、学习域规则）、README、CHANGELOG |

## 9. 验证

- 单测：`shared/srs.test.ts`（四档评分、ease 上下限、间隔上限、跨月跨年日期、重来留在今天）；`lib/learning.test.ts`（到期过滤、排序、时长、科目分组、搜索/停用过滤）；`db/learning.test.ts`（v7 迁移、create/update/停用、review 事务双写、外键级联）；`ipc/learning.test.ts`（入参校验）。
- 冒烟（真实主进程 + 临时 SQLite）：第五入口存在且互斥；进入学习视图；新建卡片落库；开始复习 → 翻面 → 评分 → `learning_reviews` 有新行且 `next_review_on` 前移；今日卡到期数随评分变化；Esc 退出复习。
- `runtime-verify`：preload 五组桥、五视图互斥、`aria-current`、命令面板跳转、双主题持久化。
- 截图：40 张矩阵（5 视图 × 双主题 × 双尺寸 × 双皮肤）+ 复习态与空状态各一张，两尺寸检查溢出与控制台。
- 全部通过后提交并推送。

## 10. 关键代码位置

- 调度：`src/shared/srs.ts`
- 派生：`src/renderer/src/lib/learning.ts`
- 数据：`src/main/db/learning.ts`、迁移在 `src/main/db/database.ts`
- IPC：`src/main/ipc/learning.ts`、`src/shared/ipc.ts`、`src/preload/index.ts`
- UI：`src/renderer/src/components/learning/LearningView.tsx`、`LearningItem.tsx`、`ReviewSession.tsx`；今日卡 `ReviewCard.tsx`
- 种子：`src/renderer/src/data/seed/learning.ts`，由 `data/mock.ts` 汇入
