"use client";

import {
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
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
  TerminalAction,
} from "@orc/shared";

import {
  createAgent,
  createAgentRoute,
  deleteAgent,
  deleteAgentRoute,
  updateAgent,
  updateAgentRoute,
} from "@/lib/agents";
import {
  harnessOptions,
} from "@/lib/harness-options";

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

type Harness =
  NonNullable<
    CreateAgent["harness"]
  >;

const blankAgent:
  CreateAgent = {
    slug: "",
    name: "",
    role: "",
    description: "",
    layer: 1,
    executionOrder: 1,
    harness: "codex",
    model: "default",
    reasoning: "high",
    systemPrompt: "",
    enabled: true,
    canWrite: false,
    canRunCommands: true,
    canCommit: false,
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
 * Copies a persisted agent into an editable create/update payload.
 */
function createDraft(
  agent:
    AgentWithRoutes | null,
): CreateAgent {
  if (!agent) {
    return {
      ...blankAgent,
    };
  }

  return {
    slug:
      agent.slug,
    name:
      agent.name,
    role:
      agent.role,
    description:
      agent.description,
    layer:
      agent.layer,
    executionOrder:
      agent.executionOrder,
    harness:
      agent.harness,
    model:
      agent.model,
    reasoning:
      agent.reasoning,
    systemPrompt:
      agent.systemPrompt,
    enabled:
      agent.enabled,
    canWrite:
      agent.canWrite,
    canRunCommands:
      agent.canRunCommands,
    canCommit:
      agent.canCommit,
  };
}

/**
 * Renders the controlled non-modal create/edit drawer for dynamic worker configuration.
 */
export function AgentConfigDrawer({
  open,
  mode,
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
          mode === "edit"
            ? agent
            : null,
        ),
    );

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

  const selectedHarness =
    (
      draft.harness ??
      "codex"
    ) as Harness;

  const options =
    harnessOptions[
      selectedHarness
    ];

  /**
   * Updates one field in the local agent draft.
   */
  function update<
    K extends keyof CreateAgent,
  >(
    key: K,
    value:
      CreateAgent[K],
  ) {
    setDraft(
      (current) => ({
        ...current,
        [key]: value,
      }),
    );
  }

  /**
   * Changes harness and resets provider-specific model and reasoning selections.
   */
  function changeHarness(
    harness: Harness,
  ) {
    const next =
      harnessOptions[
        harness
      ];

    setDraft(
      (current) => ({
        ...current,
        harness,
        model:
          next.models[0],
        reasoning:
          next.reasoning[0],
      }),
    );
  }

  /**
   * Creates or updates the current agent after preserving the existing disable confirmation.
   */
  async function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      mode === "edit" &&
      agent?.enabled &&
      !draft.enabled
    ) {
      const confirmed =
        window.confirm(
          `Disable ${agent.name} for future runs? Existing active run snapshots will not change.`,
        );

      if (!confirmed) {
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      const saved =
        mode === "create"
          ? await createAgent(
              draft,
            )
          : await updateAgent(
              agent!.id,
              draft,
            );

      await onRefresh(
        saved.id,
      );

      onOpenChange(false);
    } catch (caught) {
      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  /**
   * Permanently deletes the selected agent only after explicit destructive confirmation.
   */
  async function removeAgent() {
    if (!agent) {
      return;
    }

    const confirmed =
      window.confirm(
        `Permanently delete ${agent.name}? Historical executions and immutable run snapshots are preserved, but current routing references are removed.`,
      );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await deleteAgent(
        agent.id,
      );

      await onRefresh(
        null,
      );

      onOpenChange(false);
    } catch (caught) {
      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={
        onOpenChange
      }
      modal={false}
      disablePointerDismissal
      swipeDirection="right"
    >
      <DrawerContent
        style={drawerStyle}
      >
        <form
          onSubmit={submit}
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
                  Configuration
                  changes affect
                  future run
                  snapshots only.
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
                        event
                          .target
                          .value,
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
                        event
                          .target
                          .value,
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

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-text-secondary">
                    Role
                  </span>

                  <Input
                    value={
                      draft.role
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "role",
                        event
                          .target
                          .value,
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
                    Description
                  </span>

                  <Input
                    value={
                      draft.description
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "description",
                        event
                          .target
                          .value,
                      )
                    }
                    maxLength={
                      2000
                    }
                    disabled={
                      saving
                    }
                  />
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
                          event
                            .target
                            .value,
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
                    Execution
                    Order
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
                          event
                            .target
                            .value,
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
                    Harness
                  </span>

                  <Select
                    value={
                      selectedHarness
                    }
                    onValueChange={(
                      value,
                    ) => {
                      if (
                        value
                      ) {
                        changeHarness(
                          value as Harness,
                        );
                      }
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      disabled={
                        saving
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent align="start">
                      <SelectItem value="codex">
                        Codex
                      </SelectItem>

                      <SelectItem value="claude">
                        Claude
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-text-secondary">
                    Model
                  </span>

                  <Select
                    value={
                      draft.model
                    }
                    onValueChange={(
                      value,
                    ) => {
                      if (
                        value
                      ) {
                        update(
                          "model",
                          value,
                        );
                      }
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      disabled={
                        saving
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent align="start">
                      {options.models.map(
                        (
                          model,
                        ) => (
                          <SelectItem
                            key={
                              model
                            }
                            value={
                              model
                            }
                          >
                            {
                              model
                            }
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-text-secondary">
                    Reasoning
                  </span>

                  <Select
                    value={
                      draft.reasoning
                    }
                    onValueChange={(
                      value,
                    ) => {
                      if (
                        value
                      ) {
                        update(
                          "reasoning",
                          value,
                        );
                      }
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      disabled={
                        saving
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent align="start">
                      {options.reasoning.map(
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
                            {
                              value
                            }
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </label>

                <div className="grid gap-3 rounded-lg border border-divider p-3 md:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Capabilities
                  </p>

                  <CapabilityToggle
                    label="Enabled"
                    description="Include this agent in future workflow snapshots."
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

                  <CapabilityToggle
                    label="Can Write"
                    description="Allow the agent prompt to authorize repository modifications."
                    checked={
                      draft.canWrite
                    }
                    onCheckedChange={(
                      checked,
                    ) =>
                      update(
                        "canWrite",
                        checked,
                      )
                    }
                    disabled={
                      saving
                    }
                  />

                  <CapabilityToggle
                    label="Can Run Commands"
                    description="Allow project development commands when permitted by the runtime policy."
                    checked={
                      draft.canRunCommands
                    }
                    onCheckedChange={(
                      checked,
                    ) =>
                      update(
                        "canRunCommands",
                        checked,
                      )
                    }
                    disabled={
                      saving
                    }
                  />

                  <CapabilityToggle
                    label="Can Commit"
                    description="Allow this worker to create Git commits when its task requires it."
                    checked={
                      draft.canCommit
                    }
                    onCheckedChange={(
                      checked,
                    ) =>
                      update(
                        "canCommit",
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
                    System Prompt
                  </span>

                  <Textarea
                    value={
                      draft.systemPrompt
                    }
                    onChange={(
                      event,
                    ) =>
                      update(
                        "systemPrompt",
                        event
                          .target
                          .value,
                      )
                    }
                    required
                    disabled={
                      saving
                    }
                    className="min-h-56 resize-y font-mono text-xs leading-relaxed"
                  />
                </label>
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
                  Delete
                  Agent
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
                  saving
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
 * Renders editable persisted routing overrides for the selected agent.
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
    useState("terminal");

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
        agents.filter(
          (candidate) =>
            candidate.enabled &&
            candidate.id !==
              agent.id,
        ),
      [
        agents,
        agent.id,
      ],
    );

  /**
   * Creates one new explicit route using the current destination mode.
   */
  async function addRoute() {
    report(null);

    try {
      await createAgentRoute(
        agent.id,
        {
          outcome,
          enabled: true,
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
    } catch (caught) {
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
          Explicit routes
          override normal
          progression in
          future run
          snapshots.
        </p>
      </div>

      {agent.routes.length ===
      0 ? (
        <p className="rounded-lg border border-divider bg-surface-interactive/40 p-3 text-xs text-text-muted">
          No explicit
          routing overrides
          configured.
        </p>
      ) : null}

      {agent.routes.map(
        (route) => (
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
                    {
                      value
                    }
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
                Terminal
                Action
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
                    {
                      candidate.name
                    }
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
                    {
                      action
                    }
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
 * Edits one persisted route without requiring destructive delete-and-recreate behavior.
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
    useState(false);

  const availableTargets =
    agents.filter(
      (candidate) =>
        candidate.enabled &&
        candidate.id !==
          agent.id,
    );

  const currentTarget =
    route.targetAgentId
      ? agents.find(
          (candidate) =>
            candidate.id ===
            route.targetAgentId,
        ) ?? null
      : null;

  const currentTargetAvailable =
    currentTarget !== null &&
    availableTargets.some(
      (candidate) =>
        candidate.id ===
        currentTarget.id,
    );

  /**
   * Saves all editable route fields through the existing PATCH route.
   */
  async function saveRoute() {
    setSaving(true);
    report(null);

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
    } catch (caught) {
      report(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  /**
   * Removes this explicit routing override after the operator chooses the delete control.
   */
  async function removeRoute() {
    report(null);

    try {
      await deleteAgentRoute(
        agent.id,
        route.id,
      );

      await onRefresh(
        agent.id,
      );
    } catch (caught) {
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
                  {
                    value
                  }
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
              Terminal
              Action
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
                  {
                    candidate.name
                  }
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
                  {
                    action
                  }
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
