# 渲染层审批队列与孤儿图片回收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一会话并发到达的多张工具审批卡不再互相覆盖（渲染层排队逐张应答），未发送/被移除的图片附件不再永久孤儿化。

**Architecture:** 审批排队放在渲染层 store：`toolPermissions[sessionId]` 仍保存「当前展示的一张」，新增 `toolPermissionQueues[sessionId]` 保存等待队列；主进程 `permissionRuns` 不变（它本就保留全部待答请求），因此无需改主进程发卡逻辑。图片回收双保险：移除附件 chip 时走新增窄 IPC `agent:discard-image` 立即删未被引用文件；启动时 `pruneOrphanImages` 扫描私有目录删除无任何消息引用的文件（兜底崩溃/切会话丢失状态）。

**Tech Stack:** Electron 45 / React 19 / TypeScript / Zustand / node:sqlite / Vitest / Biome。

**Spec:** 以 `AGENTS.md`「UI 契约 / 架构与约定 / 安全与进程边界」为 governing contract；缺陷来源为本轮代码审查（渲染层 `toolPermissions` 单值覆盖、`saveImage` 立即落盘无回收）。

## Global Constraints

- 中文优先文案；不引入 UI 组件库；颜色走令牌；保持 sandbox/contextIsolation/nodeIntegration 边界。
- 渲染层不碰文件系统/数据库；图片删除只能经窄 preload 桥，主进程校验「无消息引用」后才删。
- 入参校验统一 `src/main/validate.ts`；图片 id 复用 `images.ts` 的 `pathOf` 校验（`img-` + UUID）。
- 每个任务先写失败测试再实现；任务结束跑 `npm run typecheck && npm run check && npm test`；界面/交互改动另跑 `npm run smoke`，外壳/导航改动跑 `npm run verify`。
- 不主动 `git commit` / `git push`，除非用户明确要求（本计划步骤里的 commit 仅在用户批准提交后执行）。
- 版本按 `package.json` 单一来源；功能修订 bump minor（0.73.0），由用户确认发布时再改。

---

## File Structure

- Create: `src/renderer/src/store/approval-queue.test.ts` — store 审批排队行为测试。
- Modify: `src/renderer/src/types.ts:225` — `WorkstationData` 增加 `toolPermissionQueues`。
- Modify: `src/renderer/src/data/mock.ts:51`、`src/renderer/src/lib/agent-persistence.ts:65,83` — 种子/水合补 `toolPermissionQueues: {}`。
- Modify: `src/renderer/src/store/useWorkstation.ts` — `setToolPermission`/`clearToolPermission` 排队/提升；`finishAgentReply`/删除/归档清理队列。
- Create: `src/main/agent/images.test.ts` 追加 prune 用例（或新建）；Modify `src/main/agent/images.ts` — `pruneOrphanImages`。
- Modify: `src/shared/ipc/channels.ts:70`、`src/shared/ipc/agent.ts:375`、`src/preload/index.ts:118` — `agent:discard-image`。
- Modify: `src/main/ipc/agent.ts` — discard handler；`src/main/index.ts` — 启动 prune。
- Modify: `src/renderer/src/components/agent/Composer.tsx:271` — 移除 chip 调 `discardImage`。

---

### Task 1: 渲染层审批排队

**Files:**
- Create: `src/renderer/src/store/approval-queue.test.ts`
- Modify: `src/renderer/src/types.ts:225`, `src/renderer/src/data/mock.ts:51`, `src/renderer/src/lib/agent-persistence.ts:65,83`, `src/renderer/src/store/useWorkstation.ts:952-976,787-809,845-873`

**Interfaces:**
- Consumes: `ToolPermission`（types.ts）、现有 `setToolPermission(sessionId, request)` / `clearToolPermission(sessionId)` 签名不变。
- Produces: `WorkstationData.toolPermissionQueues: Record<string, ToolPermission[]>`；`clearToolPermission` 应答后自动提升队首为当前卡。

