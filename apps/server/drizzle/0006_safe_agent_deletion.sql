ALTER TABLE "agent_executions"
DROP CONSTRAINT IF EXISTS "agent_executions_agent_id_agents_id_fk";
--> statement-breakpoint

ALTER TABLE "agent_executions"
ADD CONSTRAINT "agent_executions_agent_id_agents_id_fk"
FOREIGN KEY ("agent_id")
REFERENCES "public"."agents"("id")
ON DELETE SET NULL
ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "agent_routes"
DROP CONSTRAINT IF EXISTS "agent_routes_source_agent_id_agents_id_fk";
--> statement-breakpoint

ALTER TABLE "agent_routes"
DROP CONSTRAINT IF EXISTS "agent_routes_source_agent_id_fkey";
--> statement-breakpoint

ALTER TABLE "agent_routes"
ADD CONSTRAINT "agent_routes_source_agent_id_agents_id_fk"
FOREIGN KEY ("source_agent_id")
REFERENCES "public"."agents"("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "agent_routes"
DROP CONSTRAINT IF EXISTS "agent_routes_target_agent_id_agents_id_fk";
--> statement-breakpoint

ALTER TABLE "agent_routes"
DROP CONSTRAINT IF EXISTS "agent_routes_target_agent_id_fkey";
--> statement-breakpoint

ALTER TABLE "agent_routes"
ADD CONSTRAINT "agent_routes_target_agent_id_agents_id_fk"
FOREIGN KEY ("target_agent_id")
REFERENCES "public"."agents"("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;
