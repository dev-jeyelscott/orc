CREATE TABLE "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

INSERT INTO "teams" (
  "id",
  "slug",
  "name",
  "description",
  "enabled"
)
VALUES
(
  '00000000-0000-4000-9000-000000000001',
  'resolution',
  'Resolution Team',
  'Primary resolution workflow Team.',
  true
),
(
  '00000000-0000-4000-9000-000000000002',
  'development',
  'Development Team',
  'Independent development workflow Team.',
  true
);
--> statement-breakpoint

ALTER TABLE "agents"
ADD COLUMN "team_id" uuid
DEFAULT '00000000-0000-4000-9000-000000000001'
NOT NULL;
--> statement-breakpoint

ALTER TABLE "conversations"
ADD COLUMN "team_id" uuid
DEFAULT '00000000-0000-4000-9000-000000000001'
NOT NULL;
--> statement-breakpoint

ALTER TABLE "runs"
ADD COLUMN "team_id" uuid
DEFAULT '00000000-0000-4000-9000-000000000001'
NOT NULL;
--> statement-breakpoint

ALTER TABLE "tasks"
ADD COLUMN "team_id" uuid
DEFAULT '00000000-0000-4000-9000-000000000001'
NOT NULL;
--> statement-breakpoint

ALTER TABLE "agents"
DROP CONSTRAINT "agents_layer_execution_order_unique";
--> statement-breakpoint

ALTER TABLE "agents"
ADD CONSTRAINT "agents_team_layer_execution_order_unique"
UNIQUE("team_id", "layer", "execution_order");
--> statement-breakpoint

ALTER TABLE "agents"
ADD CONSTRAINT "agents_team_id_teams_id_fk"
FOREIGN KEY ("team_id")
REFERENCES "public"."teams"("id")
ON DELETE restrict
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_team_id_teams_id_fk"
FOREIGN KEY ("team_id")
REFERENCES "public"."teams"("id")
ON DELETE restrict
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "runs"
ADD CONSTRAINT "runs_team_id_teams_id_fk"
FOREIGN KEY ("team_id")
REFERENCES "public"."teams"("id")
ON DELETE restrict
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_team_id_teams_id_fk"
FOREIGN KEY ("team_id")
REFERENCES "public"."teams"("id")
ON DELETE restrict
ON UPDATE no action;
--> statement-breakpoint

INSERT INTO "agents" (
  "id",
  "team_id",
  "slug",
  "name",
  "role",
  "description",
  "layer",
  "execution_order",
  "harness",
  "model",
  "reasoning",
  "system_prompt",
  "enabled",
  "can_write",
  "can_run_commands",
  "can_commit"
)
VALUES
(
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-9000-000000000002',
  'development-architect',
  'Development Architect',
  'Architect',
  'Plans implementation work for the Development Team',
  1,
  1,
  'codex',
  'default',
  'high',
  'Analyze the requested work and the repository. Produce an implementation plan with clear acceptance criteria. Do not modify files, run destructive commands, or commit changes.',
  false,
  false,
  true,
  false
),
(
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-9000-000000000002',
  'development-builder',
  'Development Builder',
  'Builder',
  'Implements approved work for the Development Team',
  2,
  1,
  'claude',
  'default',
  'high',
  'Implement the requested work in the selected repository. Validate relevant changes, keep the scope focused, and commit the completed work when appropriate.',
  false,
  true,
  true,
  true
),
(
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-9000-000000000002',
  'development-qa',
  'Development QA',
  'QA',
  'Reviews and validates completed work for the Development Team',
  3,
  1,
  'codex',
  'default',
  'high',
  'Review the implementation and run relevant validation. Report approval, requested changes, blockers, or failures using the required structured completion contract. Do not modify files or commit changes.',
  false,
  false,
  true,
  false
);
--> statement-breakpoint

INSERT INTO "agent_routes" (
  "source_agent_id",
  "outcome",
  "target_agent_id",
  "terminal_action",
  "enabled"
)
VALUES
(
  '00000000-0000-4000-8000-000000000103',
  'changes_requested',
  '00000000-0000-4000-8000-000000000102',
  NULL,
  false
),
(
  '00000000-0000-4000-8000-000000000103',
  'blocked',
  NULL,
  'block_run',
  false
),
(
  '00000000-0000-4000-8000-000000000103',
  'failed',
  NULL,
  'fail_run',
  false
);
