"use client";

import { PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  Agent,
  AgentRouteOutcome,
  AgentWithRoutes,
  CreateAgent,
  TerminalAction,
} from "@orc/shared";

import {
  createAgent,
  createAgentRoute,
  deleteAgentRoute,
  getAgent,
  getAgents,
  updateAgent,
  updateAgentRoute,
} from "@/lib/agents";
import { harnessOptions } from "@/lib/harness-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const outcomes: AgentRouteOutcome[] = [
  "completed",
  "approved",
  "changes_requested",
  "blocked",
  "failed",
];
const terminalActions: TerminalAction[] = [
  "complete_run",
  "fail_run",
  "block_run",
];
type Harness = NonNullable<CreateAgent["harness"]>;

const blankAgent: CreateAgent = {
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

export function AgentsManager() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<AgentWithRoutes | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      setAgents(await getAgents());
      setMessage(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load agents",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void getAgents()
      .then((result) => {
        if (cancelled) return;
        setAgents(result);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMessage(
          error instanceof Error ? error.message : "Unable to load agents",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function selectAgent(agent: Agent) {
    setCreating(false);
    setMessage(null);
    try {
      setSelected(await getAgent(agent.id));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load agent",
      );
    }
  }
  async function refreshSelected(id: string) {
    setSelected(await getAgent(id));
    await loadAgents();
  }

  async function saveAgent(input: CreateAgent) {
    setMessage(null);
    try {
      if (creating) {
        const agent = await createAgent(input);
        setCreating(false);
        await refreshSelected(agent.id);
      } else if (selected)
        await refreshSelected((await updateAgent(selected.id, input)).id);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save agent",
      );
    }
  }

  async function disableAgent() {
    if (
      !selected ||
      !window.confirm(
        `Disable ${selected.name}? Related routes will also be disabled.`,
      )
    )
      return;
    try {
      await updateAgent(selected.id, { enabled: false });
      await refreshSelected(selected.id);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to disable agent",
      );
    }
  }

  const editor = creating ? blankAgent : selected;
  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_1fr]">
      <Card className="h-fit">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Configured agents</CardTitle>
            <CardDescription>Ordered for future runs.</CardDescription>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => void loadAgents()}
            disabled={loading}
          >
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button
            onClick={() => {
              setCreating(true);
              setSelected(null);
              setMessage(null);
            }}
          >
            <PlusIcon /> New agent
          </Button>
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => void selectAgent(agent)}
              className="flex items-center justify-between rounded-lg border p-3 text-left hover:bg-muted"
            >
              <span>
                <span className="block font-medium">{agent.name}</span>
                <span className="text-xs text-text-muted">
                  Layer {agent.layer} · Order {agent.executionOrder}
                </span>
              </span>
              <Badge variant={agent.enabled ? "success" : "disabled"}>
                {agent.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </button>
          ))}
        </CardContent>
      </Card>
      <div className="flex flex-col gap-6">
        {message && (
          <p className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
            {message}
          </p>
        )}
        {editor ? (
          <AgentEditor
            key={creating ? "new" : selected?.id}
            agent={editor}
            creating={creating}
            onSubmit={saveAgent}
            onDisable={disableAgent}
          />
        ) : (
          <Card>
            <CardContent className="py-10 text-sm text-text-muted">
              Select an agent or create one to begin.
            </CardContent>
          </Card>
        )}
        {selected && !creating && (
          <RouteEditor
            agent={selected}
            agents={agents}
            refresh={() => void refreshSelected(selected.id)}
            report={setMessage}
          />
        )}
      </div>
    </div>
  );
}

