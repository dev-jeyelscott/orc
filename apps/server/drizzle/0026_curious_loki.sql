CREATE TYPE "public"."workflow_node_kind" AS ENUM('start', 'agent', 'terminal');--> statement-breakpoint
CREATE TYPE "public"."workflow_revision_state" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"outcome" "agent_route_outcome",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"kind" "workflow_node_kind" NOT NULL,
	"agent_id" uuid,
	"terminal_action" "terminal_action",
	"position_x" integer NOT NULL,
	"position_y" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_nodes_id_revision_id_unique" UNIQUE("id","revision_id"),
	CONSTRAINT "workflow_nodes_kind_fields_check" CHECK (("workflow_nodes"."kind" = 'start' and "workflow_nodes"."agent_id" is null and "workflow_nodes"."terminal_action" is null)
      or ("workflow_nodes"."kind" = 'agent' and "workflow_nodes"."agent_id" is not null and "workflow_nodes"."terminal_action" is null)
      or ("workflow_nodes"."kind" = 'terminal' and "workflow_nodes"."agent_id" is null and "workflow_nodes"."terminal_action" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"state" "workflow_revision_state" NOT NULL,
	"version" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_revisions_team_version_unique" UNIQUE("team_id","version"),
	CONSTRAINT "workflow_revisions_draft_fields_check" CHECK ("workflow_revisions"."state" <> 'draft' or ("workflow_revisions"."version" is null and "workflow_revisions"."published_at" is null)),
	CONSTRAINT "workflow_revisions_published_fields_check" CHECK ("workflow_revisions"."state" <> 'published' or ("workflow_revisions"."version" >= 1 and "workflow_revisions"."published_at" is not null))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_revision_id_workflow_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."workflow_revisions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_source_node_revision_fk" FOREIGN KEY ("source_node_id","revision_id") REFERENCES "public"."workflow_nodes"("id","revision_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_target_node_revision_fk" FOREIGN KEY ("target_node_id","revision_id") REFERENCES "public"."workflow_nodes"("id","revision_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_revision_id_workflow_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."workflow_revisions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_revisions" ADD CONSTRAINT "workflow_revisions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_edges_revision_id_idx" ON "workflow_edges" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_edges_source_node_id_idx" ON "workflow_edges" USING btree ("source_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_edges_source_outcome_unique" ON "workflow_edges" USING btree ("source_node_id","outcome") WHERE "workflow_edges"."outcome" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_edges_source_start_unique" ON "workflow_edges" USING btree ("source_node_id") WHERE "workflow_edges"."outcome" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_nodes_revision_id_idx" ON "workflow_nodes" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_nodes_revision_agent_unique" ON "workflow_nodes" USING btree ("revision_id","agent_id") WHERE "workflow_nodes"."agent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_nodes_revision_terminal_action_unique" ON "workflow_nodes" USING btree ("revision_id","terminal_action") WHERE "workflow_nodes"."terminal_action" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_revisions_team_id_idx" ON "workflow_revisions" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_revisions_team_draft_unique" ON "workflow_revisions" USING btree ("team_id") WHERE "workflow_revisions"."state" = 'draft';