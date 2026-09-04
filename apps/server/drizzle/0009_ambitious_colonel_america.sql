-- Metadata baseline migration.
--
-- Migrations 0002 through 0008 were authored without matching Drizzle
-- snapshots. Migration 0009 was subsequently generated from the older
-- 0001 snapshot and therefore attempted to recreate schema objects that
-- already exist.
--
-- Keep this migration together with 0009_snapshot.json so Drizzle's
-- metadata advances to the current schema without replaying duplicate DDL.

SELECT 1;
