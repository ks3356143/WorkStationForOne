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
    this.repository.createSession({ id: leaderId, agent: 'claude', title: leaderTitle })
    this.repository.updateSession(leaderId, { workspace: input.workspace, teamId })
    const workerIds = input.workers.map((worker) => {
      const id = this.id()
      this.repository.createSession({
        id,
        agent: 'claude',
        title: worker.title,
        ...(worker.persona ? { persona: worker.persona } : {})
      })
      this.repository.updateSession(id, {
        workspace: input.workspace,
        teamId,
        ...(worker.persona ? { persona: worker.persona } : {})
      })
      return id
    })
    const sessions = [leaderId, ...workerIds]
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
    return this.repository.postTeamNote({ teamId, sessionId, role, text, at: Date.now() })
  }

  notes(teamId: string): AgentTeamNoteRecord[] {
    return this.repository.listTeamNotes(teamId)
  }
}
