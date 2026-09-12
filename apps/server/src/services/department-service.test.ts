import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import { agents, departments } from "../db/schema.js";
import { createDepartment, deleteDepartment, getDepartment, listDepartments, updateDepartment } from "./department-service.js";

const createdIds = new Set<string>();
const createdAgentIds = new Set<string>();
const input = (label: string) => ({
  slug: `department-${label}-${crypto.randomUUID()}`, name: `Department ${label}`,
  role: "Engineer", harness: "codex" as const, defaultModel: "default",
  defaultReasoning: "high", systemPrompt: "Perform engineering work.",
  canWrite: true, canRunCommands: true, canCommit: false,
});

afterEach(async () => {
  for (const id of createdAgentIds) await db.delete(agents).where(eq(agents.id, id));
  createdAgentIds.clear();
  for (const id of createdIds) await db.delete(departments).where(eq(departments.id, id));
  createdIds.clear();
});

describe("department-service", () => {
  it("persists create, list, get, update, enablement, and deletion", async () => {
    const created = await createDepartment(input("lifecycle")); createdIds.add(created.id);
    expect(created.enabled).toBe(true); expect(created.agentCount).toBe(0);
    expect((await getDepartment(created.id))?.id).toBe(created.id);
    expect((await listDepartments()).some((item) => item.id === created.id)).toBe(true);
    expect((await updateDepartment(created.id, { enabled: false }))?.enabled).toBe(false);
    expect(await deleteDepartment(created.id)).toBe(true); createdIds.delete(created.id);
    expect(await getDepartment(created.id)).toBeNull();
  });

  it("returns a stable conflict for duplicate slugs", async () => {
    const values = input("unique");
    const created = await createDepartment(values); createdIds.add(created.id);
    await expect(createDepartment({ ...values, name: "Another Department" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("reports a real Agent count and rejects deletion while referenced", async () => {
    const department = await createDepartment(input("referenced")); createdIds.add(department.id);

    const [agent] = await db.insert(agents).values({
      departmentId: department.id,
      slug: `department-referenced-agent-${crypto.randomUUID()}`,
      name: "Referenced Agent",
      layer: 800_000 + Math.floor(Math.random() * 100_000),
      executionOrder: 1,
    }).returning();
    createdAgentIds.add(agent.id);

    expect((await getDepartment(department.id))?.agentCount).toBe(1);
    expect((await listDepartments()).find((item) => item.id === department.id)?.agentCount).toBe(1);

    await expect(deleteDepartment(department.id)).rejects.toMatchObject({ statusCode: 409 });

    await db.delete(agents).where(eq(agents.id, agent.id));
    createdAgentIds.delete(agent.id);

    expect(await deleteDepartment(department.id)).toBe(true);
    createdIds.delete(department.id);
  });
});
