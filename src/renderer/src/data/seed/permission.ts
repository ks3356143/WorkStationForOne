import type { Permission } from '../../types'

export function createSeedPermission(): Permission {
  return {
    id: 'perm-1',
    sessionId: 's-c1',
    source: 'Claude Code',
    body: '3 项任务时间变更。任务区可写；学习区保持未改动。',
    requestedAt: '14:10',
    changes: [
      { taskId: 't8', fromLabel: '今天', toLabel: '明天 09:00', toTime: '09:00', toTag: '明天' },
      { taskId: 't6', fromLabel: '21:00', toLabel: '22:00', toTime: '22:00', toTag: '已顺延' },
      { taskId: 't7', fromLabel: '今天', toLabel: '明天 20:00', toTime: '20:00', toTag: '明天' }
    ]
  }
}
