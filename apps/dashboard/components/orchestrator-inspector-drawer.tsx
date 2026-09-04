"use client";

import type {
  AgentExecution,
  OrchestratorSettings,
  RunDetail,
} from "@orc/shared";
import {
  PanelRightOpenIcon,
  XIcon,
} from "lucide-react";

import { OrchestratorInspector } from "@/components/orchestrator-inspector";
import { OrchestratorWorkbench } from "@/components/orchestrator-workbench";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

interface OrchestratorInspectorDrawerProps {
  runDetail: RunDetail | null;
  runError: string | null;
  activeExecution: AgentExecution | null;
  terminalExecution: AgentExecution | null;
  resultExecution: AgentExecution | null;
  settings: OrchestratorSettings | null;
  settingsError: string | null;
  now: number;
}

/** Renders responsive run observability and workbench access without duplicating authoritative state. */
export function OrchestratorInspectorDrawer({
  runDetail,
  runError,
  activeExecution,
  terminalExecution,
  resultExecution,
  settings,
  settingsError,
  now,
}: OrchestratorInspectorDrawerProps) {
  return (
    <Drawer swipeDirection="right">
      <DrawerTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
          />
        }
      >
        <PanelRightOpenIcon className="size-3.5" />
        Inspect run
      </DrawerTrigger>

      <DrawerContent className="[--drawer-content-width:min(92vw,44rem)] sm:[--drawer-content-width:min(82vw,44rem)]">
        <DrawerHeader className="border-b border-divider p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DrawerTitle>
                Run Inspector
              </DrawerTitle>

              <DrawerDescription>
                Inspect authoritative run state, executions, terminal output, and structured handoffs.
              </DrawerDescription>
            </div>

            <DrawerClose
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Close run inspector"
                />
              }
            >
              <XIcon className="size-4" />
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="h-[560px] min-h-[420px]">
            <OrchestratorInspector
              runDetail={runDetail}
              runError={runError}
              activeExecution={
                activeExecution
              }
              settings={settings}
              settingsError={
                settingsError
              }
              now={now}
            />
          </div>

          <div className="mt-4 h-[420px] min-h-[320px]">
            <OrchestratorWorkbench
              runDetail={runDetail}
              terminalExecution={
                terminalExecution
              }
              resultExecution={
                resultExecution
              }
              showEvents={false}
            />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
