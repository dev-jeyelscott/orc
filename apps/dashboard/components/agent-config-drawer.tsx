"use client";

import {
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import type {
  AgentRoute,
  AgentRouteOutcome,
  AgentWithRoutes,
  CreateAgent,
  Department,
  Team,
  TerminalAction,
} from "@orc/shared";

import {
  createAgent,
  createAgentRoute,
  deleteAgent,
  deleteAgentRoute,
  scopeCreateAgentToTeam,
  updateAgent,
  updateAgentRoute,
} from "@/lib/agents";
import {
  getAvailableAgentRouteTargets,
} from "@/lib/agent-presentation";
import {
  getDepartments,
} from "@/lib/departments";
import {
  getTeams,
} from "@/lib/teams";

import {
  Button,
  buttonVariants,
} from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Input,
} from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Switch,
} from "@/components/ui/switch";
import {
  Textarea,
} from "@/components/ui/textarea";

const outcomes:
  AgentRouteOutcome[] = [
    "completed",
    "approved",
    "changes_requested",
    "blocked",
    "failed",
  ];

const terminalActions:
  TerminalAction[] = [
    "complete_run",
    "fail_run",
    "block_run",
  ];

const blankAgent:
  CreateAgent = {
    departmentId: "",
    teamId: "",
    slug: "",
    name: "",
    layer: 1,
    executionOrder: 1,
    enabled: true,
    modelOverride: null,
    reasoningOverride: null,
    additionalPrompt: "",
  };

const drawerStyle = {
  "--drawer-content-width":
    "min(46rem, 96vw)",
} as CSSProperties;

type AgentConfigDrawerProps = {
  open: boolean;
  mode:
    | "create"
    | "edit";
  createTeamId:
    string;
  agent:
    AgentWithRoutes | null;
  agents:
    AgentWithRoutes[];
  onOpenChange:
    (open: boolean) => void;
  onRefresh:
    (
      preferredAgentId:
        string | null,
    ) => Promise<void>;
};

/**
 * Converts unknown request failures into concise operator-readable text.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to save agent configuration";
}

/**
 * Copies a persisted Agent into an editable payload or creates a Team-scoped draft.
 */
function createDraft(
  agent:
    AgentWithRoutes | null,
  createTeamId:
    string,
): CreateAgent {
  if (
    !agent
  ) {
    return {
      ...blankAgent,
      teamId:
        createTeamId,
    };
  }

  return {
    departmentId:
      agent.departmentId,
    teamId:
      agent.teamId,
    slug:
      agent.slug,
    name:
      agent.name,
    layer:
      agent.layer,
    executionOrder:
      agent.executionOrder,
    enabled:
      agent.enabled,
    modelOverride:
      agent.modelOverride,
    reasoningOverride:
      agent.reasoningOverride,
    additionalPrompt:
      agent.additionalPrompt,
  };
}

/**
 * Renders the controlled non-modal create/edit drawer for dynamic worker configuration.
 */
