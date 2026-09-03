# AGENTS.md

## Purpose

This repository builds an AI agent orchestration system for running configurable engineering agents against local Git repositories. Keep changes simple, observable, configuration-driven, and aligned with the current repository rather than assumptions from the roadmap.

Before changing code, inspect the repository, relevant documentation, existing tests, package scripts, configuration, database schema, and nearby implementation patterns.

## Project Baseline

The approved V1 project baseline is:

| Area             | Baseline                                                       |
| ---------------- | -------------------------------------------------------------- |
| Backend          | TypeScript + Node.js                                           |
| Dashboard        | React                                                          |
| Database         | PostgreSQL                                                     |
| Worker harnesses | Claude and Codex                                               |
| Project registry | Filesystem-backed repositories under configured workspace root |
| Execution        | One active task globally, workers run sequentially             |
| Runtime          | Workers execute directly inside the selected real repository   |

Treat this table as the project baseline, not proof that every item is already implemented. Repository code is authoritative for current implementation status.

## Core Architecture Rules

- Projects are filesystem-backed. The configured workspace root defaults to `~/workspace`.
- Project discovery is a system responsibility, not an orchestrator responsibility.
- Worker agents are configuration data. Do not hardcode behavior for names such as Architect, Builder, QA, Security Specialist, or any future role.
- Workflow order comes from configured `layer` and same-layer execution order.
- V1 executes worker agents sequentially, including agents in the same layer.
- Claude and Codex must stay behind generic harness/runtime interfaces. Provider-specific process logic belongs in harness adapters.
- Workers operate directly on the selected real repository. Do not introduce worktrees or repository copies unless scope explicitly changes.
- PostgreSQL is the persistent source of truth for orchestration state such as agents, tasks, runs, executions, conversations, events, results, and terminal history where implemented.
- Raw terminal history and domain/business events are separate concepts. Do not use terminal text as workflow state.
- Agent handoffs should use validated structured results rather than natural-language terminal scraping.
- The orchestrator supervises system capabilities and must read actual runtime state before reporting progress.
- Runtime logic should understand generic concepts such as Project, Task, Run, Agent Configuration, Layer, Execution Order, Agent Execution, Result, Route, Event, Terminal Session, and Conversation.

## V1 Constraints

Unless the approved scope changes, do not introduce:

- Multiple active tasks
- Parallel worker execution
- Git worktrees
- Per-agent containers
- Distributed workers
- Redis, Kafka, RabbitMQ, BullMQ, or Temporal for orchestration
- Kubernetes
- Agent framework dependencies solely to model the workflow
- Recursive project discovery
- Automatic repository cleanup or destructive reset after failures
- Role-specific workflow branches such as `if role == architect`

Keep the V1 architecture as one local application with lightweight internal boundaries.

## Repository Structure

Use the repository's actual structure as the source of truth. The roadmap proposes logical boundaries around these areas when they exist:

- server/backend
- dashboard/frontend
- database and migrations
- project discovery
- agent configuration
- Claude and Codex harness adapters
- runtime/process management
- workflow/routing
- orchestrator
- scheduler
- terminal streaming/history
- domain events
- shared types and validation

Do not create packages, services, or abstractions only to mirror the roadmap. Add a boundary only when the implementation needs it.

## Commands

Only run commands that are verified from the repository, for example from `package.json`, workspace configuration, README, CI, or existing scripts.

Before running development commands:

1. Identify the package manager from the repository and lockfile.
2. Read root and package-level scripts.
3. Reuse existing Docker aliases if the repository provides them.
4. Prefer the project's established command path instead of creating a second workflow.

Do not invent build, test, lint, migration, or development commands when they are not present in the repository.

## Coding Guidelines

- Follow existing TypeScript, React, naming, formatting, linting, import, and module conventions.
- Prefer small, explicit modules over speculative abstraction.
- Reuse existing shared types and validation schemas before creating duplicates.
- Validate data at system boundaries.
- Keep workflow transitions deterministic and persistence-backed.
- Keep harness-specific parsing and command construction out of generic workflow code.
- Report unavailable telemetry as unavailable. Do not fabricate exact token, context, CPU, memory, or usage values.
- Preserve backward-compatible behavior unless the task explicitly changes a contract.
- Add comments only where they explain non-obvious behavior or important operational constraints.

## Data and Workflow Rules

When working on orchestration behavior:

- Enabled agents should be selected from configuration.
- Execution should be ordered by layer and configured same-layer order.
- Run-time agent configuration should be snapshotted when the implementation supports run snapshots.
- `completed` and `approved` normally move forward unless an explicit route overrides them.
- Outcomes such as `changes_requested`, `blocked`, and `failed` may use configuration-driven routes.
- Review/retry cycles must remain bounded.
- Invalid structured completion results must not silently count as successful executions.
- A crash or interrupted worker must not trigger automatic destructive cleanup of the selected repository.

## Project Discovery Rules

When implementing or modifying project discovery:

- Use the configured workspace root, with `~/workspace` only as the default.
- The filesystem remains authoritative for available projects.
- V1 discovery considers direct child directories containing `.git`.
- Do not require manual project registration in PostgreSQL.
- Handle missing workspace directories and Git command failures without crashing the application.
- Keep project discovery independent from the orchestrator agent.

## Runtime and Harness Rules

- Start workers with the selected project path as their working directory.
- Keep Claude-specific and Codex-specific CLI construction inside their adapters.
- Capture process lifecycle, output, exit state, and supported usage metadata.
- Preserve terminal output ordering and execution ownership.
- Prefer graceful stop first, then a bounded termination fallback where implemented.
- Do not claim runtime command blocking exists unless the repository actually implements it.

## Validation Expectations

For code changes, run the smallest relevant verified checks first, then the broader repository checks required by the project.

Typical validation areas include:

- Unit tests
- Integration tests
- Type checking
- Linting
- Build
- Database migrations/schema validation
- Workflow transition tests
- Harness/runtime lifecycle tests
- Dashboard behavior affected by the change

Do not report a check as passed unless it was actually run successfully. If a required check cannot run, state the reason clearly.

## Git and Commit Guidance

- Inspect `git status` and `git diff` before and after changes.
- Do not overwrite unrelated user work.
- Do not use destructive resets or force operations to clean the repository.
- Keep commits focused and follow the repository's existing commit convention.
- Worker commit behavior is capability-driven. Only an agent configured with commit permission may commit during orchestration.
- Agents without commit permission must not commit even if they can modify or inspect files.
- Never force-push unless the user explicitly requests and approves it.

## Safety

Stay inside the selected repository unless the task explicitly requires otherwise.

Avoid:

- `sudo` or privileged system changes
- Broad or unrelated destructive deletes
- Filesystem formatting or disk operations
- Destructive Git resets
- Force pushes
- Deleting unrelated files or directories
- Commands intentionally targeting paths outside the selected repository
- System package or service changes without explicit user approval

Normal project development commands are acceptable when supported by the repository and the agent's configured permissions, including dependency installation, tests, linting, type checking, builds, project scripts, safe Git inspection, and permitted commits.

For MVP, safety may be prompt-enforced rather than technically sandboxed. Do not describe prompt guidance as a security boundary.

## Before Finishing Work

Confirm that:

- The change matches the current repository and requested scope.
- No role-specific workflow logic was introduced.
- Generic harness boundaries remain intact.
- Project discovery remains system-owned and filesystem-backed.
- Terminal output and domain events remain separate.
- Commit permissions are respected.
- Relevant verified checks were run.
- Remaining risks, unavailable validation, or unsupported telemetry are stated plainly.
- No unrelated files were changed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
