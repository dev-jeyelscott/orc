CREATE TABLE IF NOT EXISTS "teams" (
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
ALTER TABLE "agents" DROP CONSTRAINT "agents_layer_execution_order_unique";--> statement-breakpoint
ALTER TABLE "orchestrator_settings" ALTER COLUMN "reasoning" SET DEFAULT 'low';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "team_id" uuid DEFAULT '00000000-0000-4000-9000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "team_id" uuid DEFAULT '00000000-0000-4000-9000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "team_id" uuid DEFAULT '00000000-0000-4000-9000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "team_id" uuid DEFAULT '00000000-0000-4000-9000-000000000001' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_team_layer_execution_order_unique" UNIQUE("team_id","layer","execution_order");