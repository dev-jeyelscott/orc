import type {
  RunMonitoringDetail,
} from "@orc/shared";

export interface RunDocumentContextItem {
  key: string;
  documentId: string;
  fileName: string;
  documentContentHash: string;
  chunkSequence: number;
  chunkContentHash: string;
  heading: string | null;
}

/**
 * Projects detailed Run monitoring provenance into the exact fields rendered by the Run inspector.
 */
export function getRunDocumentContextItems(
  detail:
    Pick<
      RunMonitoringDetail,
      "taskDocumentContext"
    >,
): RunDocumentContextItem[] {
  return (
    detail
      .taskDocumentContext ??
    []
  ).map(
    (ref) => ({
      key: [
        ref.documentId,
        ref.chunkSequence,
        ref.chunkContentHash,
      ].join(":"),
      documentId:
        ref.documentId,
      fileName:
        ref.fileName,
      documentContentHash:
        ref.documentContentHash,
      chunkSequence:
        ref.chunkSequence,
      chunkContentHash:
        ref.chunkContentHash,
      heading:
        ref.heading ?? null,
    }),
  );
}
