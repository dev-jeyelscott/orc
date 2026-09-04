import { z } from "zod";

export const EVENT_LIST_DEFAULT_PAGE_SIZE = 50;
export const EVENT_LIST_MAX_PAGE_SIZE = 100;
export const EVENT_LIST_MAX_PAGE = 1_000_000;

export const domainEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  projectPath: z.string(),
  taskId: z.string().uuid().nullable(),
  runId: z.string().uuid().nullable(),
  agentExecutionId: z.string().uuid().nullable(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const eventListQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(EVENT_LIST_MAX_PAGE)
      .default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(EVENT_LIST_MAX_PAGE_SIZE)
      .default(EVENT_LIST_DEFAULT_PAGE_SIZE),
  })
  .strict();

export const eventListResponseSchema = z.object({
  events: z.array(domainEventSchema),
  page: z.number().int().positive(),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(EVENT_LIST_MAX_PAGE_SIZE),
  hasMore: z.boolean(),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type EventListQuery = z.infer<typeof eventListQuerySchema>;
export type EventListResponse = z.infer<typeof eventListResponseSchema>;
