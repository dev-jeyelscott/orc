import {
  AgentExecutionDetail,
} from "@/components/agent-execution-detail";

/**
 * Renders the execution-scoped operator workspace for one persisted agent execution.
 */
export default async function AgentExecutionPage({
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
    <AgentExecutionDetail
      executionId={
        id
      }
    />
  );
}
