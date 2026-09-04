"use client";

import type {
  AgentExecution,
  OrchestratorSettings,
  RunDetail,
} from "@orc/shared";

import {
  ActiveAgentPanel,
  EventStreamPanel,
  ExecutionTimelinePanel,
  OrchestratorSettingsPanel,
  RunOverviewPanel,
} from "@/components/orchestrator-observability";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  formatStatusLabel,
  getLifecycleBadgeVariant,
} from "@/lib/task-presentation";
import { cn } from "@/lib/utils";

interface OrchestratorInspectorProps {
  runDetail: RunDetail | null;
  runError: string | null;
  activeExecution: AgentExecution | null;
  settings: OrchestratorSettings | null;
  settingsError: string | null;
  now: number;
  className?: string;
}

/** Renders the tabbed authoritative run inspector used by desktop and responsive layouts. */
export function OrchestratorInspector({
  runDetail,
  runError,
  activeExecution,
  settings,
  settingsError,
  now,
  className,
}: OrchestratorInspectorProps) {
  const run =
    runDetail?.run ?? null;

  return (
    <Card
      className={cn(
        "h-full min-h-0 gap-0 overflow-hidden p-0",
        className,
      )}
    >
      <div className="shrink-0 border-b border-divider px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              Inspector
            </h2>

            <p className="mt-0.5 text-[11px] text-text-muted">
              Run summary and live state
            </p>
          </div>

          <div className="flex min-w-0 flex-col items-end gap-1">
            {run ? (
              <Badge
                variant={getLifecycleBadgeVariant(
                  run.status,
                )}
              >
                {formatStatusLabel(
                  run.status,
                )}
              </Badge>
            ) : null}

            <span
              className="max-w-44 truncate text-[10px] text-text-muted"
              title={
                activeExecution
                  ?.agentName
              }
            >
              {activeExecution
                ?.agentName ??
                "No active execution"}
            </span>
          </div>
        </div>
      </div>

      <Tabs
        defaultValue="overview"
        className="min-h-0 flex-1 gap-0"
      >
        <div className="shrink-0 overflow-x-auto border-b border-divider px-3">
          <TabsList
            variant="line"
            className="min-w-max"
          >
            <TabsTrigger value="overview">
              Overview
            </TabsTrigger>

            <TabsTrigger value="executions">
              Executions
            </TabsTrigger>

            <TabsTrigger value="agent">
              Agent
            </TabsTrigger>

            <TabsTrigger value="events">
              Events
            </TabsTrigger>

            <TabsTrigger value="settings">
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="overview"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <RunOverviewPanel
            detail={runDetail}
            error={runError}
            activeExecution={
              activeExecution
            }
          />
        </TabsContent>

        <TabsContent
          value="executions"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <ExecutionTimelinePanel
            detail={runDetail}
            now={now}
          />
        </TabsContent>

        <TabsContent
          value="agent"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <ActiveAgentPanel
            execution={
              activeExecution
            }
          />
        </TabsContent>

        <TabsContent
          value="events"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <EventStreamPanel
            detail={runDetail}
          />
        </TabsContent>

        <TabsContent
          value="settings"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <OrchestratorSettingsPanel
            settings={settings}
            error={settingsError}
          />
        </TabsContent>
      </Tabs>
    </Card>
  );
}
