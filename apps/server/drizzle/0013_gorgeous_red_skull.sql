ALTER TABLE "teams" ADD COLUMN "notion_data_source_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "auto_mode_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "teams"
SET "auto_mode_enabled" = "system_settings"."auto_mode_enabled"
FROM "system_settings"
WHERE "teams"."id" = '00000000-0000-4000-9000-000000000001'
  AND "system_settings"."id" = 1;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_notion_data_source_id_unique" UNIQUE("notion_data_source_id");
