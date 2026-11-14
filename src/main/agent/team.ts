import { randomUUID } from 'node:crypto'
import type {
  AgentSessionRecord,
  AgentTeamCreateInput,
  AgentTeamNoteRecord,
  AgentTeamSummary
} from '../../shared/ipc'
import type { AgentRepository } from '../db/agent'

/** 多智能体编排地基：团队 = 一组共享 team_id 的会话 + 一块黑板。 */
export class TeamService {
  constructor(
    private readonly repository: AgentRepository,
    private readonly id: () => string = () => `s-${randomUUID()}`
  ) {}

  create(input: AgentTeamCreateInput): AgentTeamSummary {
    const teamId = `team-${randomUUID()}`
    const leaderId = this.id()
    const leaderTitle = input.leaderTitle ?? `${input.name} · 负责人`
    const workers = input.workers.map((worker) => ({
      id: this.id(),
      title: worker.title,
      ...(worker.persona ? { persona: worker.persona } : {})
    }))
    // 单事务写入：任一成员失败就整体回滚，不会留下半成品团队。
    this.repository.createTeamSessions(teamId, input.workspace, [
      { id: leaderId, title: leaderTitle },
      ...workers
    ])
    const sessions = [leaderId, ...workers.map((worker) => worker.id)]
      .map((id) => this.repository.findSession(id))
      .filter((session): session is AgentSessionRecord => Boolean(session))
    return { teamId, name: leaderTitle, sessions }
  }

  list(): AgentTeamSummary[] {
    const grouped = new Map<string, AgentSessionRecord[]>()
    for (const session of this.repository.listSessions()) {
      if (!session.teamId) continue
      const list = grouped.get(session.teamId) ?? []
      list.push(session)
      grouped.set(session.teamId, list)
    }
    return [...grouped.entries()].map(([teamId, list]) => {
      const sessions = [...list].sort((a, b) => a.createdAt - b.createdAt)
      return { teamId, name: sessions[0]?.title ?? teamId, sessions }
    })
  }

  post(
    teamId: string,
    sessionId: string,
    role: AgentTeamNoteRecord['role'],
    text: string
  ): AgentTeamNoteRecord {
    const session = this.repository.findSession(sessionId)
    if (!session || session.teamId !== teamId) throw new Error('会话不属于该团队')
    return this.repository.postTeamNote({ teamId, sessionId, role, text, at: Date.now() })
  }

  notes(teamId: string): AgentTeamNoteRecord[] {
    return this.repository.listTeamNotes(teamId)
  }
}
