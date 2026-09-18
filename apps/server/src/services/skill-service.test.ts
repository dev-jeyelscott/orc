import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { skills } from "../db/schema.js";
import { createSkill, deleteSkill, listSkills, updateSkill } from "./skill-service.js";

const ids = new Set<string>();
const createdRoots: string[] = [];

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-skill-service-test-"));
  createdRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const id of ids) await db.delete(skills).where(eq(skills.id, id));
  ids.clear();
  for (const root of createdRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("skill-service", () => {
  it("persists reusable named Skills and rejects duplicate slugs", async () => {
    const root = await makeConfigRoot();
    const slug = `ui-ux-knowledge-ingest-${crypto.randomUUID()}`;
    const skill = await createSkill(
      { slug, name: "UI/UX Knowledge Ingest", description: "Propose scoped knowledge updates", enabled: true, tags: ["ui"], domains: ["frontend"] },
      root,
    );
    ids.add(skill.id);
    expect(skill.tags).toEqual(["ui"]);
    expect(skill.domains).toEqual(["frontend"]);
    expect(skill.hasInstructions).toBe(false);
    expect(skill.configRevision).toBeTruthy();
    expect((await listSkills(root)).some((item) => item.id === skill.id)).toBe(true);
    expect((await updateSkill(skill.id, { enabled: false }, null, root))?.enabled).toBe(false);
    await expect(
      createSkill({ slug, name: "Duplicate", description: "", enabled: true, tags: [], domains: [] }, root),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await deleteSkill(skill.id, null, root)).toBe(true);
    ids.delete(skill.id);
  });
});
