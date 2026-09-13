import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import { departmentKnowledgeCategories, departments, knowledgeCategories } from "../db/schema.js";
import { createDepartment, deleteDepartment } from "./department-service.js";
import {
  createKnowledgeCategory,
  deleteKnowledgeCategory,
} from "./knowledge-category-service.js";
import {
  DepartmentKnowledgeServiceError,
  listDepartmentKnowledge,
  replaceDepartmentKnowledge,
} from "./department-knowledge-service.js";

const createdDepartmentIds = new Set<string>();
const createdCategoryIds = new Set<string>();

const departmentInput = (label: string) => ({
  slug: `department-knowledge-${label}-${crypto.randomUUID()}`,
  name: `Department ${label}`,
  role: "Engineer",
  harness: "codex" as const,
  defaultModel: "default",
  defaultReasoning: "high",
  systemPrompt: "Perform engineering work.",
  canWrite: true,
  canRunCommands: true,
  canCommit: false,
});

const categoryInput = (label: string, enabled = true) => ({
  slug: `dept-knowledge-${label}-${crypto.randomUUID()}`,
  name: `Category ${label}`,
  description: "",
  vaultRootPath: `wiki/${label}`,
  enabled,
});

afterEach(async () => {
  for (const id of createdDepartmentIds) {
    await db.delete(departments).where(eq(departments.id, id)).catch(() => undefined);
  }
  createdDepartmentIds.clear();
  for (const id of createdCategoryIds) {
    await db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, id)).catch(() => undefined);
  }
  createdCategoryIds.clear();
});

describe("department-knowledge-service", () => {
  it("returns no associations for a Department with none configured", async () => {
    const department = await createDepartment(departmentInput("none"));
    createdDepartmentIds.add(department.id);

    expect(await listDepartmentKnowledge(department.id)).toEqual([]);
  });

  it("replaces the full association set without duplicating rows on repeat calls", async () => {
    const department = await createDepartment(departmentInput("assign"));
    createdDepartmentIds.add(department.id);
    const categoryA = await createKnowledgeCategory(categoryInput("a"));
    createdCategoryIds.add(categoryA.id);
    const categoryB = await createKnowledgeCategory(categoryInput("b"));
    createdCategoryIds.add(categoryB.id);

    const first = await replaceDepartmentKnowledge(department.id, [categoryA.id, categoryB.id]);
    expect(first.map((row) => row.knowledgeCategoryId).sort()).toEqual(
      [categoryA.id, categoryB.id].sort(),
    );

    // Calling again with an overlapping/duplicate id list must not create duplicate rows
    // (the unique department+category constraint would otherwise reject a naive re-insert).
    const second = await replaceDepartmentKnowledge(department.id, [
      categoryA.id,
      categoryA.id,
      categoryB.id,
    ]);
    expect(second).toHaveLength(2);

    const rawRows = await db
      .select()
      .from(departmentKnowledgeCategories)
      .where(eq(departmentKnowledgeCategories.departmentId, department.id));
    expect(rawRows).toHaveLength(2);
  });

  it("removes an association when it is left out of a later replace call", async () => {
    const department = await createDepartment(departmentInput("remove"));
    createdDepartmentIds.add(department.id);
    const category = await createKnowledgeCategory(categoryInput("remove"));
    createdCategoryIds.add(category.id);

    await replaceDepartmentKnowledge(department.id, [category.id]);
    expect(await listDepartmentKnowledge(department.id)).toHaveLength(1);

    const cleared = await replaceDepartmentKnowledge(department.id, []);
    expect(cleared).toEqual([]);
    expect(await listDepartmentKnowledge(department.id)).toEqual([]);
  });

  it("still presents a disabled Knowledge Category as an association", async () => {
    const department = await createDepartment(departmentInput("disabled"));
    createdDepartmentIds.add(department.id);
    const category = await createKnowledgeCategory(categoryInput("disabled", false));
    createdCategoryIds.add(category.id);

    const result = await replaceDepartmentKnowledge(department.id, [category.id]);
    expect(result).toEqual([
      expect.objectContaining({ knowledgeCategoryId: category.id, enabled: false }),
    ]);
  });

  it("rejects an unknown Knowledge Category id", async () => {
    const department = await createDepartment(departmentInput("bad-category"));
    createdDepartmentIds.add(department.id);

    await expect(
      replaceDepartmentKnowledge(department.id, [crypto.randomUUID()]),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects an unknown Department id", async () => {
    await expect(
      replaceDepartmentKnowledge(crypto.randomUUID(), []),
    ).rejects.toBeInstanceOf(DepartmentKnowledgeServiceError);
  });

  it("cascades association removal when the Department is deleted", async () => {
    const department = await createDepartment(departmentInput("cascade"));
    const category = await createKnowledgeCategory(categoryInput("cascade"));
    createdCategoryIds.add(category.id);

    await replaceDepartmentKnowledge(department.id, [category.id]);
    await deleteDepartment(department.id);

    const rows = await db
      .select()
      .from(departmentKnowledgeCategories)
      .where(eq(departmentKnowledgeCategories.departmentId, department.id));
    expect(rows).toEqual([]);
  });

  it("restricts deleting a Knowledge Category still declared as primary by a Department", async () => {
    const department = await createDepartment(departmentInput("restrict"));
    createdDepartmentIds.add(department.id);
    const category = await createKnowledgeCategory(categoryInput("restrict"));
    createdCategoryIds.add(category.id);

    await replaceDepartmentKnowledge(department.id, [category.id]);

    await expect(deleteKnowledgeCategory(category.id)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("does not restrict other Knowledge Categories from being listed or retrieved", async () => {
    const department = await createDepartment(departmentInput("unrelated"));
    createdDepartmentIds.add(department.id);
    const primary = await createKnowledgeCategory(categoryInput("primary"));
    createdCategoryIds.add(primary.id);
    const other = await createKnowledgeCategory(categoryInput("other"));
    createdCategoryIds.add(other.id);

    await replaceDepartmentKnowledge(department.id, [primary.id]);

    // Declaring `primary` as this Department's primary knowledge must not remove `other`
    // from the generally retrievable set of Knowledge Categories.
    const { listKnowledgeCategories } = await import("./knowledge-category-service.js");
    const all = await listKnowledgeCategories();
    expect(all.some((row) => row.id === other.id)).toBe(true);
  });
});
