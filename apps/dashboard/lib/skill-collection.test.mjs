import assert from "node:assert/strict";
import test from "node:test";

import {
  SKILL_VIEW_MODES,
  getVisibleSkills,
} from "./skill-collection.ts";

const enabledSkill = {
  id: "skill-1",
  name: "Code Review",
  slug: "code-review",
  description:
    "Reviews code for correctness and maintainability.",
  enabled: true,
  createdAt:
    "2026-09-01T00:00:00.000Z",
  updatedAt:
    "2026-09-10T10:00:00.000Z",
};

const disabledSkill = {
  ...enabledSkill,
  id: "skill-2",
  name: "Documentation Writer",
  slug: "documentation-writer",
  description:
    "Creates structured technical documentation.",
  enabled: false,
};

/**
 * Verifies the registry exposes the required presentation modes with Table first.
 */
test(
  "Skills registry provides all four views with Table first",
  () => {
    assert.deepEqual(
      SKILL_VIEW_MODES,
      [
        "table",
        "list",
        "details",
        "grid",
      ],
    );
  },
);

/**
 * Verifies search covers all operator-visible Skill identity fields.
 */
test(
  "Skills search includes name, slug, and description",
  () => {
    for (const query of [
      "code review",
      "code-review",
      "correctness",
    ]) {
      assert.equal(
        getVisibleSkills(
          [enabledSkill],
          query,
          "all",
        ).length,
        1,
      );
    }

    assert.equal(
      getVisibleSkills(
        [enabledSkill],
        "absent",
        "all",
      ).length,
      0,
    );
  },
);

/**
 * Verifies enabled and disabled filtering without changing server ordering.
 */
test(
  "Skills status filtering preserves source ordering",
  () => {
    const skills = [
      enabledSkill,
      disabledSkill,
    ];

    assert.deepEqual(
      getVisibleSkills(
        skills,
        "",
        "all",
      ),
      skills,
    );

    assert.deepEqual(
      getVisibleSkills(
        skills,
        "",
        "enabled",
      ),
      [enabledSkill],
    );

    assert.deepEqual(
      getVisibleSkills(
        skills,
        "",
        "disabled",
      ),
      [disabledSkill],
    );
  },
);
