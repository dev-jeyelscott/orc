# ORC

ORC is a local AI engineering-agent orchestration system. It discovers Git repositories beneath a configured workspace root, runs configured Claude and Codex workers directly in the selected repository, and persists workflow state in PostgreSQL.

V1 runs one Task and one workflow Run at a time. Workers execute sequentially according to their configured Team, layer, and execution order.

## Requirements

- Node.js 22 or newer
- pnpm 11
- PostgreSQL 16 (the included Docker Compose service is suitable for local development)
- Claude and/or Codex CLI access for the worker harnesses you enable

## Local setup

Install dependencies and start PostgreSQL:

```bash
pnpm install
docker compose up -d postgres
```

Copy and configure the application environment files:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/dashboard/.env.local.example apps/dashboard/.env.local
```

`WORKSPACE_ROOT` identifies the direct-child Git repositories ORC can discover. `DATABASE_URL` defaults to the local Docker Compose database in the server example.

Apply migrations, then start the server and dashboard:

```bash
pnpm db:migrate
pnpm dev
```

The server defaults to `http://localhost:4000`; the dashboard uses that URL by default through `NEXT_PUBLIC_SERVER_URL`.

## Team-scoped Notion Auto Mode

One server-only `NOTION_API_KEY` can serve multiple Team-specific Notion databases. Configure the API key in `apps/server/.env`; never place it in dashboard configuration, Team payloads, or source control.

```bash
# apps/server/.env
NOTION_API_KEY=ntn_your_server_only_secret
```

Each Team owns these settings in the Teams UI:

- Notion Data Source ID
- Auto Mode enabled

Resolution should use its Bug Fixes database. Development should use its Development / Roadmap / Features database. Both databases must be shared with the same Notion integration represented by `NOTION_API_KEY` and must use the existing property contract:

- `Title`
- `Status`
- `Priority`
- `Project`

To skip an active Development or Resolution Auto Mode task, add a `Skipped` option to each data source's `Status` property. ORC records the task locally as skipped, synchronizes that Notion status, and then continues intake with the next Ready candidate.

A Team can claim Notion work only when the Team is enabled, Auto Mode is enabled, a Data Source ID is configured, `NOTION_API_KEY` is available, and the Team has at least one enabled Agent. Development's seeded Agents start disabled, so enable the intended Development Agents before turning on Development Auto Mode.

When globally idle, the scheduler reads the top Ready candidate from every eligible Team and selects one by numeric priority (lowest first: `1` is highest priority), then Notion page creation time (oldest first), then deterministic identifiers. ORC still permits only one active Run globally. Turning off a Team's Auto Mode prevents future intake but does not cancel an active Run; lifecycle synchronization continues for its persisted Notion Task.

## Migration and rollout

The Team-scoped migration is additive: `0013_gorgeous_red_skull` adds each Team's Notion Data Source ID and Auto Mode flag, copies the legacy global Auto Mode value only to Resolution Team, and retains `system_settings.auto_mode_enabled` for compatibility.

Before applying it outside development, review the generated SQL and confirm your database backup and recovery procedure. Do not automate a destructive rollback or delete an operator's legacy environment variables.

Roll out in this order:

1. Deploy and run `pnpm db:migrate`.
2. Confirm Resolution inherited the previous global Auto Mode value.
3. In Teams, configure Resolution with the existing Bug Fixes Data Source ID.
4. Configure Development with its Development / Roadmap / Features Data Source ID.
5. Share both Notion databases with the integration for `NOTION_API_KEY`.
6. Confirm the four Notion properties above, and enable the intended Development Agents.
7. Enable Auto Mode for each Team as desired.
8. After verifying the Team settings, remove operational dependence on the legacy `NOTION_DATA_SOURCE_ID` deployment variable. It is no longer authoritative; do not automatically delete it from operator machines.

## Operator acceptance checklist

1. In Teams, save a Data Source ID for Resolution and Development; verify both show as configured.
2. With Development Agents disabled, verify Development reports `No enabled Agents` and cannot claim work.
3. Enable Resolution only, place one Ready page in each database, and confirm only Resolution can claim work.
4. Enable Development only and confirm Resolution remains untouched.
5. Enable both Teams. Confirm the Ready page with the lowest numeric priority (for example, `1` before `7`) wins across Teams; for equal priorities, confirm the older Notion page wins.
6. While a Team has an active Run, confirm no second Run starts and the other Team shows global-capacity blocking.
7. Disable the active Team's Auto Mode. Confirm its Run continues and reaches the expected Notion terminal status, without claiming another Task.
8. After the global Run slot is free and the other Team is eligible, confirm it can claim its work.
9. Inspect Tasks, Runs, and workflow executions. Confirm every Notion Task and Run retains its source Team and uses only that Team's snapshotted Agents.
10. In a controlled environment, restart ORC after persisting a candidate but before it starts. Confirm recovery keeps its original Team and resumes it before new remote work; the losing Team's page remains Ready until selected later.

## Validation

Run focused checks first:

```bash
pnpm --filter @orc/shared test
pnpm --filter @orc/shared typecheck
pnpm --filter @orc/server test
pnpm --filter @orc/server typecheck
pnpm --filter @orc/dashboard typecheck
pnpm --filter @orc/dashboard lint
```

Then run repository-wide checks:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

For a disposable development database, validate generated migration state before applying it:

```bash
pnpm db:generate
pnpm db:migrate
```

Do not treat these automated checks as a substitute for the operator checklist: live Notion permissions, dashboard interaction, and recovery behavior require a controlled environment with real credentials and repositories.
