import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { skills } from "../db/schema.js";
import { createSkill, deleteSkill, listSkills, updateSkill } from "./skill-service.js";

const ids = new Set<string>();
afterEach(async () => { for (const id of ids) await db.delete(skills).where(eq(skills.id, id)); ids.clear(); });

describe("skill-service", () => {
  it("persists reusable named Skills and rejects duplicate slugs", async () => {
    const slug = `ui-ux-knowledge-ingest-${crypto.randomUUID()}`;
    const skill = await createSkill({ slug, name: "UI/UX Knowledge Ingest", description: "Propose scoped knowledge updates", enabled: true });
    ids.add(skill.id);
    expect((await listSkills()).some((item) => item.id === skill.id)).toBe(true);
    expect((await updateSkill(skill.id, { enabled: false }))?.enabled).toBe(false);
    await expect(createSkill({ slug, name: "Duplicate", description: "", enabled: true })).rejects.toMatchObject({ statusCode: 409 });
    expect(await deleteSkill(skill.id)).toBe(true); ids.delete(skill.id);
  });
});
