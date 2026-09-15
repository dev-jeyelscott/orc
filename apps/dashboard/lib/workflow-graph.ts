import {
  publishWorkflowResponseSchema,
  workflowAggregateSchema,
  workflowGraphSchema,
  workflowPublishedRevisionSchema,
  type PublishWorkflowResponse,
  type WorkflowAggregate,
  type WorkflowDraft,
  type WorkflowGraph,
  type WorkflowPublishedRevision,
  type WorkflowValidationResult,
} from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/**
 * Reads a backend workflow graph error response into stable operator-facing text.
 */
async function readErrorMessage(
  response: Response,
): Promise<string> {
  const body = (
    await response.json().catch(() => null)
  ) as { error?: string } | null;

  return body?.error ?? `Request failed: ${response.status}`;
}

/**
 * Loads one Team's Draft graph, latest Published summary, Published
 * revision history, and current Draft validation in one aggregate read.
 */
export async function getWorkflowAggregate(
  teamId: string,
  signal?: AbortSignal,
): Promise<WorkflowAggregate> {
  const response = await fetch(
    `${SERVER_URL}/api/teams/${teamId}/workflow/graph`,
    {
      cache: "no-store",
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return workflowAggregateSchema.parse(await response.json());
}

/**
 * Atomically replaces the Team's entire Draft graph. Incomplete graphs are
 * allowed -- the server always returns fresh validation alongside the
 * persisted Draft so the UI can show readiness.
 */
export async function saveWorkflowDraft(
  teamId: string,
  graph: WorkflowGraph,
): Promise<{ draft: WorkflowDraft; validation: WorkflowValidationResult }> {
  const response = await fetch(
    `${SERVER_URL}/api/teams/${teamId}/workflow/draft`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(workflowGraphSchema.parse(graph)),
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const parsed = workflowAggregateSchema
    .pick({ draft: true, validation: true })
    .parse(await response.json());

  return parsed;
}

/**
 * Publishes the Team's current Draft as a new immutable Published
 * revision. Rejects with the structured validation attached when the
 * Draft has blocking errors.
 */
export async function publishWorkflowDraft(
  teamId: string,
): Promise<PublishWorkflowResponse> {
  const response = await fetch(
    `${SERVER_URL}/api/teams/${teamId}/workflow/publish`,
    {
      method: "POST",
    },
  );

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = body as { error?: string; validation?: unknown } | null;
    const error = new Error(parsedError?.error ?? `Request failed: ${response.status}`) as Error & {
      validation?: unknown;
    };
    error.validation = parsedError?.validation;
    throw error;
  }

  return publishWorkflowResponseSchema.parse(body);
}

/** Read-only lookup of one immutable Published revision. */
export async function getPublishedRevision(
  teamId: string,
  revisionId: string,
  signal?: AbortSignal,
): Promise<WorkflowPublishedRevision> {
  const response = await fetch(
    `${SERVER_URL}/api/teams/${teamId}/workflow/revisions/${revisionId}`,
    {
      cache: "no-store",
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return workflowPublishedRevisionSchema.parse(await response.json());
}
