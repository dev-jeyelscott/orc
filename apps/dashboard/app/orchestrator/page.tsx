import { OrchestratorChat } from "@/components/orchestrator-chat";

/** Renders the persistent conversational supervisor command center. */
export default function OrchestratorPage() {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold text-text-primary">
          Orchestrator
        </h1>

        <p className="text-xs text-text-muted">
          Delegate work, inspect persisted conversations, and observe authoritative workflow state.
        </p>
      </header>

      <OrchestratorChat />
    </div>
  );
}
