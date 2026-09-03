import { describe, expect, it } from "vitest";
import type {
  DomainEvent,
  ProjectListResponse,
  RunStatus,
} from "@orc/shared";

import {
  DASHBOARD_EVENT_LIMIT,
  buildProjectSummary,
  buildStatusCounts,
  limitDashboardEvents,
  readContextUsage,
  readTokenTotal,
  selectActivityCandidate,
} from "./dashboard-service.js";

/**
 * Creates a minimal project-discovery response for aggregation tests.
 */
function makeProjectList(
  projects: ProjectListResponse["projects"] = [],
): ProjectListResponse {
  return {
    projects,
    workspaceRoot: "/tmp/workspace",
    error: null,
  };
}

/**
 * Creates a domain event at a deterministic timestamp for event-ordering tests.
 */
function makeEvent(index: number): DomainEvent {
  return {
    id: crypto.randomUUID(),
    type: `event.${index}`,
    projectPath: "/tmp/workspace/project",
    taskId: null,
    runId: null,
    agentExecutionId: null,
    data: {},
    createdAt: new Date(
      Date.UTC(2026, 0, 1, 0, index, 0),
    ).toISOString(),
  };
}

describe("dashboard-service aggregation helpers", () => {
  it("produces complete empty status and project summaries", () => {
    expect(buildStatusCounts([])).toEqual({
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
      cancelled: 0,
    });

    expect(buildProjectSummary(makeProjectList())).toEqual({
      discovered: 0,
      clean: 0,
      dirty: 0,
      unknown: 0,
      workspaceRoot: "/tmp/workspace",
      error: null,
    });
  });

  it("aggregates every supported workflow status", () => {
    const statuses: RunStatus[] = [
      "pending",
      "running",
      "completed",
      "failed",
      "blocked",
      "cancelled",
    ];

    expect(
      buildStatusCounts(
        statuses.map((status, index) => ({
          status,
          count: index + 1,
        })),
      ),
    ).toEqual({
      pending: 1,
      running: 2,
      completed: 3,
      failed: 4,
      blocked: 5,
      cancelled: 6,
    });
  });

  it("selects the active run before a newer historical candidate", () => {
    expect(
      selectActivityCandidate(
        { id: "active" },
        { id: "recent" },
      ),
    ).toEqual({
      kind: "active",
      run: { id: "active" },
    });

    expect(
      selectActivityCandidate(null, { id: "recent" }),
    ).toEqual({
      kind: "recent",
      run: { id: "recent" },
    });
  });

  it("limits recent events and orders them newest first", () => {
    const events = Array.from(
      { length: DASHBOARD_EVENT_LIMIT + 4 },
      (_, index) => makeEvent(index),
    );

    const result = limitDashboardEvents(events);

    expect(result).toHaveLength(DASHBOARD_EVENT_LIMIT);
    expect(result[0]?.type).toBe(
      `event.${DASHBOARD_EVENT_LIMIT + 3}`,
    );
    expect(
      Date.parse(result[0]!.createdAt),
    ).toBeGreaterThan(
      Date.parse(result[result.length - 1]!.createdAt),
    );
  });

  it("reports token and context telemetry only from supported numeric fields", () => {
    expect(
      readTokenTotal({
        total_tokens: 241_000,
      }),
    ).toBe(241_000);

    expect(
      readTokenTotal({
        input_tokens: 100,
        output_tokens: 40,
      }),
    ).toBe(140);

    expect(
      readTokenTotal({
        estimated: 999,
      }),
    ).toBeNull();

    expect(
      readContextUsage({
        used: 630,
        limit: 1_000,
      }),
    ).toEqual({
      used: 630,
      limit: 1_000,
      percent: 63,
    });

    expect(
      readContextUsage({
        used: 630,
      }),
    ).toBeNull();
  });
});
