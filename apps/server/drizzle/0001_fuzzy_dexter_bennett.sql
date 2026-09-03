CREATE TYPE "public"."agent_execution_status" AS ENUM('pending', 'starting', 'running', 'completed', 'failed', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_result_status" AS ENUM('completed', 'approved', 'changes_requested', 'blocked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_path" text NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid,
	"agent_name" text NOT NULL,
	"agent_role" text NOT NULL,
	"layer" integer NOT NULL,
	"execution_order" integer NOT NULL,
	"harness" "harness" NOT NULL,
	"model" text NOT NULL,
	"reasoning" text NOT NULL,
	"status" "agent_execution_status" DEFAULT 'pending' NOT NULL,
	"pid" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"exit_code" integer,
	"result_status" "agent_result_status",
	"result_payload" jsonb,
	"token_usage" jsonb,
	"context_usage" jsonb,
	"commit_hash" text,
	"failure_reason" text,
	"repair_attempted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "terminal_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_execution_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminal_chunks_execution_sequence_unique" UNIQUE("agent_execution_id","sequence")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terminal_chunks" ADD CONSTRAINT "terminal_chunks_agent_execution_id_agent_executions_id_fk" FOREIGN KEY ("agent_execution_id") REFERENCES "public"."agent_executions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_executions_run_id_idx" ON "agent_executions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_executions_agent_id_idx" ON "agent_executions" USING btree ("agent_id");
