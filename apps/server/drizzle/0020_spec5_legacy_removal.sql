DROP TABLE "agent_routes";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "team_id";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "layer";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "execution_order";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "role";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "description";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "harness";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "model";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "reasoning";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "system_prompt";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "can_write";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "can_run_commands";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "sandbox_mode";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "can_commit";
--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "notion_data_source_id";
--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "auto_mode_enabled";
