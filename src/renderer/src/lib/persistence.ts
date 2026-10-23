import { replaceTasks, bindTaskPersistence, useWorkstation } from '../store/useWorkstation'
import type { TaskRecord } from '../../../shared/ipc'
import type { Task } from '../types'

export interface HydrateDeps {
  list: () => Promise<TaskRecord[]>
  bootstrap: (tasks: TaskRecord[]) => Promise<void>
  setDone: (id: string, done: boolean) => Promise<void>
  applySchedule: (changes: { taskId: string; toTime: string; toTag: string }[]) => Promise<void>
}

export async function hydrateTasks(deps: HydrateDeps | undefined = bridgeTasks()): Promise<void> {
  if (!deps) return

  bindTaskPersistence({ setDone: deps.setDone, applySchedule: deps.applySchedule })

  try {
    const initial = useWorkstation.getState().tasks
    const stored = await deps.list()

    if (stored.length === 0) {
      await deps.bootstrap(initial)
      return
    }

    replaceTasks(stored satisfies Task[])
  } catch (error) {
    console.error('[persistence] 任务读取失败，使用内存种子数据', error)
  }
}

function bridgeTasks(): HydrateDeps | undefined {
  return typeof window === 'undefined' ? undefined : window.ws?.tasks
}
