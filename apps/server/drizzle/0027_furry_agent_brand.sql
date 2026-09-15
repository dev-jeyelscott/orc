ALTER TABLE "runs" ADD COLUMN "workflow_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "current_workflow_node_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_revision_id_workflow_revisions_id_fk" FOREIGN KEY ("workflow_revision_id") REFERENCES "public"."workflow_revisions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
