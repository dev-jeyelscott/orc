ALTER TABLE "agents" ALTER COLUMN "role" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "harness" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "reasoning" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "system_prompt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "model_override" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "reasoning_override" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "additional_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint

-- Compatibility backfill: create one reusable Department per existing Agent
-- using that Agent's current role/harness/model/reasoning/prompt/capability
-- values as Department defaults, then point the Agent at it. This preserves
-- byte-for-byte effective behavior without guessing which legacy Agents
-- should share a Department.
INSERT INTO "departments" (
  "slug",
  "name",
  "role",
  "description",
  "enabled",
  "harness",
  "default_model",
  "default_reasoning",
  "system_prompt",
  "can_write",
  "can_run_commands",
  "sandbox_mode",
  "can_commit"
)
SELECT
  'legacy-' || a."slug",
  a."name" || ' (Legacy)',
  a."role",
  a."description",
  true,
  a."harness",
  a."model",
  a."reasoning",
  a."system_prompt",
  a."can_write",
  a."can_run_commands",
  a."sandbox_mode",
  a."can_commit"
FROM "agents" a;
--> statement-breakpoint

UPDATE "agents" a
SET "department_id" = d."id"
FROM "departments" d
WHERE d."slug" = 'legacy-' || a."slug";
--> statement-breakpoint

ALTER TABLE "agents" ALTER COLUMN "department_id" SET NOT NULL;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
