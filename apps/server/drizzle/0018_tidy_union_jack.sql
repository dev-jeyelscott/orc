CREATE TABLE IF NOT EXISTS "team_member_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_team_member_id" uuid NOT NULL,
	"outcome" "agent_route_outcome" NOT NULL,
	"target_team_member_id" uuid,
	"terminal_action" "terminal_action",
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_member_routes_source_outcome_unique" UNIQUE("source_team_member_id","outcome"),
	CONSTRAINT "team_member_routes_destination_check" CHECK (("team_member_routes"."target_team_member_id" is null) <> ("team_member_routes"."terminal_action" is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"layer" integer NOT NULL,
	"execution_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_agent_id_unique" UNIQUE("agent_id"),
	CONSTRAINT "team_members_team_department_unique" UNIQUE("team_id","department_id"),
	CONSTRAINT "team_members_team_layer_execution_order_unique" UNIQUE("team_id","layer","execution_order"),
	CONSTRAINT "team_members_layer_check" CHECK ("team_members"."layer" >= 1),
	CONSTRAINT "team_members_execution_order_check" CHECK ("team_members"."execution_order" >= 1)
);
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "layer" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "execution_order" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_member_routes" ADD CONSTRAINT "team_member_routes_source_team_member_id_team_members_id_fk" FOREIGN KEY ("source_team_member_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_member_routes" ADD CONSTRAINT "team_member_routes_target_team_member_id_team_members_id_fk" FOREIGN KEY ("target_team_member_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_id_department_id_unique" UNIQUE("id","department_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_agent_department_fk" FOREIGN KEY ("agent_id","department_id") REFERENCES "public"."agents"("id","department_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Backfill: every currently persisted Agent Team/layer/execution-order
-- placement becomes an equivalent team_members row. Agents without a
-- legacy layer/execution_order (created after this migration precedes
-- application cutover) are intentionally skipped; they have no workflow
-- placement to backfill.
INSERT INTO "team_members" (
  "team_id",
  "department_id",
  "agent_id",
  "layer",
  "execution_order"
)
SELECT
  "team_id",
  "department_id",
  "id",
  "layer",
  "execution_order"
FROM "agents"
WHERE "layer" IS NOT NULL
  AND "execution_order" IS NOT NULL;
--> statement-breakpoint

-- Backfill: convert every enabled-or-disabled agent_routes row into the
-- equivalent team_member_routes row, resolved against the team_members
-- rows just created. A route whose source or target Agent has no
-- backfilled team_members row (for example a legacy Agent missing
-- layer/execution_order) is intentionally skipped rather than guessed.
INSERT INTO "team_member_routes" (
  "source_team_member_id",
  "outcome",
  "target_team_member_id",
  "terminal_action",
  "enabled"
)
SELECT
  "source_member"."id",
  "agent_routes"."outcome",
  "target_member"."id",
  "agent_routes"."terminal_action",
  "agent_routes"."enabled"
FROM "agent_routes"
JOIN "team_members" AS "source_member"
  ON "source_member"."agent_id" = "agent_routes"."source_agent_id"
LEFT JOIN "team_members" AS "target_member"
  ON "target_member"."agent_id" = "agent_routes"."target_agent_id"
WHERE (
  "agent_routes"."target_agent_id" IS NULL
  OR "target_member"."id" IS NOT NULL
);
