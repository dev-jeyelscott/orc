DROP INDEX "runs_one_active_workflow_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_workflow_idx" ON "runs" ((1)) WHERE "task_id" IS NOT NULL AND "status" IN ('pending', 'running');