export function AgentConfigDrawer({
  open,
  mode,
  createTeamId,
  agent,
  agents,
  onOpenChange,
  onRefresh,
}: AgentConfigDrawerProps) {
  const [
    draft,
    setDraft,
  ] =
    useState<CreateAgent>(
      () =>
        createDraft(
          mode ===
            "edit"
            ? agent
            : null,
          createTeamId,
        ),
    );

  const [
    teams,
    setTeams,
  ] =
    useState<Team[]>(
      [],
    );

  const [
    teamsLoading,
    setTeamsLoading,
  ] =
    useState(false);

  const [
    departments,
    setDepartments,
  ] =
    useState<Department[]>(
      [],
    );

  const [
    departmentsLoading,
    setDepartmentsLoading,
  ] =
    useState(false);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  useEffect(
    () => {
      if (
        !open
      ) {
        return;
      }

      let cancelled =
        false;

      /**
       * Loads Team labels while preserving the current Team as the immutable create scope.
       */
      async function loadTeamOptions() {
        setTeamsLoading(
          true,
        );

        try {
          const nextTeams =
            await getTeams();

          if (
            cancelled
          ) {
            return;
          }

          setTeams(
            nextTeams,
          );

          if (
            mode ===
            "create"
          ) {
            setDraft(
              (
                current,
              ) =>
                scopeCreateAgentToTeam(
                  current,
                  createTeamId,
                ),
            );
          }
        } catch (
          caught
        ) {
          if (
            !cancelled
          ) {
            setError(
              errorMessage(
                caught,
              ),
            );
          }
        } finally {
          if (
            !cancelled
          ) {
            setTeamsLoading(
              false,
            );
          }
        }
      }

      void loadTeamOptions();

      /**
       * Loads Department labels the operator can select as the Agent's owner.
       */
      async function loadDepartmentOptions() {
        setDepartmentsLoading(
          true,
        );

        try {
          const nextDepartments =
            await getDepartments();

          if (
            !cancelled
          ) {
            setDepartments(
              nextDepartments,
            );
          }
        } catch (
          caught
        ) {
          if (
            !cancelled
          ) {
            setError(
              errorMessage(
                caught,
              ),
            );
          }
        } finally {
          if (
            !cancelled
          ) {
            setDepartmentsLoading(
              false,
            );
          }
        }
      }

      void loadDepartmentOptions();

      return () => {
        cancelled =
          true;
      };
    },
    [
      open,
      mode,
      createTeamId,
    ],
  );

  const selectedDepartment =
    departments.find(
      (
        department,
      ) =>
        department.id ===
        draft.departmentId,
    ) ??
    (
      mode ===
      "edit"
        ? agent?.department
        : undefined
    );

  /**
   * Updates one field in the local Agent draft.
   */
  function update<
    K extends keyof CreateAgent,
  >(
    key: K,
    value:
      CreateAgent[K],
  ) {
    setDraft(
      (
        current,
      ) => ({
        ...current,
        [key]:
          value,
      }),
    );
  }

  /**
   * Creates or updates the current Agent while forcing create operations into the selected Team.
   */
  async function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !draft.teamId
    ) {
      setError(
        "Select a Team before saving the agent.",
      );

      return;
    }

    if (
      !draft.departmentId
    ) {
      setError(
        "Select a Department before saving the agent.",
      );

      return;
    }

    if (
      mode ===
        "edit" &&
      agent?.enabled &&
      !draft.enabled
    ) {
      const confirmed =
        window.confirm(
          `Disable ${agent.name} for future runs? Existing active run snapshots will not change.`,
        );

      if (
        !confirmed
      ) {
        return;
      }
    }

    setSaving(
      true,
    );

    setError(
      null,
    );

    try {
      const createPayload =
        scopeCreateAgentToTeam(
          draft,
          createTeamId,
        );

      const saved =
        mode ===
        "create"
          ? await createAgent(
              createPayload,
            )
          : await updateAgent(
              agent!.id,
              draft,
            );

      await onRefresh(
        saved.id,
      );

      onOpenChange(
        false,
      );
    } catch (
      caught
    ) {
      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  /**
   * Permanently deletes the selected Agent only after explicit destructive confirmation.
   */
  async function removeAgent() {
    if (
      !agent
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `Permanently delete ${agent.name}? Historical executions and immutable run snapshots are preserved, but current routing references are removed.`,
      );

    if (
      !confirmed
    ) {
      return;
    }

    setSaving(
      true,
    );

    setError(
      null,
    );

    try {
      await deleteAgent(
        agent.id,
      );

      await onRefresh(
        null,
      );

      onOpenChange(
        false,
      );
    } catch (
      caught
    ) {
      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  return (
    <Drawer
      open={
        open
      }
      onOpenChange={
        onOpenChange
      }
      modal={false}
      disablePointerDismissal
      swipeDirection="right"
    >
      <DrawerContent
        style={
          drawerStyle
        }
      >
        <form
          onSubmit={
            submit
          }
          className="flex min-h-0 flex-1 flex-col"
        >
          <DrawerHeader className="border-b border-divider p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DrawerTitle>
                  {mode ===
                  "create"
                    ? "Create Agent"
                    : `Edit ${agent?.name ?? "Agent"}`}
                </DrawerTitle>

                <DrawerDescription>
                  Configuration changes affect future run snapshots only.
                </DrawerDescription>
              </div>

              <DrawerClose
                type="button"
                disabled={
                  saving
                }
                className={buttonVariants(
                  {
                    variant:
                      "ghost",
                    size:
                      "icon-sm",
                  },
                )}
                aria-label="Close agent configuration drawer"
              >
                <XIcon />
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-5">
              <section className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-text-secondary">
                    Name
                  </span>

                  <Input
                    value={
                      draft.name
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "name",
                        event.target.value,
                      )
                    }
                    required
                    maxLength={
                      160
                    }
                    disabled={
                      saving
                    }
                  />
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-text-secondary">
                    Slug
                  </span>

                  <Input
                    value={
                      draft.slug
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "slug",
                        event.target.value,
                      )
                    }
                    required
                    maxLength={
                      100
                    }
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    disabled={
                      saving
                    }
                  />
                </label>

                <label className="grid gap-1.5 text-sm md:col-span-2">
                  <span className="font-medium text-text-secondary">
                    Department
                  </span>

                  <Select
                    value={
                      draft.departmentId
                    }
                    onValueChange={(
                      value,
                    ) => {
                      if (
                        value
                      ) {
                        update(
                          "departmentId",
                          value,
                        );
                      }
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      disabled={
                        saving ||
                        departmentsLoading
                      }
                      aria-label="Select Department"
                    >
                      <SelectValue placeholder="Select a Department" />
                    </SelectTrigger>

                    <SelectContent align="start">
                      {departments.map(
                        (
                          department,
                        ) => (
                          <SelectItem
                            key={
                              department.id
                            }
                            value={
                              department.id
                            }
                          >
                            {department.name}
                            {!department.enabled
                              ? " (disabled)"
                              : ""}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>

                  <span className="text-xs text-text-muted">
                    Department owns role, harness, default model/reasoning,
                    system prompt, and permissions. This Agent inherits them
                    and may only override model, reasoning, and add an
                    additional prompt.
                  </span>

                  {!departmentsLoading &&
                  departments.length ===
                    0 ? (
                    <span className="text-xs text-status-error">
                      No Departments are available. Create one first.
                    </span>
                  ) : null}
                </label>

                <label className="grid gap-1.5 text-sm md:col-span-2">
                  <span className="font-medium text-text-secondary">
                    Team
                  </span>

                  <Select
                    value={
                      draft.teamId
                    }
                    onValueChange={(
                      value,
                    ) => {
                      if (
                        value &&
                        mode ===
                          "edit"
                      ) {
                        update(
                          "teamId",
                          value,
                        );
                      }
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      disabled={
                        saving ||
                        teamsLoading ||
                        mode ===
                          "create"
                      }
                      aria-label="Select Team"
                    >
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent align="start">
                      {teams.map(
                        (
                          team,
                        ) => (
                          <SelectItem
                            key={
                              team.id
                            }
                            value={
                              team.id
                            }
                          >
                            {team.name}
                            {!team.enabled
                              ? " (disabled)"
                              : ""}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>

                  {mode ===
                  "create" ? (
                    <span className="text-xs text-text-muted">
                      Assigned from the currently selected Team workspace.
                    </span>
                  ) : null}

                  {!teamsLoading &&
                  teams.length ===
                    0 ? (
                    <span className="text-xs text-status-error">
                      No Teams are available.
                    </span>
                  ) : null}
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-text-secondary">
                    Layer
                  </span>

                  <Input
                    type="number"
                    min={1}
                    value={
                      draft.layer
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "layer",
                        Number(
                          event.target.value,
                        ),
                      )
                    }
                    required
                    disabled={
                      saving
                    }
                  />
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-text-secondary">
                    Execution Order
                  </span>

                  <Input
                    type="number"
                    min={1}
                    value={
                      draft.executionOrder
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "executionOrder",
                        Number(
                          event.target.value,
                        ),
                      )
                    }
                    required
                    disabled={
                      saving
                    }
                  />
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="flex items-center justify-between font-medium text-text-secondary">
                    Model override
                    {draft.modelOverride ? (
                      <button
                        type="button"
                        className="text-xs font-normal text-accent hover:underline"
                        disabled={saving}
                        onClick={() =>
                          update(
                            "modelOverride",
                            null,
                          )
                        }
                      >
                        Use Department default
                      </button>
                    ) : null}
                  </span>

                  <Input
                    value={
                      draft.modelOverride ?? ""
                    }
                    placeholder={
                      selectedDepartment?.defaultModel ??
                      "Department default"
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "modelOverride",
                        event.target.value
                          ? event.target.value
                          : null,
                      )
                    }
                    maxLength={160}
                    disabled={
                      saving
                    }
                  />
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="flex items-center justify-between font-medium text-text-secondary">
                    Reasoning override
                    {draft.reasoningOverride ? (
                      <button
                        type="button"
                        className="text-xs font-normal text-accent hover:underline"
                        disabled={saving}
                        onClick={() =>
                          update(
                            "reasoningOverride",
                            null,
                          )
                        }
                      >
                        Use Department default
                      </button>
                    ) : null}
                  </span>

                  <Input
                    value={
                      draft.reasoningOverride ?? ""
                    }
                    placeholder={
                      selectedDepartment?.defaultReasoning ??
                      "Department default"
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "reasoningOverride",
                        event.target.value
                          ? event.target.value
                          : null,
                      )
                    }
                    maxLength={160}
                    disabled={
                      saving
                    }
                  />
                </label>

                <div className="grid gap-3 rounded-lg border border-divider p-3 md:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Instance state
                  </p>

                  <CapabilityToggle
                    label="Enabled"
                    description="Include this agent in future workflow snapshots. Effective state also requires the Department to be enabled."
                    checked={
                      draft.enabled
                    }
                    onCheckedChange={(
                      checked,
                    ) =>
                      update(
                        "enabled",
                        checked,
                      )
                    }
                    disabled={
                      saving
                    }
                  />
                </div>

                <label className="grid gap-1.5 text-sm md:col-span-2">
                  <span className="font-medium text-text-secondary">
                    Additional prompt
                  </span>

                  <Textarea
                    value={
                      draft.additionalPrompt
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "additionalPrompt",
                        event.target.value,
                      )
                    }
                    disabled={
                      saving
                    }
                    className="min-h-24 resize-y font-mono text-xs leading-relaxed"
                    placeholder="Appended after the Department system prompt when non-empty."
                  />
                </label>

                {selectedDepartment ? (
                  <div className="grid gap-2 rounded-lg border border-divider bg-surface-secondary/40 p-3 text-sm md:col-span-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                      Inherited from {selectedDepartment.name}
                    </p>

                    <dl className="grid gap-1 text-xs text-text-secondary">
                      <div className="flex justify-between gap-4">
                        <dt className="text-text-muted">Role</dt>
                        <dd>{selectedDepartment.role}</dd>
                      </div>

                      <div className="flex justify-between gap-4">
                        <dt className="text-text-muted">Harness</dt>
                        <dd>{selectedDepartment.harness}</dd>
                      </div>

                      <div className="flex justify-between gap-4">
                        <dt className="text-text-muted">Default model</dt>
                        <dd>{selectedDepartment.defaultModel}</dd>
                      </div>

                      <div className="flex justify-between gap-4">
                        <dt className="text-text-muted">Default reasoning</dt>
                        <dd>{selectedDepartment.defaultReasoning}</dd>
                      </div>

                      <div className="flex justify-between gap-4">
                        <dt className="text-text-muted">Permissions</dt>
                        <dd>
                          {[
                            selectedDepartment.canWrite ? "write" : null,
                            selectedDepartment.canRunCommands
                              ? "run commands"
                              : null,
                            selectedDepartment.canCommit ? "commit" : null,
                          ]
                            .filter(Boolean)
                            .join(", ") || "none"}
                        </dd>
                      </div>
                    </dl>

                    <details className="text-xs text-text-muted">
                      <summary className="cursor-pointer font-medium text-text-secondary">
                        Department system prompt
                      </summary>

                      <p className="mt-1 whitespace-pre-wrap font-mono">
                        {selectedDepartment.systemPrompt}
                      </p>
                    </details>
                  </div>
                ) : null}
              </section>

              {mode ===
                "edit" &&
              agent ? (
                <AgentRoutesEditor
                  agent={
                    agent
                  }
                  agents={
                    agents
                  }
                  disabled={
                    saving
                  }
                  onRefresh={
                    onRefresh
                  }
                  report={
                    setError
                  }
                />
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <DrawerFooter className="border-t border-divider p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {mode ===
                "edit" &&
              agent ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() =>
                    void removeAgent()
                  }
                  disabled={
                    saving
                  }
                >
                  <Trash2Icon />
                  Delete Agent
                </Button>
              ) : null}
            </div>

            <div className="flex gap-2">
              <DrawerClose
                type="button"
                disabled={
                  saving
                }
                className={buttonVariants(
                  {
                    variant:
                      "outline",
                  },
                )}
              >
                Cancel
              </DrawerClose>

              <Button
                type="submit"
                disabled={
                  saving ||
                  teamsLoading ||
                  departmentsLoading ||
                  !draft.teamId ||
                  !draft.departmentId
                }
              >
                {mode ===
                "create" ? (
                  <PlusIcon />
                ) : (
                  <SaveIcon />
                )}

                {saving
                  ? "Saving..."
                  : mode ===
                      "create"
                    ? "Create Agent"
                    : "Save Changes"}
              </Button>
            </div>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

type CapabilityToggleProps = {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange:
    (checked: boolean) => void;
};

/**
 * Renders one accessible boolean capability control with supporting context.
 */
function CapabilityToggle({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: CapabilityToggleProps) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-secondary">
          {label}
        </span>

        <span className="block text-xs leading-relaxed text-text-muted">
          {description}
        </span>
      </span>

      <Switch
        checked={
          checked
        }
        onCheckedChange={
          onCheckedChange
        }
        disabled={
          disabled
        }
        aria-label={
          label
        }
      />
    </label>
  );
}

type AgentRoutesEditorProps = {
  agent:
    AgentWithRoutes;
  agents:
    AgentWithRoutes[];
  disabled: boolean;
  onRefresh:
    (
      preferredAgentId:
        string | null,
    ) => Promise<void>;
  report:
    (
      message:
        string | null,
    ) => void;
};

/**
 * Renders editable persisted routing overrides for the selected Agent.
 */
function AgentRoutesEditor({
  agent,
  agents,
  disabled,
  onRefresh,
  report,
}: AgentRoutesEditorProps) {
  const [
    outcome,
    setOutcome,
  ] =
    useState<AgentRouteOutcome>(
      "changes_requested",
    );

  const [
    destination,
    setDestination,
  ] =
    useState(
      "terminal",
    );

  const [
    terminalAction,
    setTerminalAction,
  ] =
    useState<TerminalAction>(
      "block_run",
    );

  const availableTargets =
    useMemo(
      () =>
        getAvailableAgentRouteTargets(
          agents,
          agent,
        ),
      [
        agents,
        agent,
      ],
    );

  /**
   * Creates one explicit route using only valid same-Team targets.
   */
  async function addRoute() {
    report(
      null,
    );

    try {
      await createAgentRoute(
        agent.id,
        {
          outcome,
          enabled:
            true,
          targetAgentId:
            destination ===
            "terminal"
              ? null
              : destination,
          terminalAction:
            destination ===
            "terminal"
              ? terminalAction
              : null,
        },
      );

      await onRefresh(
        agent.id,
      );
    } catch (
      caught
    ) {
      report(
        errorMessage(
          caught,
        ),
      );
    }
  }

  return (
    <section className="grid gap-3 border-t border-divider pt-5">
      <div>
        <h3 className="font-heading text-sm font-medium text-text-primary">
          Outcome Routes
        </h3>

        <p className="mt-1 text-xs text-text-muted">
          Explicit routes override normal progression in future run snapshots.
        </p>
      </div>

      {agent.routes.length ===
      0 ? (
        <p className="rounded-lg border border-divider bg-surface-interactive/40 p-3 text-xs text-text-muted">
          No explicit routing overrides configured.
        </p>
      ) : null}

      {agent.routes.map(
        (
          route,
        ) => (
          <RouteRowEditor
            key={`${route.id}:${route.updatedAt}`}
            agent={
              agent
            }
            route={
              route
            }
            agents={
              agents
            }
            disabled={
              disabled
            }
            onRefresh={
              onRefresh
            }
            report={
              report
            }
          />
        ),
      )}

      <div className="grid gap-2 rounded-lg border border-divider p-3 md:grid-cols-3">
        <label className="grid gap-1 text-xs text-text-muted">
          Outcome

          <Select
            value={
              outcome
            }
            onValueChange={(
              value,
            ) => {
              if (
                value
              ) {
                setOutcome(
                  value as AgentRouteOutcome,
                );
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="start">
              {outcomes.map(
                (
                  value,
                ) => (
                  <SelectItem
                    key={
                      value
                    }
                    value={
                      value
                    }
                  >
                    {value}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </label>

        <label className="grid gap-1 text-xs text-text-muted">
          Destination

          <Select
            value={
              destination
            }
            onValueChange={(
              value,
            ) =>
              setDestination(
                value ??
                  "terminal",
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="start">
              <SelectItem value="terminal">
                Terminal Action
              </SelectItem>

              {availableTargets.map(
                (
                  candidate,
                ) => (
                  <SelectItem
                    key={
                      candidate.id
                    }
                    value={
                      candidate.id
                    }
                  >
                    {candidate.name}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </label>

        <label className="grid gap-1 text-xs text-text-muted">
          Terminal Action

          <Select
            value={
              terminalAction
            }
            disabled={
              destination !==
              "terminal"
            }
            onValueChange={(
              value,
            ) => {
              if (
                value
              ) {
                setTerminalAction(
                  value as TerminalAction,
                );
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="start">
              {terminalActions.map(
                (
                  action,
                ) => (
                  <SelectItem
                    key={
                      action
                    }
                    value={
                      action
                    }
                  >
                    {action}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </label>

        <Button
          type="button"
          variant="outline"
          className="md:col-span-3"
          onClick={() =>
            void addRoute()
          }
          disabled={
            disabled
          }
        >
          <PlusIcon />
          Add Route
        </Button>
      </div>
    </section>
  );
}

type RouteRowEditorProps = {
  agent:
    AgentWithRoutes;
  route:
    AgentRoute;
  agents:
    AgentWithRoutes[];
  disabled: boolean;
  onRefresh:
    (
      preferredAgentId:
        string | null,
    ) => Promise<void>;
  report:
    (
      message:
        string | null,
    ) => void;
};

/**
 * Edits one persisted route while exposing only enabled same-Team targets.
 */
function RouteRowEditor({
  agent,
  route,
  agents,
  disabled,
  onRefresh,
  report,
}: RouteRowEditorProps) {
  const [
    outcome,
    setOutcome,
  ] =
    useState<AgentRouteOutcome>(
      route.outcome,
    );

  const [
    destination,
    setDestination,
  ] =
    useState(
      route.targetAgentId ??
        "terminal",
    );

  const [
    terminalAction,
    setTerminalAction,
  ] =
    useState<TerminalAction>(
      route.terminalAction ??
        "complete_run",
    );

  const [
    enabled,
    setEnabled,
  ] =
    useState(
      route.enabled,
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false,
    );

  const availableTargets =
    getAvailableAgentRouteTargets(
      agents,
      agent,
    );

  const currentTarget =
    route.targetAgentId
      ? agents.find(
          (
            candidate,
          ) =>
            candidate.id ===
            route.targetAgentId,
        ) ??
        null
      : null;

  const currentTargetAvailable =
    currentTarget !==
      null &&
    availableTargets.some(
      (
        candidate,
      ) =>
        candidate.id ===
        currentTarget.id,
    );

  /**
   * Saves all editable route fields through the existing PATCH route.
   */
  async function saveRoute() {
    setSaving(
      true,
    );

    report(
      null,
    );

    try {
      await updateAgentRoute(
        agent.id,
        route.id,
        {
          outcome,
          enabled,
          targetAgentId:
            destination ===
            "terminal"
              ? null
              : destination,
          terminalAction:
            destination ===
            "terminal"
              ? terminalAction
              : null,
        },
      );

      await onRefresh(
        agent.id,
      );
    } catch (
      caught
    ) {
      report(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  /**
   * Removes this explicit routing override.
   */
  async function removeRoute() {
    report(
      null,
    );

    try {
      await deleteAgentRoute(
        agent.id,
        route.id,
      );

      await onRefresh(
        agent.id,
      );
    } catch (
      caught
    ) {
      report(
        errorMessage(
          caught,
        ),
      );
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-divider p-3 md:grid-cols-[1fr_1fr_1fr_auto_auto] md:items-end">
      <label className="grid gap-1 text-xs text-text-muted">
        Outcome

        <Select
          value={
            outcome
          }
          onValueChange={(
            value,
          ) => {
            if (
              value
            ) {
              setOutcome(
                value as AgentRouteOutcome,
              );
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>

          <SelectContent align="start">
            {outcomes.map(
              (
                value,
              ) => (
                <SelectItem
                  key={
                    value
                  }
                  value={
                    value
                  }
                >
                  {value}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </label>

      <label className="grid gap-1 text-xs text-text-muted">
        Destination

        <Select
          value={
            destination
          }
          onValueChange={(
            value,
          ) =>
            setDestination(
              value ??
                "terminal",
            )
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>

          <SelectContent align="start">
            <SelectItem value="terminal">
              Terminal Action
            </SelectItem>

            {route.targetAgentId &&
            !currentTargetAvailable ? (
              <SelectItem
                value={
                  route.targetAgentId
                }
                disabled
              >
                {currentTarget?.name ??
                  "Unavailable Target"}
              </SelectItem>
            ) : null}

            {availableTargets.map(
              (
                candidate,
              ) => (
                <SelectItem
                  key={
                    candidate.id
                  }
                  value={
                    candidate.id
                  }
                >
                  {candidate.name}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </label>

      <label className="grid gap-1 text-xs text-text-muted">
        Terminal Action

        <Select
          value={
            terminalAction
          }
          disabled={
            destination !==
            "terminal"
          }
          onValueChange={(
            value,
          ) => {
            if (
              value
            ) {
              setTerminalAction(
                value as TerminalAction,
              );
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>

          <SelectContent align="start">
            {terminalActions.map(
              (
                action,
              ) => (
                <SelectItem
                  key={
                    action
                  }
                  value={
                    action
                  }
                >
                  {action}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </label>

      <label className="flex h-8 items-center gap-2 text-xs text-text-secondary">
        <Switch
          size="sm"
          checked={
            enabled
          }
          onCheckedChange={
            setEnabled
          }
          disabled={
            disabled ||
            saving
          }
        />

        Enabled
      </label>

      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          onClick={() =>
            void saveRoute()
          }
          disabled={
            disabled ||
            saving
          }
        >
          Save
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() =>
            void removeRoute()
          }
          disabled={
            disabled ||
            saving
          }
          aria-label={`Delete ${route.outcome} route`}
        >
          <Trash2Icon />
        </Button>
      </div>
    </div>
  );
}
