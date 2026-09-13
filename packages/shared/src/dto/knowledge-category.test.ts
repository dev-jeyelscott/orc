import { describe, expect, it } from "vitest";

import {
  createKnowledgeCategorySchema,
  knowledgeCategorySchema,
  updateKnowledgeCategorySchema,
} from "./knowledge-category.js";

const valid = {
  slug: "ui-ux-guidelines",
  name: "UI/UX Guidelines",
  vaultRootPath: "wiki/ui-ux",
};

describe("Knowledge Category DTO contracts", () => {
  it("accepts a complete category definition with defaults applied", () => {
    expect(createKnowledgeCategorySchema.parse(valid)).toEqual({
      ...valid,
      description: "",
      enabled: true,
    });
  });

  it("rejects an invalid slug", () => {
    expect(
      createKnowledgeCategorySchema.safeParse({ ...valid, slug: "UI/UX" })
        .success,
    ).toBe(false);
  });

  it("rejects a vault root path that traverses outside the vault", () => {
    expect(
      createKnowledgeCategorySchema.safeParse({
        ...valid,
        vaultRootPath: "../outside",
      }).success,
    ).toBe(false);

    expect(
      createKnowledgeCategorySchema.safeParse({
        ...valid,
        vaultRootPath: "/absolute/path",
      }).success,
    ).toBe(false);
  });

  it("allows partial updates", () => {
    expect(
      updateKnowledgeCategorySchema.safeParse({ enabled: false }).success,
    ).toBe(true);
  });

  it("requires persisted identity fields on the full category shape", () => {
    expect(
      knowledgeCategorySchema.safeParse({
        ...valid,
        description: "",
        enabled: true,
      }).success,
    ).toBe(false);

    expect(
      knowledgeCategorySchema.safeParse({
        ...valid,
        description: "",
        enabled: true,
        id: "00000000-0000-4000-9000-000000000099",
        createdAt: "2026-09-12T00:00:00.000Z",
        updatedAt: "2026-09-12T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
