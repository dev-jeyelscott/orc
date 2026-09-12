import type { Agent } from "@orc/shared";

export const AGENT_VIEW_MODES = ["table", "list", "details", "grid"] as const;
export type AgentViewMode = (typeof AGENT_VIEW_MODES)[number];
export type AgentStatusFilter = "all" | "enabled" | "disabled";

/** Filters the registry without changing the API's Department/name ordering. */
export function getVisibleAgents(agents: Agent[], query: string, departmentId: string, teamId: string, status: AgentStatusFilter): Agent[] {
  const normalized = query.trim().toLowerCase();
  return agents.filter((agent) => {
    const haystack = [agent.name, agent.slug, agent.department.name, agent.effective.role, agent.effective.harness, agent.effective.model, agent.effective.reasoning].join(" ").toLowerCase();
    return (!normalized || haystack.includes(normalized))
      && (departmentId === "all" || agent.departmentId === departmentId)
      && (teamId === "all" || (teamId === "unassigned" ? agent.currentTeamId === null : agent.currentTeamId === teamId))
      && (status === "all" || agent.enabled === (status === "enabled"));
  });
}
