CREATE TABLE "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_path" text NOT NULL,
  "title" text NOT NULL,
  "instruction" text NOT NULL,
  "status" "run_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "task_id" uuid;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "workflow_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "current_agent_id" uuid;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "execution_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "terminal_reason" text;
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "runs_task_id_idx" ON "runs" USING btree ("task_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_workflow_idx" ON "runs" ((1)) WHERE "task_id" IS NOT NULL AND "status" IN ('pending', 'running');
