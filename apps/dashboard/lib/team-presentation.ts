import type {
  Agent,
  Team,
} from "@orc/shared";

export const TEAM_VIEW_MODES = [
  "list",
  "details",
  "grid",
] as const;

export type TeamViewMode =
  (typeof TEAM_VIEW_MODES)[number];

export type TeamSortKey =
  | "name"
  | "updatedAt";

export type TeamStatusFilter =
  | "all"
  | "enabled"
  | "disabled";

export const AGENT_AVATAR_LIMIT = 5;

const teamCollator = new Intl.Collator(
  undefined,
  {
    numeric: true,
    sensitivity: "base",
  },
);

/**
 * Orders Agents deterministically for display; precise workflow layer/order
 * belongs to the Team Workflow editor, not this summary presentation.
 */
export function compareAgents(
  left: Agent,
  right: Agent,
): number {
  return (
    teamCollator.compare(
      left.name,
      right.name,
    ) ||
    teamCollator.compare(
      left.id,
      right.id,
    )
  );
}

/**
 * Groups Agents by their current Team membership, resolved from `team_members`.
 * Agents not currently selected onto any Team are omitted.
 */
export function groupAgentsByTeam(
  agents: Agent[],
): Map<string, Agent[]> {
  const result = new Map<
    string,
    Agent[]
  >();

  for (const agent of agents) {
    if (agent.currentTeamId === null) {
      continue;
    }

    const members =
      result.get(agent.currentTeamId) ?? [];

    members.push(agent);
    result.set(
      agent.currentTeamId,
      members,
    );
  }

  for (const members of result.values()) {
    members.sort(compareAgents);
  }

  return result;
}

/**
 * Produces one or two uppercase initials from an Agent name for compact avatars.
 */
export function getAgentInitials(
  name: string,
): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts.at(-1)?.[0] ?? ""}`
    .toUpperCase();
}

/**
 * Returns a stable palette slot for one Agent without using random presentation state.
 */
export function getAgentToneIndex(
  value: string,
  paletteSize: number,
): number {
  if (paletteSize <= 0) {
    return 0;
  }

  let hash = 0;

  for (const character of value) {
    hash = (
      hash * 31 +
      character.charCodeAt(0)
    ) >>> 0;
  }

  return hash % paletteSize;
}

/**
 * Limits visible Agent avatars and reports the remaining membership count.
 */
export function getAgentAvatarSummary(
  agents: Agent[],
  limit = AGENT_AVATAR_LIMIT,
): {
  visibleAgents: Agent[];
  overflowCount: number;
} {
  const safeLimit = Math.max(
    0,
    limit,
  );

  return {
    visibleAgents:
      agents.slice(0, safeLimit),
    overflowCount:
      Math.max(
        0,
        agents.length - safeLimit,
      ),
  };
}

/**
 * Matches a Team query against persisted Team fields and its current Agent names, roles, and slugs.
 */
export function matchesTeamQuery(
  team: Team,
  members: Agent[],
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }

  return [
    team.name,
    team.slug,
    team.description,
    ...members.flatMap(
      (agent) => [
        agent.name,
        agent.slug,
        agent.effective.role,
      ],
    ),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

/**
 * Applies the current semantic Team status filter without inventing new domain states.
 */
export function matchesTeamStatus(
  team: Team,
  filter: TeamStatusFilter,
): boolean {
  if (filter === "all") {
    return true;
  }

  return filter === "enabled"
    ? team.enabled
    : !team.enabled;
}

/**
 * Compares Teams using the selected persisted field and stable alphabetical/id fallbacks.
 */
export function compareTeams(
  left: Team,
  right: Team,
  sortKey: TeamSortKey,
): number {
  if (sortKey === "updatedAt") {
    const updatedComparison =
      Date.parse(right.updatedAt) -
      Date.parse(left.updatedAt);

    if (
      Number.isFinite(
        updatedComparison,
      ) &&
      updatedComparison !== 0
    ) {
      return updatedComparison;
    }
  }

  return (
    teamCollator.compare(
      left.name,
      right.name,
    ) ||
    teamCollator.compare(
      left.id,
      right.id,
    )
  );
}

/**
 * Filters and sorts the Teams list while preserving the original source arrays.
 */
export function getVisibleTeams(
  teams: Team[],
  membersByTeam: Map<
    string,
    Agent[]
  >,
  query: string,
  statusFilter: TeamStatusFilter,
  sortKey: TeamSortKey,
): Team[] {
  const normalizedQuery = query
    .trim()
    .toLowerCase();

  return teams
    .filter((team) =>
      matchesTeamStatus(
        team,
        statusFilter,
      ),
    )
    .filter((team) =>
      matchesTeamQuery(
        team,
        membersByTeam.get(team.id) ?? [],
        normalizedQuery,
      ),
    )
    .slice()
    .sort((left, right) =>
      compareTeams(
        left,
        right,
        sortKey,
      ),
    );
}
