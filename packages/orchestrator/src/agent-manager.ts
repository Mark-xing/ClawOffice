import type { AgentSession } from "./agent-session.js";

export class AgentManager {
  private agents = new Map<string, AgentSession>();
  /** Set of team lead agent IDs (supports multiple teams) */
  private _teamLeadIds = new Set<string>();

  setTeamLead(id: string | null) {
    if (id) this._teamLeadIds.add(id);
  }

  /** Remove a specific team lead */
  removeTeamLead(id: string) {
    this._teamLeadIds.delete(id);
  }

  getTeamLead(): string | null {
    // Return the first team lead (legacy compat)
    for (const id of this._teamLeadIds) return id;
    return null;
  }

  /** Get the team lead for a specific teamId */
  getTeamLeadForTeam(teamId: string): string | null {
    for (const session of this.agents.values()) {
      if (session.teamId === teamId && this._teamLeadIds.has(session.agentId)) {
        return session.agentId;
      }
    }
    return null;
  }

  isTeamLead(id: string): boolean {
    return this._teamLeadIds.has(id);
  }

  getTeamRoster(teamId?: string): string {
    const lines: string[] = [];
    for (const session of this.agents.values()) {
      // Only list agents that belong to a team (skip orphan/solo agents)
      if (!session.teamId && !this.isTeamLead(session.agentId)) continue;
      // Multi-team isolation: only show agents from the specified team
      if (teamId && session.teamId && session.teamId !== teamId) continue;
      if (teamId && this.isTeamLead(session.agentId) && session.teamId !== teamId) continue;
      const lead = this.isTeamLead(session.agentId) ? " (Team Lead)" : "";
      const raw = session.lastResult ?? "";
      const result = raw ? ` — ${raw.length > 100 ? raw.slice(0, 100) + "…" : raw}` : "";
      lines.push(`- ${session.name} (${session.role}) [${session.status}]${lead}${result}`);
    }
    return lines.join("\n");
  }

  getTeamMembers(teamId?: string): Array<{ name: string; role: string; status: string; isLead: boolean; lastResult: string | null }> {
    return Array.from(this.agents.values())
      .filter(s => {
        if (!s.teamId && !this.isTeamLead(s.agentId)) return false;
        // Multi-team isolation
        if (teamId && s.teamId && s.teamId !== teamId) return false;
        if (teamId && this.isTeamLead(s.agentId) && s.teamId !== teamId) return false;
        return true;
      })
      .map(s => ({
        name: s.name,
        role: s.role,
        status: s.status,
        isLead: this.isTeamLead(s.agentId),
        lastResult: s.lastResult,
      }));
  }

  add(session: AgentSession): void {
    const existing = this.agents.get(session.agentId);
    if (existing) {
      existing.destroy();
    }
    this.agents.set(session.agentId, session);
  }

  delete(agentId: string): boolean {
    const session = this.agents.get(agentId);
    if (!session) return false;
    session.destroy();
    this.agents.delete(agentId);
    return true;
  }

  get(agentId: string): AgentSession | undefined {
    return this.agents.get(agentId);
  }

  getAll(): AgentSession[] {
    return Array.from(this.agents.values());
  }

  findByName(name: string, teamId?: string): AgentSession | undefined {
    const lower = name.toLowerCase();

    // Priority levels (highest first):
    // 1. Exact name match in same team
    // 2. Exact name match in any team
    // 3. Fuzzy match: name contains query or query contains name (same team first)
    // 4. Role-based match: role contains query (same team first)
    // 5. Solo agent fallback

    let exactSameTeam: AgentSession | undefined;
    let exactAnyTeam: AgentSession | undefined;
    let fuzzySameTeam: AgentSession | undefined;
    let fuzzyAnyTeam: AgentSession | undefined;
    let roleSameTeam: AgentSession | undefined;
    let roleAnyTeam: AgentSession | undefined;
    let fallback: AgentSession | undefined;

    for (const session of this.agents.values()) {
      const nameLower = session.name.toLowerCase();
      const roleLower = session.role.toLowerCase();
      const isInTeam = session.teamId || this.isTeamLead(session.agentId);
      const isSameTeam = teamId && session.teamId === teamId;

      if (nameLower === lower) {
        // Exact name match
        if (isSameTeam) { exactSameTeam = session; }
        else if (isInTeam) { if (!exactAnyTeam) exactAnyTeam = session; }
        else { if (!fallback) fallback = session; }
      } else if (nameLower.includes(lower) || lower.includes(nameLower)) {
        // Fuzzy name match (e.g. "产品经理" matches agent named "产品", or "研发" matches "研发工程师")
        if (isSameTeam) { if (!fuzzySameTeam) fuzzySameTeam = session; }
        else if (isInTeam) { if (!fuzzyAnyTeam) fuzzyAnyTeam = session; }
      } else if (roleLower.includes(lower) || lower.includes(roleLower.split(/\s*[—–-]\s*/)[0])) {
        // Role-based match (e.g. "前端开发工程师" matches role "Frontend Developer")
        // Also check Chinese role keywords in the role string
        if (isSameTeam) { if (!roleSameTeam) roleSameTeam = session; }
        else if (isInTeam) { if (!roleAnyTeam) roleAnyTeam = session; }
      }
    }

    return exactSameTeam ?? exactAnyTeam ?? fuzzySameTeam ?? fuzzyAnyTeam ?? roleSameTeam ?? roleAnyTeam ?? fallback;
  }
}
