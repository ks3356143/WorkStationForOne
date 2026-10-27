import { bindLearningPersistence, useWorkstation } from '../store/useWorkstation'
import type {
  LearningDraft,
  LearningItemRecord,
  LearningPatch,
  LearningRating
} from '../../../shared/ipc'
import type { LearningItem } from '../types'

export interface HydrateLearningDeps {
  list: () => Promise<LearningItemRecord[]>
  bootstrap: (items: LearningItemRecord[]) => Promise<void>
  create: (draft: LearningDraft) => Promise<LearningItemRecord>
  update: (id: string, patch: LearningPatch) => Promise<void>
  review: (id: string, rating: LearningRating) => Promise<LearningItemRecord>
}

export async function hydrateLearning(
  deps: HydrateLearningDeps | undefined = bridgeLearning()
): Promise<void> {
  if (!deps) return

  bindLearningPersistence({ create: deps.create, update: deps.update, review: deps.review })

  try {
    const stored = await deps.list()
    if (stored.length === 0) {
      await deps.bootstrap(useWorkstation.getState().learningItems)
      // 空库也可能读到空：停用卡全部被清掉时不能让种子借机复活。
      replaceLearning(await deps.list())
      return
    }
    replaceLearning(stored)
  } catch (error) {
    console.error('[persistence] 学习卡片读取失败，使用内存种子数据', error)
  }
}

export function replaceLearning(items: LearningItemRecord[]): void {
  useWorkstation.setState({ learningItems: items satisfies LearningItem[], learningReady: true })
}

function bridgeLearning(): HydrateLearningDeps | undefined {
  return typeof window === 'undefined' ? undefined : window.ws?.learning
}
