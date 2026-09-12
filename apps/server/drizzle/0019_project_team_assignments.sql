CREATE TABLE "project_team_assignments" (
  "project_path" text PRIMARY KEY NOT NULL,
  "team_id" uuid NOT NULL,
  "notion_data_source_id" text,
  "auto_mode_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_team_assignments_notion_data_source_id_unique" UNIQUE("notion_data_source_id")
);
--> statement-breakpoint
ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_team_assignments_team_id_idx" ON "project_team_assignments" USING btree ("team_id");
--> statement-breakpoint
-- A legacy Team source can move automatically only when persisted task history
-- proves exactly one Project path. Zero- and multi-project Teams remain legacy
-- configuration for an operator to intentionally resolve.
INSERT INTO "project_team_assignments" (
  "project_path",
  "team_id",
  "notion_data_source_id",
  "auto_mode_enabled"
)
SELECT
  min(t."project_path"),
  tm."id",
  tm."notion_data_source_id",
  tm."auto_mode_enabled"
FROM "teams" tm
JOIN "tasks" t ON t."team_id" = tm."id"
WHERE tm."notion_data_source_id" IS NOT NULL
   OR tm."auto_mode_enabled" = true
GROUP BY tm."id", tm."notion_data_source_id", tm."auto_mode_enabled"
HAVING count(DISTINCT t."project_path") = 1
ON CONFLICT ("project_path") DO NOTHING;
