import {
  runDetailSchema,
  runListResponseSchema,
  taskListResponseSchema,
  taskWithRunSchema,
  type CreateTask,
  type Run,
  type RunDetail,
  type Task,
  type TaskWithRun,
} from "@orc/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

async function request<T>(path: string, options: RequestInit, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, { ...options, headers: { "content-type": "application/json", ...options.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${response.status}`);
  }
  return parse(await response.json());
}

export function createTask(input: CreateTask): Promise<TaskWithRun> {
  return request("/api/tasks", { method: "POST", body: JSON.stringify(input) }, taskWithRunSchema.parse);
}
export function getTasks(): Promise<Task[]> { return request("/api/tasks", {}, (value) => taskListResponseSchema.parse(value).tasks); }
export function getRuns(): Promise<Run[]> { return request("/api/runs", {}, (value) => runListResponseSchema.parse(value).runs); }
export function getRun(id: string): Promise<RunDetail> { return request(`/api/runs/${id}`, {}, runDetailSchema.parse); }
export function cancelRun(id: string): Promise<Run> { return request(`/api/runs/${id}/cancel`, { method: "POST" }, (value) => runDetailSchema.shape.run.parse(value)); }
export function retryRun(id: string, model?: string): Promise<Run> { return request(`/api/runs/${id}/retry`, { method: "POST", body: JSON.stringify({ model }) }, (value) => runDetailSchema.shape.run.parse(value)); }
