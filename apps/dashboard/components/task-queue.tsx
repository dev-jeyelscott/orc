"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  Clock3Icon,
  PlayCircleIcon,
  SearchIcon,
} from "lucide-react";
import { useMemo } from "react";
import type { Run, Task } from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatRelativeTimestamp,
  formatStatusLabel,
  getLifecycleBadgeVariant,
  projectNameFromPath,
  shortId,
} from "@/lib/task-presentation";
import { cn } from "@/lib/utils";

type TaskQueueProps = {
  tasks: Task[];
  runs: Run[];
  selectedTaskId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (taskId: string) => void;
};

type QueueGroup = {
  key: string;
  label: string;
  icon: typeof CircleDotIcon;
  iconClassName: string;
  tasks: Task[];
};

/**
 * Matches a normalized search term against fields available on the current Task contract.
 */
function matchesTaskQuery(
  task: Task,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }

  return [
    task.id,
    task.title,
    task.projectPath,
    task.status,
  ].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

/**
 * Renders the searchable task queue using presentation-only status groupings.
 */
export function TaskQueue({
  tasks,
  runs,
  selectedTaskId,
  query,
  onQueryChange,
  onSelect,
}: TaskQueueProps) {
  const normalizedQuery = query
    .trim()
    .toLowerCase();

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) =>
        matchesTaskQuery(
          task,
          normalizedQuery,
        ),
      ),
    [tasks, normalizedQuery],
  );

  const latestRunByTaskId = useMemo(() => {
    const index = new Map<string, Run>();

    for (const run of runs) {
      if (
        run.taskId &&
        !index.has(run.taskId)
      ) {
        index.set(run.taskId, run);
      }
    }

    return index;
  }, [runs]);

  const groups: QueueGroup[] = [
    {
      key: "running",
      label: "Running Now",
      icon: CircleDotIcon,
      iconClassName: "text-status-running",
      tasks: visibleTasks.filter(
        (task) => task.status === "running",
      ),
    },
    {
      key: "pending",
      label: "Pending Queue",
      icon: Clock3Icon,
      iconClassName: "text-status-neutral",
      tasks: visibleTasks.filter(
        (task) => task.status === "pending",
      ),
    },
    {
      key: "attention",
      label: "Needs Attention",
      icon: AlertTriangleIcon,
      iconClassName: "text-status-warning",
      tasks: visibleTasks.filter(
        (task) =>
          task.status === "failed" ||
          task.status === "blocked",
      ),
    },
    {
      key: "finished",
      label: "Recently Finished",
      icon: CheckCircle2Icon,
      iconClassName: "text-status-success",
      tasks: visibleTasks.filter(
        (task) =>
          task.status === "completed" ||
          task.status === "cancelled",
      ),
    },
  ];

  return (
    <section
      className="neon-surface flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs"
      aria-label="Task queue"
    >
      <div className="border-b border-divider p-3">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>

          <InputGroupInput
            type="search"
            value={query}
            onChange={(event) =>
              onQueryChange(event.target.value)
            }
            placeholder="Search tasks..."
            aria-label="Search tasks by title, id, project path, or status"
          />
        </InputGroup>
      </div>

      <ScrollArea className="h-[38rem] min-h-0 2xl:h-[calc(100dvh-12.5rem)]">
        <div className="space-y-5 p-3">
          {groups.map((group) => (
            <TaskGroup
              key={group.key}
              group={group}
              selectedTaskId={selectedTaskId}
              latestRunByTaskId={latestRunByTaskId}
              onSelect={onSelect}
            />
          ))}

          {visibleTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-default px-4 py-8 text-center">
              <p className="text-sm font-medium text-text-secondary">
                No matching tasks
              </p>

              <p className="mt-1 text-xs text-text-muted">
                Change the search query to see other task history.
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </section>
  );
}

/**
 * Renders one presentation-only task status section and hides it when empty.
 */
function TaskGroup({
  group,
  selectedTaskId,
  latestRunByTaskId,
  onSelect,
}: {
  group: QueueGroup;
  selectedTaskId: string | null;
  latestRunByTaskId: Map<string, Run>;
  onSelect: (taskId: string) => void;
}) {
  if (group.tasks.length === 0) {
    return null;
  }

  const GroupIcon = group.icon;

  return (
    <section
      aria-labelledby={`task-group-${group.key}`}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <GroupIcon
          className={cn(
            "size-3.5",
            group.iconClassName,
          )}
          aria-hidden="true"
        />

        <h2
          id={`task-group-${group.key}`}
          className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted"
        >
          {group.label}
        </h2>

        <span className="rounded-full bg-surface-interactive px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
          {group.tasks.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {group.tasks.map((task) => (
          <TaskQueueItem
            key={task.id}
            task={task}
            run={
              latestRunByTaskId.get(
                task.id,
              ) ?? null
            }
            selected={
              task.id === selectedTaskId
            }
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Renders one selectable task summary without navigating away from the Tasks workspace.
 */
function TaskQueueItem({
  task,
  run,
  selected,
  onSelect,
}: {
  task: Task;
  run: Run | null;
  selected: boolean;
  onSelect: (taskId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      aria-current={
        selected ? "true" : undefined
      }
      className={cn(
        "group w-full rounded-lg border border-border-default bg-surface-card p-2.5 text-left transition-colors hover:bg-surface-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
        !selected && "neon-surface",
        selected &&
          "border-status-running/70 bg-status-running/5 ring-1 ring-status-running/25",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">
            {task.title}
          </p>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-text-muted">
            <span>
              #{shortId(task.id)}
            </span>

            {run ? (
              <>
                <span aria-hidden="true">
                  ·
                </span>

                <PlayCircleIcon
                  className="size-3"
                  aria-hidden="true"
                />

                <span className="truncate">
                  {shortId(run.id)}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <Badge
          variant={getLifecycleBadgeVariant(
            task.status,
          )}
        >
          {formatStatusLabel(
            task.status,
          )}
        </Badge>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-muted">
        <span className="truncate">
          {projectNameFromPath(
            task.projectPath,
          )}
        </span>

        <span className="shrink-0">
          {formatRelativeTimestamp(
            task.updatedAt,
          )}
        </span>
      </div>
    </button>
  );
}
