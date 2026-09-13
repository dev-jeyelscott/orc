CREATE TYPE "public"."knowledge_ingestion_batch_status" AS ENUM('uploaded', 'analyzing', 'review_ready', 'submitting', 'committed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_proposal_confidence_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."knowledge_proposal_operation" AS ENUM('CREATE', 'UPDATE', 'MERGE', 'CONFLICT', 'NO_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."knowledge_proposal_review_status" AS ENUM('pending', 'approved', 'denied', 'needs_changes');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_ingestion_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_category_id" uuid NOT NULL,
	"specialist_agent_id" uuid,
	"ingestion_skill_id" uuid,
	"source_file_name" text NOT NULL,
	"source_media_type" text NOT NULL,
	"source_content" text NOT NULL,
	"source_content_hash" text NOT NULL,
	"base_vault_commit_sha" text,
	"status" "knowledge_ingestion_batch_status" DEFAULT 'uploaded' NOT NULL,
	"analysis_execution_id" uuid,
	"submitted_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"vault_commit_sha" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_ingestion_batches_source_content_hash_check" CHECK ("knowledge_ingestion_batches"."source_content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "knowledge_ingestion_batches_source_media_type_check" CHECK ("knowledge_ingestion_batches"."source_media_type" = 'text/markdown')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"operation" "knowledge_proposal_operation" NOT NULL,
	"target_path" text NOT NULL,
	"target_heading" text,
	"confidence_score" double precision NOT NULL,
	"confidence_level" "knowledge_proposal_confidence_level" NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"existing_content_hash" text,
	"proposed_content" text NOT NULL,
	"proposed_patch" text,
	"conflict_details" text,
	"review_status" "knowledge_proposal_review_status" DEFAULT 'pending' NOT NULL,
	"reviewer_note" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_proposals_existing_content_hash_check" CHECK ("knowledge_proposals"."existing_content_hash" is null or "knowledge_proposals"."existing_content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "knowledge_proposals_confidence_score_check" CHECK ("knowledge_proposals"."confidence_score" >= 0 and "knowledge_proposals"."confidence_score" <= 1)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_ingestion_batches" ADD CONSTRAINT "knowledge_ingestion_batches_knowledge_category_id_knowledge_categories_id_fk" FOREIGN KEY ("knowledge_category_id") REFERENCES "public"."knowledge_categories"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_ingestion_batches" ADD CONSTRAINT "knowledge_ingestion_batches_specialist_agent_id_agents_id_fk" FOREIGN KEY ("specialist_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_ingestion_batches" ADD CONSTRAINT "knowledge_ingestion_batches_ingestion_skill_id_skills_id_fk" FOREIGN KEY ("ingestion_skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_ingestion_batches" ADD CONSTRAINT "knowledge_ingestion_batches_analysis_execution_id_agent_executions_id_fk" FOREIGN KEY ("analysis_execution_id") REFERENCES "public"."agent_executions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_proposals" ADD CONSTRAINT "knowledge_proposals_batch_id_knowledge_ingestion_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."knowledge_ingestion_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_ingestion_batches_category_id_idx" ON "knowledge_ingestion_batches" USING btree ("knowledge_category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_proposals_batch_id_idx" ON "knowledge_proposals" USING btree ("batch_id");