ALTER TABLE "orchestrator_settings" ALTER COLUMN "model" SET DEFAULT 'default';
UPDATE "orchestrator_settings" SET "model" = 'default', "updated_at" = now() WHERE "harness" = 'codex' AND "model" = 'gpt-5';
