import { OrchestratorChat } from "@/components/orchestrator-chat";

/** Renders the persistent conversational supervisor and its live workflow observability workspace. */
export default function OrchestratorPage() {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          Orchestrator
        </h1>

        <p className="text-sm text-text-muted">
          Delegate work, inspect persisted conversations, and observe the linked workflow.
        </p>
      </header>

      <OrchestratorChat />
    </div>
  );
}
