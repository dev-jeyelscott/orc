INSERT INTO "orchestrator_settings" (
  "id",
  "harness",
  "model",
  "reasoning",
  "system_prompt"
)
VALUES (
  1,
  'codex',
  'default',
  'medium',
  'You supervise engineering workflows. Use only supplied state and be concise.'
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

DELETE FROM "orchestrator_settings"
WHERE "id" <> 1;
--> statement-breakpoint

ALTER TABLE "orchestrator_settings"
ADD CONSTRAINT "orchestrator_settings_singleton_check"
CHECK ("id" = 1);
