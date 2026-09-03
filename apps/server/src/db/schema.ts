import { boolean, check, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const harnessEnum = pgEnum("harness", ["claude", "codex"]);
export const agentRouteOutcomeEnum = pgEnum("agent_route_outcome", ["completed", "approved", "changes_requested", "blocked", "failed"]);
export const terminalActionEnum = pgEnum("terminal_action", ["complete_run", "fail_run", "block_run"]);

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
