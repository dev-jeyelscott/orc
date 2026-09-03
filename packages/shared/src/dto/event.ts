import { z } from "zod";

export const domainEventSchema = z.object({ id: z.string().uuid(), type: z.string(), projectPath: z.string(), taskId: z.string().uuid().nullable(), runId: z.string().uuid().nullable(), agentExecutionId: z.string().uuid().nullable(), data: z.record(z.string(), z.unknown()), createdAt: z.string().datetime() });
export type DomainEvent = z.infer<typeof domainEventSchema>;
