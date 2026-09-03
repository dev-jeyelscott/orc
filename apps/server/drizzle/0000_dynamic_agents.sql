CREATE TYPE "public"."harness" AS ENUM('claude', 'codex');
CREATE TYPE "public"."agent_route_outcome" AS ENUM('completed', 'approved', 'changes_requested', 'blocked', 'failed');
CREATE TYPE "public"."terminal_action" AS ENUM('complete_run', 'fail_run', 'block_run');

CREATE TABLE "agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "layer" integer NOT NULL,
  "execution_order" integer NOT NULL,
  "harness" "harness" NOT NULL,
  "model" text NOT NULL,
  "reasoning" text NOT NULL,
  "system_prompt" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "can_write" boolean DEFAULT false NOT NULL,
  "can_run_commands" boolean DEFAULT false NOT NULL,
  "can_commit" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agents_layer_execution_order_unique" UNIQUE("layer", "execution_order"),
  CONSTRAINT "agents_layer_check" CHECK ("layer" >= 1),
  CONSTRAINT "agents_execution_order_check" CHECK ("execution_order" >= 1)
);

CREATE TABLE "agent_routes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "outcome" "agent_route_outcome" NOT NULL,
  "target_agent_id" uuid REFERENCES "agents"("id"),
  "terminal_action" "terminal_action",
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_routes_source_outcome_unique" UNIQUE("source_agent_id", "outcome"),
  CONSTRAINT "agent_routes_destination_check" CHECK (("target_agent_id" is null) <> ("terminal_action" is null))
);

INSERT INTO "agents" ("id", "slug", "name", "role", "description", "layer", "execution_order", "harness", "model", "reasoning", "system_prompt", "can_write", "can_run_commands", "can_commit") VALUES
('00000000-0000-4000-8000-000000000001', 'architect', 'Architect', 'Architect', 'Plans implementation work', 1, 1, 'codex', 'default', 'high', 'Analyze the requested work and the repository. Produce an implementation plan with clear acceptance criteria. Do not modify files, run destructive commands, or commit changes.', false, true, false),
('00000000-0000-4000-8000-000000000002', 'builder', 'Builder', 'Builder', 'Implements approved work', 2, 1, 'claude', 'default', 'high', 'Implement the requested work in the selected repository. Validate relevant changes, keep the scope focused, and commit the completed work when appropriate.', true, true, true),
('00000000-0000-4000-8000-000000000003', 'qa', 'QA', 'QA', 'Reviews and validates completed work', 3, 1, 'codex', 'default', 'high', 'Review the implementation and run relevant validation. Report approval, requested changes, blockers, or failures using the required structured completion contract. Do not modify files or commit changes.', false, true, false);

INSERT INTO "agent_routes" ("source_agent_id", "outcome", "target_agent_id", "terminal_action") VALUES
('00000000-0000-4000-8000-000000000003', 'changes_requested', '00000000-0000-4000-8000-000000000002', NULL),
('00000000-0000-4000-8000-000000000003', 'blocked', NULL, 'block_run'),
('00000000-0000-4000-8000-000000000003', 'failed', NULL, 'fail_run');
