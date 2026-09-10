import assert from "node:assert/strict";

import type {
  RunMonitoringDetail,
} from "@orc/shared";

import {
  getRunDocumentContextItems,
} from "./run-document-context";

const detail:
  Pick<
    RunMonitoringDetail,
    "taskDocumentContext"
  > = {
    taskDocumentContext: [
      {
        source:
          "project_document",
        documentId:
          "00000000-0000-4000-8000-000000000001",
        fileName:
          "historical-requirements.md",
        documentContentHash:
          "a".repeat(64),
        chunkSequence:
          4,
        chunkContentHash:
          "b".repeat(64),
        heading:
          "Historical context",
      },
    ],
  };

const items =
  getRunDocumentContextItems(
    detail,
  );

assert.deepEqual(
  items,
  [
    {
      key:
        `00000000-0000-4000-8000-000000000001:4:${"b".repeat(64)}`,
      documentId:
        "00000000-0000-4000-8000-000000000001",
      fileName:
        "historical-requirements.md",
      documentContentHash:
        "a".repeat(64),
      chunkSequence:
        4,
      chunkContentHash:
        "b".repeat(64),
      heading:
        "Historical context",
    },
  ],
);

assert.equal(
  "excerpt" in
    items[0],
  false,
);

assert.deepEqual(
  getRunDocumentContextItems(
    {},
  ),
  [],
);

console.log(
  "run-document-context presentation tests passed",
);
