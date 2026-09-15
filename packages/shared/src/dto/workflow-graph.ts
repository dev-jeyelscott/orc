import { z } from "zod";

import { agentRouteOutcomeSchema, terminalActionSchema } from "../enums/agent-route.js";

/**
 * Explicit-node workflow graph contracts (Draft/Published revisions,
 * Start/Agent/terminal nodes, outcome edges, and structured validation).
 * Deliberately separate from `team-workflow.ts`'s layer-oriented contract,
 * which continues to model legacy Team topology until it is cut over.
 */

export const workflowRevisionStateSchema = z.enum(["draft", "published"]);
export const workflowNodeKindSchema = z.enum(["start", "agent", "terminal"]);

const MAX_NODES = 100;
const MAX_EDGES = 500;
const MAX_COORDINATE = 100_000;

const positionSchema = z.object({
  x: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
  y: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
});

const startNodeSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("start"),
  position: positionSchema,
});

const agentNodeSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("agent"),
  agentId: z.string().uuid(),
  position: positionSchema,
});

const terminalNodeSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("terminal"),
  terminalAction: terminalActionSchema,
  position: positionSchema,
});

export const workflowGraphNodeSchema = z.discriminatedUnion("kind", [
  startNodeSchema,
  agentNodeSchema,
  terminalNodeSchema,
]);

export const workflowGraphEdgeSchema = z.object({
  id: z.string().uuid(),
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  outcome: agentRouteOutcomeSchema.nullable(),
});

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowGraphNodeSchema).max(MAX_NODES),
  edges: z.array(workflowGraphEdgeSchema).max(MAX_EDGES),
});

/** Request body for `PUT /api/teams/:teamId/workflow/draft`. */
export const saveWorkflowDraftSchema = workflowGraphSchema;

/**
 * Stable, machine-readable issue codes produced by graph validation.
 * Referenced by string constant (not re-typed) by the validation service.
 */
export const workflowValidationIssueCodes = [
  "missing_start",
  "invalid_start_edge",
  "missing_team_agent_node",
  "duplicate_agent_node",
  "agent_not_team_member",
  "agent_disabled",
  "unreachable_agent",
  "invalid_edge_outcome",
  "duplicate_outcome_edge",
  "cross_revision_edge",
  "terminal_has_outgoing_edge",
  "terminal_action_invalid",
  "missing_outcome_edge",
  "workflow_advisory",
] as const;

export const workflowValidationIssueCodeSchema = z.enum(workflowValidationIssueCodes);

export const workflowValidationIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: workflowValidationIssueCodeSchema,
  message: z.string(),
  nodeId: z.string().uuid().optional(),
  edgeId: z.string().uuid().optional(),
  outcome: agentRouteOutcomeSchema.optional(),
});

export const workflowValidationResultSchema = z.object({
  errors: z.array(workflowValidationIssueSchema),
  warnings: z.array(workflowValidationIssueSchema),
  publishable: z.boolean(),
});

export const workflowDraftSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  graph: workflowGraphSchema,
  updatedAt: z.string(),
});

export const workflowPublishedRevisionSummarySchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  version: z.number().int().min(1),
  publishedAt: z.string(),
  nodeCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
});

export const workflowPublishedRevisionSchema = workflowPublishedRevisionSummarySchema.extend({
  graph: workflowGraphSchema,
});

export const publishWorkflowResponseSchema = z.object({
  revision: workflowPublishedRevisionSummarySchema,
  validation: workflowValidationResultSchema,
});

export const workflowAggregateSchema = z.object({
  teamId: z.string().uuid(),
  draft: workflowDraftSchema,
  published: workflowPublishedRevisionSummarySchema.nullable(),
  publishedRevisionHistory: z.array(workflowPublishedRevisionSummarySchema),
  validation: workflowValidationResultSchema,
});

/**
 * Shape-only for now; unused until the stable node-execution/attempt
 * grouping slice lands. Added here so this contract module stays stable
 * for later slices to import without another shared-package version bump.
 */
export const workflowNodeExecutionSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  workflowNodeId: z.string().uuid(),
  agentId: z.string().uuid().nullable(),
});

/** Resolved effective Agent runtime configuration snapshotted at Run start. */
export const workflowRunSnapshotAgentNodeSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("agent"),
  agentId: z.string().uuid(),
  name: z.string(),
  role: z.string(),
  harness: z.string(),
  model: z.string(),
  reasoning: z.string(),
  systemPrompt: z.string(),
  canWrite: z.boolean(),
  canRunCommands: z.boolean(),
  sandboxMode: z.string(),
  canCommit: z.boolean(),
});

/**
 * One resolved outcome route inside a Run's immutable snapshot, derived
 * from Published graph edges at Run start. Matches the server's internal
 * `SnapshotRoute` shape so a graph Run's snapshot stays a structural
 * superset of the legacy layer/order snapshot -- every existing consumer
 * that reads `snapshot.agents`/`snapshot.routes` keeps working unchanged
 * for both, and only outcome-resolution logic needs to branch on version.
 */
export const workflowRunSnapshotRouteSchema = z.object({
  sourceAgentId: z.string().uuid(),
  outcome: agentRouteOutcomeSchema,
  targetAgentId: z.string().uuid().nullable(),
  terminalAction: terminalActionSchema.nullable(),
});

/**
 * A graph-based (Snapshot V2) Run snapshot: the same `agents`/`routes`
 * shape legacy Snapshot V1 uses, tagged with `version: 2` and the
 * Published revision it was resolved from. `routes` here is exhaustive --
 * it always contains every edge from the Published graph, so an outcome
 * with no matching route means no edge was configured, not "apply a
 * default/fallback."
 */
export const workflowRunSnapshotV2Schema = z.object({
  version: z.literal(2),
  workflowRevisionId: z.string().uuid(),
  agents: z.array(workflowRunSnapshotAgentNodeSchema),
  routes: z.array(workflowRunSnapshotRouteSchema),
  knowledgeContext: z.unknown().optional(),
  taskDocumentContext: z.unknown().optional(),
});

export type WorkflowRevisionState = z.infer<typeof workflowRevisionStateSchema>;
export type WorkflowNodeKind = z.infer<typeof workflowNodeKindSchema>;
export type WorkflowGraphNode = z.infer<typeof workflowGraphNodeSchema>;
export type WorkflowGraphEdge = z.infer<typeof workflowGraphEdgeSchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
export type SaveWorkflowDraft = z.infer<typeof saveWorkflowDraftSchema>;
export type WorkflowValidationIssueCode = z.infer<typeof workflowValidationIssueCodeSchema>;
export type WorkflowValidationIssue = z.infer<typeof workflowValidationIssueSchema>;
export type WorkflowValidationResult = z.infer<typeof workflowValidationResultSchema>;
export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;
export type WorkflowPublishedRevisionSummary = z.infer<typeof workflowPublishedRevisionSummarySchema>;
export type WorkflowPublishedRevision = z.infer<typeof workflowPublishedRevisionSchema>;
export type PublishWorkflowResponse = z.infer<typeof publishWorkflowResponseSchema>;
export type WorkflowAggregate = z.infer<typeof workflowAggregateSchema>;
export type WorkflowNodeExecution = z.infer<typeof workflowNodeExecutionSchema>;
export type WorkflowRunSnapshotV2 = z.infer<typeof workflowRunSnapshotV2Schema>;
