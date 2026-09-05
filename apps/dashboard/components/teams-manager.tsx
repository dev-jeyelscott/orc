"use client";

import {
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  Agent,
  Team,
} from "@orc/shared";

import {
  TeamConfigDrawer,
} from "@/components/team-config-drawer";
import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  Input,
} from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getAgents,
} from "@/lib/agents";
import {
  getTeams,
} from "@/lib/teams";

/**
 * Converts an unknown Teams workspace failure into concise operator-facing text.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to load Teams";
}

/**
 * Formats a Team update timestamp for the operator table.
 */
function formatUpdatedAt(
  value: string,
): string {
  return new Intl.DateTimeFormat(
    "en",
    {
      dateStyle:
        "medium",
      timeStyle:
        "short",
    },
  ).format(
    new Date(
      value,
    ),
  );
}

/**
 * Renders Team CRUD, enablement state, and Agent membership visibility.
 */
export function TeamsManager() {
  const [
    teams,
    setTeams,
  ] =
    useState<Team[]>(
      [],
    );

  const [
    agents,
    setAgents,
  ] =
    useState<Agent[]>(
      [],
    );

  const [
    query,
    setQuery,
  ] =
    useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    refreshing,
    setRefreshing,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    drawerOpen,
    setDrawerOpen,
  ] =
    useState(false);

  const [
    drawerMode,
    setDrawerMode,
  ] =
    useState<
      "create" | "edit"
    >("create");

  const [
    selectedTeamId,
    setSelectedTeamId,
  ] =
    useState<string | null>(
      null,
    );

  /**
   * Reloads Teams and Agent memberships as one coherent management snapshot.
   */
  const loadWorkspace =
    useCallback(
      async (
        preferredTeamId:
          string | null =
          null,
      ) => {
        setError(
          null,
        );

        try {
          const [
            nextTeams,
            nextAgents,
          ] =
            await Promise.all([
              getTeams(),
              getAgents(),
            ]);

          setTeams(
            nextTeams,
          );

          setAgents(
            nextAgents,
          );

          setSelectedTeamId(
            (current) => {
              if (
                preferredTeamId &&
                nextTeams.some(
                  (team) =>
                    team.id ===
                    preferredTeamId,
                )
              ) {
                return preferredTeamId;
              }

              if (
                current &&
                nextTeams.some(
                  (team) =>
                    team.id ===
                    current,
                )
              ) {
                return current;
              }

              return null;
            },
          );
        } catch (caught) {
          setError(
            errorMessage(
              caught,
            ),
          );
        } finally {
          setLoading(
            false,
          );

          setRefreshing(
            false,
          );
        }
      },
      [],
    );

  useEffect(
    () => {
      void loadWorkspace();
    },
    [
      loadWorkspace,
    ],
  );

  const membersByTeam =
    useMemo(
      () => {
        const result =
          new Map<
            string,
            Agent[]
          >();

        for (
          const agent of
          agents
        ) {
          const members =
            result.get(
              agent.teamId,
            ) ?? [];

          members.push(
            agent,
          );

          result.set(
            agent.teamId,
            members,
          );
        }

        for (
          const members of
          result.values()
        ) {
          members.sort(
            (
              left,
              right,
            ) =>
              left.layer -
                right.layer ||
              left.executionOrder -
                right.executionOrder ||
              left.name.localeCompare(
                right.name,
              ),
          );
        }

        return result;
      },
      [
        agents,
      ],
    );

  const normalizedQuery =
    query
      .trim()
      .toLowerCase();

  const filteredTeams =
    useMemo(
      () =>
        teams.filter(
          (team) => {
            if (
              !normalizedQuery
            ) {
              return true;
            }

            const members =
              membersByTeam.get(
                team.id,
              ) ?? [];

            return [
              team.name,
              team.slug,
              team.description,
              ...members.flatMap(
                (agent) => [
                  agent.name,
                  agent.role,
                ],
              ),
            ]
              .join(" ")
              .toLowerCase()
              .includes(
                normalizedQuery,
              );
          },
        ),
      [
        teams,
        normalizedQuery,
        membersByTeam,
      ],
    );

  const selectedTeam =
    teams.find(
      (team) =>
        team.id ===
        selectedTeamId,
    ) ?? null;

  const selectedMemberCount =
    selectedTeam
      ? (
          membersByTeam.get(
            selectedTeam.id,
          ) ?? []
        ).length
      : 0;

  /**
   * Opens a fresh Team creation drawer.
   */
  function openCreate() {
    setSelectedTeamId(
      null,
    );

    setDrawerMode(
      "create",
    );

    setDrawerOpen(
      true,
    );
  }

  /**
   * Opens the selected Team in edit mode.
   */
  function openEdit(
    teamId: string,
  ) {
    setSelectedTeamId(
      teamId,
    );

    setDrawerMode(
      "edit",
    );

    setDrawerOpen(
      true,
    );
  }

  /**
   * Refreshes the Team workspace while displaying the refresh state.
   */
  async function refresh() {
    setRefreshing(
      true,
    );

    await loadWorkspace(
      selectedTeamId,
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <UsersIcon className="size-5 text-brand-accent" />

            <h1 className="font-heading text-xl font-semibold text-text-primary">
              Teams
            </h1>
          </div>

          <p className="mt-1 max-w-3xl text-sm text-text-muted">
            Manage workflow ownership boundaries and inspect the Agents assigned to each Team.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={
              refreshing
            }
            onClick={() =>
              void refresh()
            }
          >
            <RefreshCwIcon
              className={
                refreshing
                  ? "animate-spin"
                  : undefined
              }
            />
            Refresh
          </Button>

          <Button
            type="button"
            onClick={
              openCreate
            }
          >
            <PlusIcon />
            Create Team
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 rounded-lg border border-divider bg-surface-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />

          <Input
            value={
              query
            }
            onChange={(
              event,
            ) =>
              setQuery(
                event.target
                  .value,
              )
            }
            className="pl-9"
            placeholder="Search Teams or members"
            aria-label="Search Teams"
          />
        </div>

        <div className="text-xs text-text-muted">
          {filteredTeams.length}{" "}
          {filteredTeams.length ===
          1
            ? "Team"
            : "Teams"}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center rounded-lg border border-divider bg-surface-card text-sm text-text-muted">
          Loading Teams...
        </div>
      ) : filteredTeams.length ===
        0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-divider bg-surface-card p-6 text-center">
          <UsersIcon className="size-8 text-text-muted" />

          <p className="mt-3 text-sm font-medium text-text-primary">
            No Teams found
          </p>

          <p className="mt-1 text-xs text-text-muted">
            Create a Team or adjust the current search.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                Team
              </TableHead>

              <TableHead>
                Status
              </TableHead>

              <TableHead>
                Members
              </TableHead>

              <TableHead>
                Enabled
              </TableHead>

              <TableHead>
                Updated
              </TableHead>

              <TableHead className="text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filteredTeams.map(
              (team) => {
                const members =
                  membersByTeam.get(
                    team.id,
                  ) ?? [];

                const enabledMembers =
                  members.filter(
                    (agent) =>
                      agent.enabled,
                  ).length;

                return (
                  <TableRow
                    key={
                      team.id
                    }
                  >
                    <TableCell>
                      <div className="min-w-48">
                        <div className="font-medium text-text-primary">
                          {team.name}
                        </div>

                        <div className="mt-0.5 font-mono text-[11px] text-text-muted">
                          {team.slug}
                        </div>

                        {team.description ? (
                          <div className="mt-1 max-w-md whitespace-normal text-xs text-text-muted">
                            {team.description}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={
                          team.enabled
                            ? "success"
                            : "disabled"
                        }
                      >
                        {team.enabled
                          ? "Enabled"
                          : "Disabled"}
                      </Badge>
                    </TableCell>

                    <TableCell className="whitespace-normal">
                      {members.length ===
                      0 ? (
                        <span className="text-xs text-text-muted">
                          No Agents
                        </span>
                      ) : (
                        <div className="flex min-w-72 flex-wrap gap-1.5">
                          {members
                            .slice(
                              0,
                              6,
                            )
                            .map(
                              (
                                agent,
                              ) => (
                                <Badge
                                  key={
                                    agent.id
                                  }
                                  variant={
                                    agent.enabled
                                      ? "success"
                                      : "disabled"
                                  }
                                >
                                  {agent.name}
                                  {" · "}
                                  L
                                  {agent.layer}
                                  .
                                  {agent.executionOrder}
                                </Badge>
                              ),
                            )}

                          {members.length >
                          6 ? (
                            <Badge variant="neutral">
                              +
                              {members.length -
                                6}
                            </Badge>
                          ) : null}
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <span className="font-mono text-xs text-text-secondary">
                        {enabledMembers}/
                        {members.length}
                      </span>
                    </TableCell>

                    <TableCell>
                      <span className="text-xs text-text-muted">
                        {formatUpdatedAt(
                          team.updatedAt,
                        )}
                      </span>
                    </TableCell>

                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          openEdit(
                            team.id,
                          )
                        }
                      >
                        <PencilIcon />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              },
            )}
          </TableBody>
        </Table>
      )}

      <TeamConfigDrawer
        key={`${drawerMode}:${selectedTeam?.id ?? "new"}`}
        open={
          drawerOpen
        }
        mode={
          drawerMode
        }
        team={
          selectedTeam
        }
        memberCount={
          selectedMemberCount
        }
        onOpenChange={
          setDrawerOpen
        }
        onRefresh={
          loadWorkspace
        }
      />
    </div>
  );
}
