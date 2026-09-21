ALTER TABLE "project_team_assignments" ADD COLUMN "resolution_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "project_team_assignments" ADD COLUMN "development_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "project_team_assignments" ADD COLUMN "auto_mode_team_id" uuid;
--> statement-breakpoint
UPDATE "project_team_assignments"
SET "resolution_team_id" = "team_id",
    "auto_mode_team_id" = CASE WHEN "auto_mode_enabled" THEN "team_id" ELSE NULL END;
--> statement-breakpoint
ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_resolution_team_id_teams_id_fk" FOREIGN KEY ("resolution_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_development_team_id_teams_id_fk" FOREIGN KEY ("development_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_auto_mode_team_id_teams_id_fk" FOREIGN KEY ("auto_mode_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_at_least_one_team_check" CHECK ("resolution_team_id" IS NOT NULL OR "development_team_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_distinct_team_slots_check" CHECK ("resolution_team_id" IS NULL OR "development_team_id" IS NULL OR "resolution_team_id" <> "development_team_id");
--> statement-breakpoint
ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_auto_mode_team_check" CHECK ((NOT "auto_mode_enabled" AND "auto_mode_team_id" IS NULL) OR ("auto_mode_enabled" AND ("auto_mode_team_id" = "resolution_team_id" OR "auto_mode_team_id" = "development_team_id")));
--> statement-breakpoint
CREATE INDEX "project_team_assignments_resolution_team_id_idx" ON "project_team_assignments" USING btree ("resolution_team_id");
--> statement-breakpoint
CREATE INDEX "project_team_assignments_development_team_id_idx" ON "project_team_assignments" USING btree ("development_team_id");
--> statement-breakpoint
ALTER TABLE "project_team_assignments" DROP COLUMN "team_id";
