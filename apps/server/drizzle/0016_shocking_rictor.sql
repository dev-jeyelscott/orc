CREATE TABLE IF NOT EXISTS "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"harness" "harness" NOT NULL,
	"default_model" text NOT NULL,
	"default_reasoning" text NOT NULL,
	"system_prompt" text NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"can_run_commands" boolean DEFAULT false NOT NULL,
	"sandbox_mode" "sandbox_mode",
	"can_commit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_slug_unique" UNIQUE("slug")
);
