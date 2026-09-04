
ALTER TABLE "orchestrator_settings"

ALTER COLUMN "reasoning" SET DEFAULT 'low';

--> statement-breakpoint



UPDATE "orchestrator_settings"

SET

  "reasoning" = 'low',

  "updated_at" = now()

WHERE

  "id" = 1

  AND "harness" = 'codex'

  AND "model" = 'default'

  AND "reasoning" = 'medium'

  AND "system_prompt" = 'You supervise engineering workflows. Use only supplied state and be concise.'

  AND "updated_at" = "created_at";

