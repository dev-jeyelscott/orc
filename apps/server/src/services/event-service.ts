import {
  asc,
  desc,
  eq,
} from "drizzle-orm";
import type {
  DomainEvent,
} from "@orc/shared";

import { db } from "../db/client.js";
import {
  domainEvents,
} from "../db/schema.js";

/**
 * Serializes a persisted domain-event row into the shared API representation.
 */
function serialize(
  row:
    typeof domainEvents.$inferSelect,
): DomainEvent {
  return {
    ...row,
    taskId:
      row.taskId ?? null,
    runId:
      row.runId ?? null,
    agentExecutionId:
      row.agentExecutionId ??
      null,
    data:
      (
        row.data as
          | Record<
              string,
              unknown
            >
          | null
      ) ?? {},
    createdAt:
      row.createdAt.toISOString(),
  };
}

/**
 * Persists one business-level domain event independently from terminal output.
 */
export async function recordEvent(
  input: Omit<
    typeof domainEvents.$inferInsert,
    "id" | "createdAt"
  >,
): Promise<void> {
  await db
    .insert(
      domainEvents,
    )
    .values(
      input,
    );
}

/**
 * Returns every event for one run in chronological order for the run detail view.
 */
export async function listRunEvents(
  runId: string,
): Promise<
  DomainEvent[]
> {
  return (
    await db
      .select()
      .from(
        domainEvents,
      )
      .where(
        eq(
          domainEvents.runId,
          runId,
        ),
      )
      .orderBy(
        asc(
          domainEvents.createdAt,
        ),
      )
  ).map(
    serialize,
  );
}

/**
 * Returns a newest-first bounded event window for one run.
 */
export async function listRecentRunEvents(
  runId: string,
  limit = 20,
): Promise<
  DomainEvent[]
> {
  const boundedLimit =
    Math.min(
      Math.max(
        limit,
        1,
      ),
      50,
    );

  return (
    await db
      .select()
      .from(
        domainEvents,
      )
      .where(
        eq(
          domainEvents.runId,
          runId,
        ),
      )
      .orderBy(
        desc(
          domainEvents.createdAt,
        ),
      )
      .limit(
        boundedLimit,
      )
  ).map(
    serialize,
  );
}

/**
 * Returns a small newest-first event window for the system dashboard.
 */
export async function listRecentEvents(
  limit = 8,
): Promise<
  DomainEvent[]
> {
  const boundedLimit =
    Math.min(
      Math.max(
        limit,
        1,
      ),
      50,
    );

  return (
    await db
      .select()
      .from(
        domainEvents,
      )
      .orderBy(
        desc(
          domainEvents.createdAt,
        ),
      )
      .limit(
        boundedLimit,
      )
  ).map(
    serialize,
  );
}
