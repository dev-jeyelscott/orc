import type { Skill } from "@orc/shared";

export const SKILL_VIEW_MODES = [
  "table",
  "list",
  "details",
  "grid",
] as const;

export type SkillViewMode =
  (typeof SKILL_VIEW_MODES)[number];

export type SkillStatusFilter =
  | "all"
  | "enabled"
  | "disabled";

/**
 * Filters Skills client-side while preserving the API's deterministic name ordering.
 */
export function getVisibleSkills(
  skills: Skill[],
  query: string,
  status: SkillStatusFilter,
): Skill[] {
  const normalizedQuery =
    query
      .trim()
      .toLowerCase();

  return skills.filter(
    (skill) => {
      const haystack = [
        skill.name,
        skill.slug,
        skill.description,
      ]
        .join(" ")
        .toLowerCase();

      const matchesQuery =
        !normalizedQuery ||
        haystack.includes(
          normalizedQuery,
        );

      const matchesStatus =
        status === "all" ||
        skill.enabled ===
          (status === "enabled");

      return (
        matchesQuery &&
        matchesStatus
      );
    },
  );
}
