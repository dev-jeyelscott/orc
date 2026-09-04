import {
  RunDetailWorkspace,
} from "@/components/run-detail-workspace";

/**
 * Renders the dedicated operator workspace for one persisted workflow run.
 */
export default async function RunPage({
  params,
}: {
  params:
    Promise<{
      id: string;
    }>;
}) {
  const {
    id,
  } = await params;

  return (
    <RunDetailWorkspace
      runId={
        id
      }
    />
  );
}
