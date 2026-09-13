import { skillListResponseSchema, skillSchema, type CreateSkill, type Skill, type UpdateSkill } from "@orc/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
async function error(response: Response) { return ((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? `Request failed: ${response.status}`; }
async function request<T>(path: string, options: RequestInit, schema: { parse(value: unknown): T }): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, { ...options, headers: { "content-type": "application/json", ...options.headers } });
  if (!response.ok) throw new Error(await error(response));
  return schema.parse(await response.json());
}
export async function getSkills(): Promise<Skill[]> { return (await request("/api/skills", { cache: "no-store" }, skillListResponseSchema)).skills; }
export function createSkill(input: CreateSkill): Promise<Skill> { return request("/api/skills", { method: "POST", body: JSON.stringify(input) }, skillSchema); }
export function updateSkill(id: string, input: UpdateSkill): Promise<Skill> { return request(`/api/skills/${id}`, { method: "PATCH", body: JSON.stringify(input) }, skillSchema); }
