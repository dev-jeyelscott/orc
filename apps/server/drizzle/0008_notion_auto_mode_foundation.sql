CREATE TYPE "public"."task_source" AS ENUM('manual', 'notion');
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source" "task_source" DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_id" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_url" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_external_id_unique" UNIQUE("source","external_id");
--> statement-breakpoint
CREATE TABLE "system_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "auto_mode_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_settings_singleton_check" CHECK ("id" = 1)
);
--> statement-breakpoint
INSERT INTO "system_settings" (
  "id",
  "auto_mode_enabled"
)
VALUES (
  1,
  false
)
ON CONFLICT ("id") DO NOTHING;
