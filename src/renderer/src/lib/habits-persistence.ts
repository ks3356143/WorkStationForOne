import type { HabitRecord } from '../../../shared/ipc'
import { bindHabitPersistence, useWorkstation } from '../store/useWorkstation'

interface HabitBridge {
  list: () => Promise<HabitRecord[]>
  bootstrap: (habits: HabitRecord[]) => Promise<void>
  setCheckin: (id: string, day: string, done: boolean) => Promise<void>
}

function bridgeHabits(): HabitBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.ws?.habits
}

/**
 * 习惯水合：库里为空时把种子写进去，之后一律以数据库为准。
 * 与任务一样，播种后不能用内存种子覆盖界面，否则勾选的是「幽灵习惯」。
 */
export async function hydrateHabits(deps: HabitBridge | undefined = bridgeHabits()): Promise<void> {
  if (!deps) return

  bindHabitPersistence({ setCheckin: deps.setCheckin })

  try {
    const seed = useWorkstation.getState().habits
    const stored = await deps.list()
    if (stored.length === 0) {
      await deps.bootstrap(seed)
      const written = await deps.list()
      useWorkstation.setState({ habits: written })
      return
    }
    useWorkstation.setState({ habits: stored })
  } catch (error) {
    console.error('[habits] 读取失败', error)
    useWorkstation.setState({ persistenceError: '读取习惯失败，本次显示的是内存数据' })
  }
}
