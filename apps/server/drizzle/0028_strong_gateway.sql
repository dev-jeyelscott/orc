CREATE TABLE IF NOT EXISTS "run_agent_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill_slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_agent_skills_run_id_agent_id_skill_slug_unique" UNIQUE("run_id","agent_id","skill_slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skill_versions" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_content_hash_check" CHECK ("skill_versions"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "domains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "has_instructions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_agent_skills" ADD CONSTRAINT "run_agent_skills_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_agent_skills" ADD CONSTRAINT "run_agent_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_agent_skills" ADD CONSTRAINT "run_agent_skills_content_hash_skill_versions_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."skill_versions"("content_hash") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_agent_skills_run_id_agent_id_idx" ON "run_agent_skills" USING btree ("run_id","agent_id");