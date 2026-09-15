"use client";

import { useMemo, useState } from "react";
import { PlusIcon, SearchIcon } from "lucide-react";

import type { Agent } from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/**
 * Compact searchable list of current Team Agents not yet represented in
 * the Draft. Supports click-to-insert; drag-to-insert is handled by the
 * caller via the item's native `draggable` attribute and a shared
 * `application/x-orc-agent-id` dataTransfer payload.
 */
export function AgentPalette({
  agents,
  placedAgentIds,
  hasTeamMembers,
  onInsert,
  disabled,
}: {
  agents: readonly Agent[];
  placedAgentIds: ReadonlySet<string>;
  hasTeamMembers: boolean;
  onInsert: (agentId: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return agents.filter((agent) => {
      if (!normalized) return true;
      return (
        agent.name.toLowerCase().includes(normalized) ||
        agent.department.name.toLowerCase().includes(normalized) ||
        agent.effective.role.toLowerCase().includes(normalized)
      );
    });
  }, [agents, query]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Agents..."
          className="h-8 pl-7 text-xs"
          aria-label="Search Team Agents"
        />
      </div>

      {agents.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default p-3 text-xs text-text-muted">
          {hasTeamMembers
            ? "Every Team Agent is already placed in the workflow."
            : "No Team Agents yet. Add Agents on the Agents tab."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 overflow-y-auto">
          {filtered.map((agent) => {
            const placed = placedAgentIds.has(agent.id);

            return (
              <li
                key={agent.id}
                data-disabled={placed}
                draggable={!placed && !disabled}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-orc-agent-id", agent.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className="workflow-palette-item flex items-center justify-between gap-2 rounded-md border border-border-default bg-surface-elevated px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-text-primary">{agent.name}</p>
                  <p className="truncate text-[11px] text-text-muted">
                    {agent.department.name} · {agent.effective.role}
                  </p>
                </div>

                {placed ? (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    Placed
                  </Badge>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onInsert(agent.id)}
                    aria-label={`Add ${agent.name} to the workflow`}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border-default text-text-secondary hover:bg-surface-interactive disabled:opacity-50"
                  >
                    <PlusIcon className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
