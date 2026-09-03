import { asc, eq } from "drizzle-orm";
import type { DomainEvent } from "@orc/shared";
import { db } from "../db/client.js";
import { domainEvents } from "../db/schema.js";

function serialize(row: typeof domainEvents.$inferSelect): DomainEvent {
  return { ...row, taskId: row.taskId ?? null, runId: row.runId ?? null, agentExecutionId: row.agentExecutionId ?? null, data: (row.data as Record<string, unknown>) ?? {}, createdAt: row.createdAt.toISOString() };
}
export async function recordEvent(input: Omit<typeof domainEvents.$inferInsert, "id" | "createdAt">): Promise<void> { await db.insert(domainEvents).values(input); }
export async function listRunEvents(runId: string): Promise<DomainEvent[]> { return (await db.select().from(domainEvents).where(eq(domainEvents.runId, runId)).orderBy(asc(domainEvents.createdAt))).map(serialize); }
