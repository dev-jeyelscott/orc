import { RunsList } from "@/components/runs-list";

export default function RunsPage() {
  return <div className="flex flex-col gap-8"><header><h1 className="font-heading text-2xl font-semibold text-text-primary">Runs</h1><p className="text-sm text-text-muted">Workflow history and current execution status.</p></header><RunsList /></div>;
}