function AgentEditor({
  agent,
  creating,
  onSubmit,
  onDisable,
}: {
  agent: CreateAgent | AgentWithRoutes;
  creating: boolean;
  onSubmit: (input: CreateAgent) => void;
  onDisable: () => void;
}) {
  const [draft, setDraft] = useState<CreateAgent>({
    slug: agent.slug,
    name: agent.name,
    role: agent.role,
    description: agent.description,
    layer: agent.layer,
    executionOrder: agent.executionOrder,
    harness: agent.harness,
    model: agent.model,
    reasoning: agent.reasoning,
    systemPrompt: agent.systemPrompt,
    enabled: agent.enabled,
    canWrite: agent.canWrite,
    canRunCommands: agent.canRunCommands,
    canCommit: agent.canCommit,
  });
  const update = <K extends keyof CreateAgent>(key: K, value: CreateAgent[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const selectedHarness = (draft.harness ?? "codex") as Harness;
  const options = harnessOptions[selectedHarness];
  const changeHarness = (harness: Harness) => {
    const next = harnessOptions[harness];
    setDraft((current) => ({
      ...current,
      harness,
      model: next.models[0],
      reasoning: next.reasoning[0],
    }));
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{creating ? "New agent" : `Edit ${agent.name}`}</CardTitle>
        <CardDescription>
          These settings affect future runs only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(draft);
          }}
          className="grid gap-4 md:grid-cols-2"
        >
          <Field
            name="name"
            label="Name"
            value={draft.name}
            onChange={(event) => update("name", event.target.value)}
          />
          <Field
            name="slug"
            label="Slug"
            value={draft.slug}
            onChange={(event) => update("slug", event.target.value)}
          />
          <Field
            name="role"
            label="Role"
            value={draft.role}
            onChange={(event) => update("role", event.target.value)}
          />
          <Field
            name="description"
            label="Description"
            value={draft.description}
            onChange={(event) => update("description", event.target.value)}
          />
          <Field
            name="layer"
            label="Layer"
            value={String(draft.layer)}
            onChange={(event) => update("layer", Number(event.target.value))}
            type="number"
            min="1"
          />
          <Field
            name="executionOrder"
            label="Execution order"
            value={String(draft.executionOrder)}
            onChange={(event) =>
              update("executionOrder", Number(event.target.value))
            }
            type="number"
            min="1"
          />
          <label className="grid gap-1 text-sm">
            Harness
            <select
              name="harness"
              value={selectedHarness}
              onChange={(event) => changeHarness(event.target.value as Harness)}
              className="h-9 rounded-lg border bg-transparent px-2"
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Model
            <select
              name="model"
              value={draft.model ?? options.models[0]}
              onChange={(event) => update("model", event.target.value)}
              className="h-9 rounded-lg border bg-transparent px-2"
            >
              {options.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Reasoning
            <select
              name="reasoning"
              value={draft.reasoning ?? options.reasoning[0]}
              onChange={(event) => update("reasoning", event.target.value)}
              className="h-9 rounded-lg border bg-transparent px-2"
            >
              {options.reasoning.map((reasoning) => (
                <option key={reasoning} value={reasoning}>
                  {reasoning}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            System prompt
            <Textarea
              name="systemPrompt"
              value={draft.systemPrompt}
              onChange={(event) => update("systemPrompt", event.target.value)}
              required
              className="min-h-36"
            />
          </label>
          <div className="flex flex-wrap gap-4 text-sm md:col-span-2">
            {(
              ["enabled", "canWrite", "canRunCommands", "canCommit"] as const
            ).map((key) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={key}
                  checked={draft[key]}
                  onChange={(event) => update(key, event.target.checked)}
                />{" "}
                {key
                  .replace(/([A-Z])/g, " $1")
                  .replace(/^./, (letter) => letter.toUpperCase())}
              </label>
            ))}
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit">
              {creating ? "Create agent" : "Save changes"}
            </Button>
            {!creating && agent.enabled && (
              <Button type="button" variant="destructive" onClick={onDisable}>
                Disable agent
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  name,
  label,
  ...props
}: { name: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <Input name={name} required {...props} />
    </label>
  );
}

function RouteEditor({
  agent,
  agents,
  refresh,
  report,
}: {
  agent: AgentWithRoutes;
  agents: Agent[];
  refresh: () => void;
  report: (message: string | null) => void;
}) {
  async function addRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = String(form.get("target"));
    try {
      await createAgentRoute(agent.id, {
        outcome: String(form.get("outcome")) as AgentRouteOutcome,
        enabled: true,
        targetAgentId: target === "terminal" ? null : target,
        terminalAction:
          target === "terminal"
            ? (String(form.get("terminalAction")) as TerminalAction)
            : null,
      });
      event.currentTarget.reset();
      refresh();
    } catch (error) {
      report(error instanceof Error ? error.message : "Unable to add route");
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Outcome routes</CardTitle>
        <CardDescription>
          Overrides are applied by the future workflow engine.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {agent.routes.map((route) => (
          <div
            key={route.id}
            className="flex items-center justify-between rounded-lg border p-3 text-sm"
          >
            <span>
              <strong>{route.outcome}</strong> →{" "}
              {route.targetAgentId
                ? (agents.find(
                    (candidate) => candidate.id === route.targetAgentId,
                  )?.name ?? "Unknown agent")
                : route.terminalAction}
            </span>
            <span className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={route.enabled}
                  onChange={(event) =>
                    void updateAgentRoute(agent.id, route.id, {
                      enabled: event.target.checked,
                    })
                      .then(refresh)
                      .catch((error) => report(error.message))
                  }
                />{" "}
                enabled
              </label>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() =>
                  void deleteAgentRoute(agent.id, route.id)
                    .then(refresh)
                    .catch((error) => report(error.message))
                }
              >
                <Trash2Icon />
              </Button>
            </span>
          </div>
        ))}
        <form onSubmit={addRoute} className="grid gap-2 md:grid-cols-3">
          <select
            name="outcome"
            className="h-9 rounded-lg border bg-transparent px-2"
          >
            {outcomes.map((outcome) => (
              <option key={outcome}>{outcome}</option>
            ))}
          </select>
          <select
            name="target"
            className="h-9 rounded-lg border bg-transparent px-2"
          >
            <option value="terminal">Terminal action</option>
            {agents
              .filter(
                (candidate) => candidate.enabled && candidate.id !== agent.id,
              )
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
          <select
            name="terminalAction"
            className="h-9 rounded-lg border bg-transparent px-2"
          >
            {terminalActions.map((action) => (
              <option key={action}>{action}</option>
            ))}
          </select>
          <Button type="submit" className="md:col-span-3">
            Add route
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
