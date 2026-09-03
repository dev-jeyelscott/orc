import { TasksManager } from "@/components/tasks-manager";

export default function TasksPage() {
  return <div className="flex flex-col gap-8"><header><h1 className="font-heading text-2xl font-semibold text-text-primary">Tasks</h1><p className="text-sm text-text-muted">Start a workflow against a discovered repository.</p></header><TasksManager /></div>;
}
