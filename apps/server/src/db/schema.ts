import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const harnessEnum = pgEnum("harness", ["claude", "codex"]);
export const agentRouteOutcomeEnum = pgEnum("agent_route_outcome", ["completed", "approved", "changes_requested", "blocked", "failed"]);
export const terminalActionEnum = pgEnum("terminal_action", ["complete_run", "fail_run", "block_run"]);
export const runStatusEnum = pgEnum("run_status", ["pending", "running", "completed", "failed", "blocked", "cancelled"]);
export const agentExecutionStatusEnum = pgEnum("agent_execution_status", ["pending", "starting", "running", "completed", "failed", "blocked", "cancelled"]);
export const agentResultStatusEnum = pgEnum("agent_result_status", ["completed", "approved", "changes_requested", "blocked", "failed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  description: text("description").notNull().default(""),
  layer: integer("layer").notNull(),
  executionOrder: integer("execution_order").notNull(),
  harness: harnessEnum("harness").notNull(),
  model: text("model").notNull(),
  reasoning: text("reasoning").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  canWrite: boolean("can_write").notNull().default(false),
  canRunCommands: boolean("can_run_commands").notNull().default(false),
  canCommit: boolean("can_commit").notNull().default(false),
  ...timestamps,
}, (table) => [
  unique("agents_layer_execution_order_unique").on(table.layer, table.executionOrder),
  check("agents_layer_check", sql`${table.layer} >= 1`),
  check("agents_execution_order_check", sql`${table.executionOrder} >= 1`),
]);

export const agentRoutes = pgTable("agent_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceAgentId: uuid("source_agent_id").notNull().references(() => agents.id),
  outcome: agentRouteOutcomeEnum("outcome").notNull(),
  targetAgentId: uuid("target_agent_id").references(() => agents.id),
  terminalAction: terminalActionEnum("terminal_action"),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
}, (table) => [
  unique("agent_routes_source_outcome_unique").on(table.sourceAgentId, table.outcome),
  check("agent_routes_destination_check", sql`(${table.targetAgentId} is null) <> (${table.terminalAction} is null)`),
]);

// Projects are filesystem paths (see project-discovery.ts) -- there is no `projects` table to
// reference. Layer/agent cursor and workflow state live in Phase 7; this table only tracks the
// run itself.
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id"),
  projectPath: text("project_path").notNull(),
  status: runStatusEnum("status").notNull().default("pending"),
  workflowSnapshot: jsonb("workflow_snapshot"),
  currentAgentId: uuid("current_agent_id"),
  executionCount: integer("execution_count").notNull().default(0),
  terminalReason: text("terminal_reason"),
  ...timestamps,
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectPath: text("project_path").notNull(),
  title: text("title").notNull(),
  instruction: text("instruction").notNull(),
  status: runStatusEnum("status").notNull().default("pending"),
  ...timestamps,
});

// `agentId` is nullable so execution history survives agent deletion. The denormalized
// agent/harness/model/reasoning columns stand in for a full run-snapshot system (Phase 7).
// `resultStatus`/`resultPayload`/`failureReason`/`repairAttempted` are populated by the
// structured completion contract (Phase 6, see agent-execution-service.ts). `resultStatus`
// stays nullable until a valid <orc-result> block is parsed; `agent_executions.status` itself
// only ever reflects completed/blocked/failed (did the process finish with a valid result), not
// the nuanced result outcome.
export const agentExecutions = pgTable("agent_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => runs.id),
  agentId: uuid("agent_id").references(() => agents.id),
  agentName: text("agent_name").notNull(),
  agentRole: text("agent_role").notNull(),
  layer: integer("layer").notNull(),
  executionOrder: integer("execution_order").notNull(),
  harness: harnessEnum("harness").notNull(),
  model: text("model").notNull(),
  reasoning: text("reasoning").notNull(),
  status: agentExecutionStatusEnum("status").notNull().default("pending"),
  pid: integer("pid"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  exitCode: integer("exit_code"),
  resultStatus: agentResultStatusEnum("result_status"),
  resultPayload: jsonb("result_payload"),
  tokenUsage: jsonb("token_usage"),
  contextUsage: jsonb("context_usage"),
  commitHash: text("commit_hash"),
  failureReason: text("failure_reason"),
  repairAttempted: boolean("repair_attempted").notNull().default(false),
  ...timestamps,
}, (table) => [
  index("agent_executions_run_id_idx").on(table.runId),
  index("agent_executions_agent_id_idx").on(table.agentId),
]);

// Only `output`-type RuntimeEvents become rows here (raw, unparsed PTY/ANSI text). `provider`,
// `usage`, `diagnostic`, and `exit` events update `agent_executions` columns instead.
export const terminalChunks = pgTable("terminal_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentExecutionId: uuid("agent_execution_id").notNull().references(() => agentExecutions.id),
  sequence: integer("sequence").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("terminal_chunks_execution_sequence_unique").on(table.agentExecutionId, table.sequence),
]);

export const orchestratorSettings = pgTable("orchestrator_settings", {
  id: integer("id").primaryKey().default(1), harness: harnessEnum("harness").notNull().default("codex"), model: text("model").notNull().default("default"), reasoning: text("reasoning").notNull().default("medium"), systemPrompt: text("system_prompt").notNull().default("You supervise engineering workflows. Use only supplied state and be concise."), ...timestamps,
});
export const conversations = pgTable("conversations", { id: uuid("id").primaryKey().defaultRandom(), projectPath: text("project_path").notNull(), taskId: uuid("task_id"), runId: uuid("run_id"), ...timestamps });
export const conversationMessages = pgTable("conversation_messages", { id: uuid("id").primaryKey().defaultRandom(), conversationId: uuid("conversation_id").notNull().references(() => conversations.id), role: text("role").notNull(), content: text("content").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow() }, (table) => [check("conversation_messages_role_check", sql`${table.role} in ('user', 'assistant')`)]);
export const domainEvents = pgTable("domain_events", { id: uuid("id").primaryKey().defaultRandom(), type: text("type").notNull(), projectPath: text("project_path").notNull(), taskId: uuid("task_id"), runId: uuid("run_id"), agentExecutionId: uuid("agent_execution_id"), data: jsonb("data").notNull().default({}), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow() }, (table) => [index("domain_events_run_id_created_at_idx").on(table.runId, table.createdAt)]);