- [ ] **Step 1: 写失败测试** `src/renderer/src/store/approval-queue.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkstation } from './useWorkstation'

const req = (id: string) =>
  ({ requestId: id, sessionId: 's1', toolName: 'Write', detail: '', inputPreview: '' }) as never

beforeEach(() => {
  useWorkstation.setState({ toolPermissions: {}, toolPermissionQueues: {} } as never)
})

describe('同会话审批排队', () => {
  it('第二张卡进入队列而不覆盖第一张', () => {
    useWorkstation.getState().setToolPermission('s1', req('a'))
    useWorkstation.getState().setToolPermission('s1', req('b'))
    const s = useWorkstation.getState()
    expect(s.toolPermissions.s1.requestId).toBe('a')
    expect(s.toolPermissionQueues.s1.map((r) => r.requestId)).toEqual(['b'])
  })

  it('应答当前卡后提升队首', () => {
    useWorkstation.getState().setToolPermission('s1', req('a'))
    useWorkstation.getState().setToolPermission('s1', req('b'))
    useWorkstation.getState().clearToolPermission('s1')
    const s = useWorkstation.getState()
    expect(s.toolPermissions.s1.requestId).toBe('b')
    expect(s.toolPermissionQueues.s1 ?? []).toEqual([])
  })

  it('无队列时清空当前卡', () => {
    useWorkstation.getState().setToolPermission('s1', req('a'))
    useWorkstation.getState().clearToolPermission('s1')
    expect(useWorkstation.getState().toolPermissions.s1).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败** Run: `npm test -- src/renderer/src/store/approval-queue.test.ts`。Expected: FAIL（`toolPermissionQueues` 不存在 / 第二张覆盖第一张）。

- [ ] **Step 3: 加类型与种子** types.ts:225 旁加 `toolPermissionQueues: Record<string, ToolPermission[]>`；mock.ts:51 与 agent-persistence.ts:65,83 各加 `toolPermissionQueues: {}`。

- [ ] **Step 4: 实现排队/提升** useWorkstation.ts:952 起替换两个 action：

```ts
setToolPermission: (sessionId, request) =>
  set((state) => {
    const entry = { ...request, sessionId }
    if (state.toolPermissions[sessionId]) {
      return {
        toolPermissionQueues: {
          ...state.toolPermissionQueues,
          [sessionId]: [...(state.toolPermissionQueues[sessionId] ?? []), entry]
        },
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, status: 'wait' as const } : s
        )
      }
    }
    return {
      toolPermissions: { ...state.toolPermissions, [sessionId]: entry },
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'wait' as const } : s
      )
    }
  }),

clearToolPermission: (sessionId) =>
  set((state) => {
    const toolPermissions = { ...state.toolPermissions }
    delete toolPermissions[sessionId]
    const queue = [...(state.toolPermissionQueues[sessionId] ?? [])]
    const next = queue.shift()
    const toolPermissionQueues = { ...state.toolPermissionQueues }
    if (next) toolPermissions[sessionId] = next
    if (queue.length) toolPermissionQueues[sessionId] = queue
    else delete toolPermissionQueues[sessionId]
    const waiting = Boolean(
      next || state.mcpPermissions[sessionId] || state.agentQuestions[sessionId]
    )
    return {
      toolPermissions,
      toolPermissionQueues,
      sessions: state.sessions.map((s) =>
        s.id === sessionId && s.status === 'wait' && !waiting
          ? { ...s, status: 'run' as const }
          : s
      )
    }
  }),
```

- [ ] **Step 5: 跑测试确认通过** Run: `npm test -- src/renderer/src/store/approval-queue.test.ts`。Expected: PASS。

- [ ] **Step 6: 清理路径同步删队列** 在 useWorkstation.ts:787-809（finishAgentReply）与 845-873（删除/归档）两处，仿照 `delete toolPermissions[sessionId]` 增加 `const toolPermissionQueues = { ...state.toolPermissionQueues }; delete toolPermissionQueues[sessionId]` 并并入返回对象。

- [ ] **Step 7: 全量检查** Run: `npm run typecheck && npm run check && npm test`。Expected: 全绿。

- [ ] **Step 8: 冒烟回归** Run: `npm run smoke`。Expected: 545 项 0 失败（审批链路不变，单卡场景不受影响）。

- [ ] **Step 9: Commit（仅用户批准后）** `git add` 上述文件，message: `fix: 同会话工具审批排队逐张应答，避免并发卡互相覆盖`。

---

### Task 2: 孤儿图片回收

**Files:**
- Modify: `src/main/agent/images.ts`（加 `pruneOrphanImages`）
- Create/Modify: `src/main/agent/images.test.ts`
- Modify: `src/shared/ipc/channels.ts:70`, `src/shared/ipc/agent.ts:375`, `src/preload/index.ts:118`, `src/main/ipc/agent.ts`, `src/main/index.ts`, `src/renderer/src/components/agent/Composer.tsx:271`

**Interfaces:**
- Consumes: `repository.listImageRefs(): AgentImageRef[]`（db/agent.ts:632）、`removeImage(dir, image)`（images.ts:61）。
- Produces: `pruneOrphanImages(dir: string, refs: AgentImageRef[]): number`；preload `agent.discardImage(image: AgentImageRef): Promise<boolean>`；channel `agentDiscardImage: 'agent:discard-image'`。

- [ ] **Step 1: 写失败测试** `src/main/agent/images.test.ts`

```ts
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pruneOrphanImages, saveImage } from './images'

