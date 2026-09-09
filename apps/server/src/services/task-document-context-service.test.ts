import {
  describe,
  expect,
  it,
} from "vitest";

import {
  selectTaskDocumentContext,
  type TaskDocumentContextRow,
} from "./task-document-context-service.js";

function row(
  overrides: Partial<TaskDocumentContextRow> = {},
): TaskDocumentContextRow {
  return {
    documentId: "00000000-0000-4000-8000-000000000001",
    fileName: "roadmap.md",
    documentContentHash: "a".repeat(64),
    chunkSequence: 0,
    chunkContentHash: "b".repeat(64),
    content: "# Roadmap\nImplement the workflow.",
    ...overrides,
  };
}

describe("task document context selection", () => {
  it("weights filename matches above heading and body matches", () => {
    const selected = selectTaskDocumentContext(
      [
        row({
          fileName: "notes.md",
          content: "# Workflow\nGeneral implementation guidance.",
        }),
        row({
          documentId: "00000000-0000-4000-8000-000000000002",
          fileName: "workflow.md",
          content: "# Notes\nGeneral implementation guidance.",
        }),
      ],
      { title: "Workflow", instruction: "Implement" },
    );

    expect(selected[0]?.fileName).toBe("workflow.md");
  });

  it("uses one stable first-chunk fallback when no text overlaps", () => {
    const selected = selectTaskDocumentContext(
      [
        row({ fileName: "zeta.md", chunkSequence: 0 }),
        row({
          documentId: "00000000-0000-4000-8000-000000000002",
          fileName: "alpha.md",
          chunkSequence: 2,
        }),
      ],
      { title: "Unrelated", instruction: "Different terms" },
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.fileName).toBe("alpha.md");
  });
});
