CREATE TYPE "public"."sandbox_mode" AS ENUM('read-only', 'workspace-write', 'danger-full-access');--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "sandbox_mode" "sandbox_mode";
