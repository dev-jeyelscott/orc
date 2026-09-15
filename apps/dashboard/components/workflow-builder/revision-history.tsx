"use client";

import type { WorkflowPublishedRevisionSummary } from "@orc/shared";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/**
 * Compact Draft / Published-vN revision selector. Published selections
 * are read-only -- the caller disables all mutation controls when
 * `selected` is not `"draft"`.
 */
export function RevisionHistory({
  publishedRevisions,
  selected,
  onSelect,
}: {
  publishedRevisions: readonly WorkflowPublishedRevisionSummary[];
  selected: "draft" | string;
  onSelect: (value: "draft" | string) => void;
}) {
  return (
    <NativeSelect
      aria-label="Workflow revision"
      className="h-8 min-w-32 text-xs"
      value={selected}
      onChange={(event) => onSelect(event.target.value)}
    >
      <NativeSelectOption value="draft">Draft</NativeSelectOption>
      {publishedRevisions.map((revision) => (
        <NativeSelectOption key={revision.id} value={revision.id}>
          Published v{revision.version}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