describe('pruneOrphanImages', () => {
  it('只删未被引用的图片，保留被引用与非法文件名', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-img-'))
    const kept = saveImage(dir, { mime: 'image/png', data: Buffer.from('x').toString('base64') })
    const orphan = saveImage(dir, { mime: 'image/png', data: Buffer.from('y').toString('base64') })
    writeFileSync(join(dir, 'notes.txt'), 'not an image')
    const removed = pruneOrphanImages(dir, [kept])
    expect(removed).toBe(1)
    expect(existsSync(join(dir, `${kept.id}.png`))).toBe(true)
    expect(existsSync(join(dir, `${orphan.id}.png`))).toBe(false)
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 跑确认失败** Run: `npm test -- src/main/agent/images.test.ts`。Expected: FAIL（`pruneOrphanImages` 未导出）。

- [ ] **Step 3: 实现 prune** images.ts 追加：

```ts
/** 启动兜底：删除目录里没有任何消息引用的 img-* 文件；返回删除数量。 */
export function pruneOrphanImages(dir: string, refs: AgentImageRef[]): number {
  const referenced = new Set(refs.map((image) => image.id))
  let removed = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of entries) {
    const match = /^(img-[0-9a-f-]{36})\.(png|jpg|webp|gif)$/.exec(name)
    if (!match || referenced.has(match[1])) continue
    try {
      rmSync(join(dir, name))
      removed += 1
    } catch {
      // 单个文件删除失败不阻断启动
    }
  }
  return removed
}
```

（images.ts 顶部 import 补 `readdirSync`。）

- [ ] **Step 4: 跑确认通过** Run: `npm test -- src/main/agent/images.test.ts`。Expected: PASS。

- [ ] **Step 5: 加窄 IPC** channels.ts:70 加 `agentDiscardImage: 'agent:discard-image'`；shared/ipc/agent.ts:375 的 AgentApi 加 `discardImage: (image: AgentImageRef) => Promise<boolean>`；preload/index.ts:118 加 `discardImage: (image) => ipcRenderer.invoke(IPC_CHANNELS.agentDiscardImage, image)`。

- [ ] **Step 6: 主进程 handler** ipc/agent.ts 注册：

```ts
ipcMain.handle(IPC_CHANNELS.agentDiscardImage, (_e, value: unknown) => {
  const image = assertRecord(value, '图片引用')
  const ref = {
    id: assertAgentId(image.id, '图片 id'),
    name: typeof image.name === 'string' ? image.name : 'image',
    mime: typeof image.mime === 'string' ? image.mime : 'image/png',
    size: typeof image.size === 'number' ? image.size : 0
  }
  if (repository.listImageRefs().some((item) => item.id === ref.id)) return false
  return removeImage(imagesDir, ref)
})
```

- [ ] **Step 7: 启动 prune** main/index.ts 在数据库就绪后调用 `pruneOrphanImages(imagesDir, repository.listImageRefs())`（imagesDir 与 ipc/agent.ts 同源派生），结果只记 console，不阻断启动。

- [ ] **Step 8: Composer 移除 chip 调 discard** Composer.tsx:271 的 onClick 改为：

```tsx
onClick={() => {
  setImages((list) => list.filter((item) => item.id !== image.id))
  void bridge?.discardImage(image)
}}
```

- [ ] **Step 9: 全量检查** Run: `npm run typecheck && npm run check && npm test`。Expected: 全绿。

- [ ] **Step 10: 冒烟回归** Run: `npm run smoke`。Expected: 图片附件链路 0 失败（移除 chip 现在会删文件，冒烟若断言文件存在需同步调整）。

- [ ] **Step 11: Commit（仅用户批准后）** message: `fix: 回收未发送/被移除的图片附件，启动清理孤儿图片`。

---

## Self-Review

- Spec 覆盖：审批单值覆盖 → Task 1；孤儿图片（chip 移除 + 切会话/崩溃）→ Task 2（discard + 启动 prune）。无遗漏。
- 类型一致：`toolPermissionQueues` 在 types/mock/水合/store 一致；`discardImage` 在 channel/preload/shared/handler/Composer 一致；`pruneOrphanImages(dir, refs)` 签名一致。
- 无占位符；所有代码步给出实际代码。