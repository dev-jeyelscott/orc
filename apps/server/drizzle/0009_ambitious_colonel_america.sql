CREATE TYPE "public"."task_source" AS ENUM('manual', 'notion');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_role_check" CHECK ("conversation_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_path" text NOT NULL,
	"task_id" uuid,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"project_path" text NOT NULL,
	"task_id" uuid,
	"run_id" uuid,
	"agent_execution_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orchestrator_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"harness" "harness" DEFAULT 'codex' NOT NULL,
	"model" text DEFAULT 'default' NOT NULL,
	"reasoning" text DEFAULT 'medium' NOT NULL,
	"system_prompt" text DEFAULT 'You supervise engineering workflows. Use only supplied state and be concise.' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestrator_settings_singleton_check" CHECK ("orchestrator_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"auto_mode_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_singleton_check" CHECK ("system_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_path" text NOT NULL,
	"title" text NOT NULL,
	"instruction" text NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"source" "task_source" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"external_url" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_source_external_id_unique" UNIQUE("source","external_id")
);
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_routes" DROP CONSTRAINT "agent_routes_source_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_routes" DROP CONSTRAINT "agent_routes_target_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "workflow_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "current_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "execution_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "terminal_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_events_run_id_created_at_idx" ON "domain_events" USING btree ("run_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_target_agent_id_agents_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
