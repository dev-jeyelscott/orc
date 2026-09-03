import {
  runDetailSchema,
  runListResponseSchema,
  taskListResponseSchema,
  taskWithRunSchema,
  type CreateTask,
  type RetryRun,
  type Run,
  type RunDetail,
  type Task,
  type TaskWithRun,
} from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/** Performs one validated workflow request and normalizes backend error responses. */
async function request<T>(
  path: string,
  options: RequestInit,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await fetch(
    `${SERVER_URL}${path}`,
    {
      ...options,
      headers: {
        "content-type": "application/json",
        ...options.headers,
      },
    },
  );

  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as {
      error?: string;
    } | null;

    throw new Error(
      body?.error ??
        `Request failed: ${response.status}`,
    );
  }

  return parse(await response.json());
}

/** Creates a task and immediately starts its workflow through the existing backend contract. */
export function createTask(
  input: CreateTask,
): Promise<TaskWithRun> {
  return request(
    "/api/tasks",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    taskWithRunSchema.parse,
  );
}

/** Returns current task history without reusing a stale browser cache entry. */
export function getTasks(): Promise<Task[]> {
  return request(
    "/api/tasks",
    {
      cache: "no-store",
    },
    (value) =>
      taskListResponseSchema.parse(value).tasks,
  );
}

/** Returns current run history without reusing a stale browser cache entry. */
export function getRuns(): Promise<Run[]> {
  return request(
    "/api/runs",
    {
      cache: "no-store",
    },
    (value) =>
      runListResponseSchema.parse(value).runs,
  );
}

/** Returns one run together with its task, executions, and domain events. */
export function getRun(
  id: string,
): Promise<RunDetail> {
  return request(
    `/api/runs/${id}`,
    {
      cache: "no-store",
    },
    runDetailSchema.parse,
  );
}

/** Cancels one backend-supported active run and returns the updated run summary. */
export function cancelRun(
  id: string,
): Promise<Run> {
  return request(
    `/api/runs/${id}/cancel`,
    {
      method: "POST",
    },
    (value) =>
      runDetailSchema.shape.run.parse(value),
  );
}

/** Retries the final execution of a backend-supported failed or blocked run. */
export function retryRun(
  id: string,
  override: RetryRun = {},
): Promise<Run> {
  return request(
    `/api/runs/${id}/retry`,
    {
      method: "POST",
      body: JSON.stringify(override),
    },
    (value) =>
      runDetailSchema.shape.run.parse(value),
  );
}
