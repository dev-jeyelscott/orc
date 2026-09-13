import { asc, eq, inArray } from "drizzle-orm";

import type { CreateSkill, Skill, UpdateSkill } from "@orc/shared";

import { db } from "../db/client.js";
import { skills } from "../db/schema.js";

export class SkillServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

function serializeSkill(row: typeof skills.$inferSelect): Skill {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof SkillServiceError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") throw new SkillServiceError("A Skill with that slug already exists", 409);
    if (code === "23503") throw new SkillServiceError("The Skill is still assigned and cannot be deleted", 409);
  }
  throw error;
}

export async function listSkills(): Promise<Skill[]> {
  return (await db.select().from(skills).orderBy(asc(skills.name), asc(skills.id))).map(serializeSkill);
}

export async function getSkill(id: string): Promise<Skill | null> {
  const [row] = await db.select().from(skills).where(eq(skills.id, id));
  return row ? serializeSkill(row) : null;
}

export async function getSkillsByIds(ids: string[]): Promise<Skill[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(skills).where(inArray(skills.id, ids));
  const byId = new Map(rows.map((row) => [row.id, serializeSkill(row)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export async function createSkill(input: CreateSkill): Promise<Skill> {
  try {
    const [row] = await db.insert(skills).values(input).returning();
    return serializeSkill(row);
  } catch (error) { return translateDatabaseError(error); }
}

export async function updateSkill(id: string, input: UpdateSkill): Promise<Skill | null> {
  try {
    const [row] = await db.update(skills).set({ ...input, updatedAt: new Date() }).where(eq(skills.id, id)).returning();
    return row ? serializeSkill(row) : null;
  } catch (error) { return translateDatabaseError(error); }
}

export async function deleteSkill(id: string): Promise<boolean> {
  try {
    const [row] = await db.delete(skills).where(eq(skills.id, id)).returning({ id: skills.id });
    return Boolean(row);
  } catch (error) { return translateDatabaseError(error); }
}
