"use client";

import type {
  AgentExecution,
  RunDetail,
} from "@orc/shared";

import {
  EventStreamPanel,
  OrchestratorResultPreview,
  OrchestratorTerminalPanel,
} from "@/components/orchestrator-observability";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface OrchestratorWorkbenchProps {
  runDetail: RunDetail | null;
  terminalExecution: AgentExecution | null;
  resultExecution: AgentExecution | null;
  className?: string;
  showEvents?: boolean;
}

/** Renders the lower operator workbench for terminal, structured handoff, and event inspection. */
export function OrchestratorWorkbench({
  runDetail,
  terminalExecution,
  resultExecution,
  className,
  showEvents = true,
}: OrchestratorWorkbenchProps) {
  return (
    <Card
      className={cn(
        "h-full min-h-0 gap-0 overflow-hidden p-0",
        className,
      )}
    >
      <Tabs
        defaultValue="terminal"
        className="h-full min-h-0 gap-0"
      >
        <div className="shrink-0 border-b border-divider px-3">
          <TabsList
            variant="line"
            className="min-w-max"
          >
            <TabsTrigger value="terminal">
              Terminal
            </TabsTrigger>

            <TabsTrigger value="result">
              Result / Handoff
            </TabsTrigger>

            {showEvents ? (
              <TabsTrigger value="events">
                Events
              </TabsTrigger>
            ) : null}
          </TabsList>
        </div>

        <TabsContent
          value="terminal"
          keepMounted
          className="min-h-0 overflow-hidden p-2 data-[hidden]:hidden"
        >
          <OrchestratorTerminalPanel
            execution={
              terminalExecution
            }
          />
        </TabsContent>

        <TabsContent
          value="result"
          className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
        >
          <OrchestratorResultPreview
            execution={
              resultExecution
            }
          />
        </TabsContent>

        {showEvents ? (
          <TabsContent
            value="events"
            className="min-h-0 overflow-y-auto p-3 data-[hidden]:hidden"
          >
            <EventStreamPanel
              detail={runDetail}
              limit={null}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </Card>
  );
}
