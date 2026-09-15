import { describe, expect, it } from "vitest";

import {
  publishWorkflowResponseSchema,
  saveWorkflowDraftSchema,
  workflowGraphEdgeSchema,
  workflowGraphNodeSchema,
  workflowGraphSchema,
  workflowValidationResultSchema,
} from "./workflow-graph.js";

const uuid1 = "00000000-0000-4000-8000-000000000001";
const uuid2 = "00000000-0000-4000-8000-000000000002";

describe("workflowGraphNodeSchema", () => {
  it("accepts a start node", () => {
    const result = workflowGraphNodeSchema.safeParse({
      id: uuid1,
      kind: "start",
      position: { x: 0, y: 0 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an agent node with agentId", () => {
    const result = workflowGraphNodeSchema.safeParse({
      id: uuid1,
      kind: "agent",
      agentId: uuid2,
      position: { x: 10, y: -10 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a terminal node with terminalAction", () => {
    const result = workflowGraphNodeSchema.safeParse({
      id: uuid1,
      kind: "terminal",
      terminalAction: "complete_run",
      position: { x: 0, y: 0 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an agent node missing agentId", () => {
    const result = workflowGraphNodeSchema.safeParse({
      id: uuid1,
      kind: "agent",
      position: { x: 0, y: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported node kind", () => {
    const result = workflowGraphNodeSchema.safeParse({
      id: uuid1,
      kind: "condition",
      position: { x: 0, y: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-finite position coordinates", () => {
    const result = workflowGraphNodeSchema.safeParse({
      id: uuid1,
      kind: "start",
      position: { x: Number.POSITIVE_INFINITY, y: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-bounds position coordinates", () => {
    const result = workflowGraphNodeSchema.safeParse({
      id: uuid1,
      kind: "start",
      position: { x: 1_000_000, y: 0 },
    });
    expect(result.success).toBe(false);
  });
});

describe("workflowGraphEdgeSchema", () => {
  it("accepts a Start-style edge with a null outcome", () => {
    const result = workflowGraphEdgeSchema.safeParse({
      id: uuid1,
      sourceNodeId: uuid1,
      targetNodeId: uuid2,
      outcome: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an Agent outcome edge", () => {
    const result = workflowGraphEdgeSchema.safeParse({
      id: uuid1,
      sourceNodeId: uuid1,
      targetNodeId: uuid2,
      outcome: "completed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-uuid node id", () => {
    const result = workflowGraphEdgeSchema.safeParse({
      id: uuid1,
      sourceNodeId: "not-a-uuid",
      targetNodeId: uuid2,
      outcome: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported outcome", () => {
    const result = workflowGraphEdgeSchema.safeParse({
      id: uuid1,
      sourceNodeId: uuid1,
      targetNodeId: uuid2,
      outcome: "skipped",
    });
    expect(result.success).toBe(false);
  });
});

describe("workflowGraphSchema bounds", () => {
  function startNode(id: string) {
    return { id, kind: "start" as const, position: { x: 0, y: 0 } };
  }

  it("accepts up to 100 nodes", () => {
    const nodes = Array.from({ length: 100 }, (_, index) =>
      startNode(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    );
    const result = workflowGraphSchema.safeParse({ nodes, edges: [] });
    expect(result.success).toBe(true);
  });

  it("rejects 101 nodes", () => {
    const nodes = Array.from({ length: 101 }, (_, index) =>
      startNode(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    );
    const result = workflowGraphSchema.safeParse({ nodes, edges: [] });
    expect(result.success).toBe(false);
  });

  it("rejects 501 edges", () => {
    const edges = Array.from({ length: 501 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      sourceNodeId: uuid1,
      targetNodeId: uuid2,
      outcome: null,
    }));
    const result = workflowGraphSchema.safeParse({ nodes: [], edges });
    expect(result.success).toBe(false);
  });
});

describe("saveWorkflowDraftSchema", () => {
  it("accepts an empty graph (incomplete drafts are allowed)", () => {
    const result = saveWorkflowDraftSchema.safeParse({ nodes: [], edges: [] });
    expect(result.success).toBe(true);
  });
});

describe("workflowValidationResultSchema", () => {
  it("accepts a publishable result with no issues", () => {
    const result = workflowValidationResultSchema.safeParse({
      errors: [],
      warnings: [],
      publishable: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an issue with a stable code and optional node/edge references", () => {
    const result = workflowValidationResultSchema.safeParse({
      errors: [
        {
          severity: "error",
          code: "missing_start",
          message: "Start node is missing.",
        },
      ],
      warnings: [
        {
          severity: "warning",
          code: "missing_outcome_edge",
          message: "3 unconfigured outcome routes",
          nodeId: uuid1,
          outcome: "blocked",
        },
      ],
      publishable: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown issue code", () => {
    const result = workflowValidationResultSchema.safeParse({
      errors: [
        {
          severity: "error",
          code: "not_a_real_code",
          message: "x",
        },
      ],
      warnings: [],
      publishable: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("publishWorkflowResponseSchema", () => {
  it("accepts a published revision summary with validation", () => {
    const result = publishWorkflowResponseSchema.safeParse({
      revision: {
        id: uuid1,
        teamId: uuid2,
        version: 1,
        publishedAt: new Date().toISOString(),
        nodeCount: 4,
        edgeCount: 1,
      },
      validation: { errors: [], warnings: [], publishable: true },
    });
    expect(result.success).toBe(true);
  });
});
