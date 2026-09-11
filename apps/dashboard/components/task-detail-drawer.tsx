"use client";

import {
  XIcon,
} from "lucide-react";
import type {
  CSSProperties,
} from "react";
import type {
  Project,
  Run,
  RunDetail,
  Task,
} from "@orc/shared";

import {
  TaskDetailPanel,
} from "@/components/task-detail-panel";
import {
  TaskObservabilityPanel,
} from "@/components/task-observability-panel";
import {
  buttonVariants,
} from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

const detailDrawerStyle = {
  "--drawer-content-width":
    "min(76rem, 96vw)",
} as CSSProperties;

type TaskDetailDrawerProps = {
  open: boolean;
  onOpenChange:
    (open: boolean) => void;
  task:
    Task | null;
  project:
    Project | null;
  runs: Run[];
  latestRunDetail:
    RunDetail | null;
  runDetailLoading:
    boolean;
  runDetailError:
    string | null;
  busyRunId:
    string | null;
  onCancelRun:
    (
      runId: string,
    ) => Promise<void> | void;
  onSkipRun:
    (
      runId: string,
    ) => Promise<void> | void;
  onRetryRun:
    (
      runId: string,
    ) => Promise<void> | void;
};

/**
 * Presents the existing Task detail and observability experience in an
 * on-demand drawer so the Tasks collection remains the page's primary surface.
 */
export function TaskDetailDrawer({
  open,
  onOpenChange,
  task,
  project,
  runs,
  latestRunDetail,
  runDetailLoading,
  runDetailError,
  busyRunId,
  onCancelRun,
  onSkipRun,
  onRetryRun,
}: TaskDetailDrawerProps) {
  return (
    <Drawer
      open={
        open
      }
      onOpenChange={
        onOpenChange
      }
      swipeDirection="right"
    >
      <DrawerContent
        style={
          detailDrawerStyle
        }
      >
        <DrawerHeader className="border-b border-divider p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DrawerTitle className="truncate">
                {task?.title ??
                  "Task details"}
              </DrawerTitle>

              <DrawerDescription>
                Inspect instructions, workflow history, run controls, and observability.
              </DrawerDescription>
            </div>

            <DrawerClose
              type="button"
              className={buttonVariants(
                {
                  variant:
                    "ghost",
                  size:
                    "icon-sm",
                },
              )}
              aria-label="Close task details"
            >
              <XIcon
                aria-hidden="true"
              />
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid min-w-0 gap-4">
            <TaskDetailPanel
              task={
                task
              }
              project={
                project
              }
              runs={
                runs
              }
              latestRunDetail={
                latestRunDetail
              }
              runDetailLoading={
                runDetailLoading
              }
              runDetailError={
                runDetailError
              }
              busyRunId={
                busyRunId
              }
              onCancelRun={
                onCancelRun
              }
              onSkipRun={
                onSkipRun
              }
              onRetryRun={
                onRetryRun
              }
            />

            <TaskObservabilityPanel
              latestRunId={
                runs[0]?.id ??
                null
              }
              detail={
                latestRunDetail
              }
              loading={
                runDetailLoading
              }
              error={
                runDetailError
              }
            />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
