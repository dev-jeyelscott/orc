-- Nullable overrides inherit Department defaults; existing Agent rows are unchanged.
ALTER TABLE "agents" ADD COLUMN "harness_override" "harness";
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "can_write_override" boolean;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "can_run_commands_override" boolean;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "sandbox_mode_override" "sandbox_mode";
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "can_commit_override" boolean;
