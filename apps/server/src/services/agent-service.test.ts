import { eq, or } from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import { db } from "../db/client.js";
import {
  agentExecutions,
  agentRoutes,
  agents,
  runs,
} from "../db/schema.js";
import {
  createAgentRoute,
  deleteAgent,
  updateAgent,
  updateAgentRoute,
} from "./agent-service.js";

const createdAgentIds = new Set<string>();
const createdRunIds = new Set<string>();

let nextLayer =
  100_000 + Math.floor(Math.random() * 100_000_000);

/**
 * Creates a uniquely ordered test agent and tracks it for cleanup.
 */
async function createTestAgent(
  label: string,
  enabled = true,
) {
  const [agent] = await db
    .insert(agents)
    .values({
      slug: `test-${label.toLowerCase()}-${crypto.randomUUID()}`,
      name: `Test ${label}`,
      role: label,
      description: `${label} test agent`,
      layer: nextLayer++,
      executionOrder: 1,
      harness: "codex",
      model: "default",
      reasoning: "high",
      systemPrompt: `Act as the ${label} test agent.`,
      enabled,
      canWrite: false,
      canRunCommands: true,
      canCommit: false,
    })
    .returning();

  createdAgentIds.add(agent.id);
  return agent;
}

/**
 * Creates a tracked run with the supplied workflow snapshot and status.
 */
async function createTestRun(
  workflowSnapshot: unknown,
  status: "pending" | "running" | "completed" = "completed",
) {
  const [run] = await db
    .insert(runs)
    .values({
      projectPath: "/tmp/orc-agent-service-test",
      status,
      workflowSnapshot,
    })
    .returning();

  createdRunIds.add(run.id);
  return run;
}

describe("agent-service", () => {
  afterEach(async () => {
    for (const runId of createdRunIds) {
      await db
        .delete(agentExecutions)
        .where(eq(agentExecutions.runId, runId));

      await db
        .delete(runs)
        .where(eq(runs.id, runId));
    }

    for (const agentId of createdAgentIds) {
      await db
        .delete(agentRoutes)
        .where(
          or(
            eq(agentRoutes.sourceAgentId, agentId),
            eq(agentRoutes.targetAgentId, agentId),
          ),
        );
    }

    for (const agentId of createdAgentIds) {
      await db
        .delete(agents)
        .where(eq(agents.id, agentId));
    }

    createdRunIds.clear();
    createdAgentIds.clear();
  });

  it("keeps route enabled state independent from agent enabled state", async () => {
    const source = await createTestAgent("Source");
    const target = await createTestAgent("Target");

    const route = await createAgentRoute(source.id, {
      outcome: "changes_requested",
      targetAgentId: target.id,
      terminalAction: null,
      enabled: true,
    });

    await updateAgent(source.id, { enabled: false });
    await updateAgent(target.id, { enabled: false });

    const [persisted] = await db
      .select()
      .from(agentRoutes)
      .where(eq(agentRoutes.id, route.id));

    expect(persisted.enabled).toBe(true);
    expect(persisted.sourceAgentId).toBe(source.id);
    expect(persisted.targetAgentId).toBe(target.id);

    await updateAgent(source.id, { enabled: true });
    await updateAgent(target.id, { enabled: true });

    const [restored] = await db
      .select()
      .from(agentRoutes)
      .where(eq(agentRoutes.id, route.id));

    expect(restored.enabled).toBe(true);
  });

  it("edits outcome, destination, terminal action, and enabled state in place", async () => {
    const source = await createTestAgent("Editor");
    const target = await createTestAgent("Target");

    const route = await createAgentRoute(source.id, {
      outcome: "changes_requested",
      targetAgentId: target.id,
      terminalAction: null,
      enabled: true,
    });

    const terminalRoute = await updateAgentRoute(
      source.id,
      route.id,
      {
        outcome: "failed",
        targetAgentId: null,
        terminalAction: "fail_run",
        enabled: false,
      },
    );

    expect(terminalRoute).toMatchObject({
      id: route.id,
      outcome: "failed",
      targetAgentId: null,
      terminalAction: "fail_run",
      enabled: false,
    });

    const targetRoute = await updateAgentRoute(
      source.id,
      route.id,
      {
        outcome: "changes_requested",
        targetAgentId: target.id,
        terminalAction: null,
        enabled: true,
      },
    );

    expect(targetRoute).toMatchObject({
      id: route.id,
      outcome: "changes_requested",
      targetAgentId: target.id,
      terminalAction: null,
      enabled: true,
    });
  });

  it("rejects an enabled route when its target is disabled", async () => {
    const source = await createTestAgent("Source");
    const target = await createTestAgent("Unavailable");

    const route = await createAgentRoute(source.id, {
      outcome: "changes_requested",
      targetAgentId: target.id,
      terminalAction: null,
      enabled: true,
    });

    await updateAgent(target.id, { enabled: false });

    await expect(
      updateAgentRoute(source.id, route.id, {
        targetAgentId: target.id,
        terminalAction: null,
        enabled: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });

    const disabledRoute = await updateAgentRoute(
      source.id,
      route.id,
      {
        enabled: false,
      },
    );

    expect(disabledRoute?.enabled).toBe(false);
  });

  it("preserves historical executions and snapshots after safe deletion", async () => {
    const source = await createTestAgent("Historical");
    const target = await createTestAgent("Target");

    await createAgentRoute(source.id, {
      outcome: "changes_requested",
      targetAgentId: target.id,
      terminalAction: null,
      enabled: true,
    });

    await createAgentRoute(target.id, {
      outcome: "failed",
      targetAgentId: source.id,
      terminalAction: null,
      enabled: true,
    });

    const workflowSnapshot = {
      agents: [
        {
          id: source.id,
          name: source.name,
          role: source.role,
        },
      ],
      routes: [],
    };

    const run = await createTestRun(
      workflowSnapshot,
      "completed",
    );

    const [execution] = await db
      .insert(agentExecutions)
      .values({
        runId: run.id,
        agentId: source.id,
        agentName: source.name,
        agentRole: source.role,
        layer: source.layer,
        executionOrder: source.executionOrder,
        harness: source.harness,
        model: source.model,
        reasoning: source.reasoning,
        status: "completed",
        completedAt: new Date(),
      })
      .returning();

    expect(await deleteAgent(source.id)).toBe(true);

    const [deletedAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, source.id));

    expect(deletedAgent).toBeUndefined();

    const [historicalExecution] = await db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.id, execution.id));

    expect(historicalExecution).toMatchObject({
      id: execution.id,
      agentId: null,
      agentName: source.name,
      agentRole: source.role,
    });

    const remainingReferences = await db
      .select()
      .from(agentRoutes)
      .where(
        or(
          eq(agentRoutes.sourceAgentId, source.id),
          eq(agentRoutes.targetAgentId, source.id),
        ),
      );

    expect(remainingReferences).toHaveLength(0);

    const [historicalRun] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, run.id));

    expect(historicalRun.workflowSnapshot).toEqual(
      workflowSnapshot,
    );
  });

  it("rejects deletion when an active run snapshot contains the agent", async () => {
    const source = await createTestAgent("Active");

    const run = await createTestRun(
      {
        agents: [
          {
            id: source.id,
            name: source.name,
            role: source.role,
          },
        ],
        routes: [],
      },
      "running",
    );

    await expect(
      deleteAgent(source.id),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining(run.id),
    });

    const [persistedAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, source.id));

    expect(persistedAgent?.id).toBe(source.id);
  });
});
