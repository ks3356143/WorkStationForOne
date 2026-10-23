import type { Session } from '../types'

export interface FleetSummary {
  total: number
  running: number
  waiting: number
  idle: number
  waitingSessionId: string | null
}

export function summarizeFleet(sessions: Session[]): FleetSummary {
  let running = 0
  let waiting = 0
  let idle = 0
  let waitingSessionId: string | null = null

  for (const session of sessions) {
    if (session.status === 'run') running += 1
    else if (session.status === 'wait') {
      waiting += 1
      waitingSessionId ??= session.id
    } else idle += 1
  }

  return { total: sessions.length, running, waiting, idle, waitingSessionId }
}
