import {
  z,
} from "zod";

export const teamAutomationStatusStateSchema =
  z.enum([
    "off",
    "ready",
    "running",
    "waiting_approval",
    "cooldown",
    "unavailable",
  ]);

export const teamAutomationUnavailableReasonSchema =
  z.enum([
    "team_disabled",
    "missing_notion_data_source",
    "missing_notion_api_key",
    "no_enabled_agents",
  ])
    .nullable();

export const projectAutomationStatusSchema =
  z.object({
    projectPath: z.string(),
    teamId: z.string().uuid(),
    autoModeEnabled: z.boolean(),
    state: teamAutomationStatusStateSchema,
    nextEligibleAt: z.string().datetime().nullable(),
    blockedByActiveRun: z.boolean(),
    unavailableReason: teamAutomationUnavailableReasonSchema,
  });

export const projectAutomationStatusResponseSchema =
  z.object({
    projects: z.array(projectAutomationStatusSchema),
  });

export type TeamAutomationStatusState =
  z.infer<
    typeof teamAutomationStatusStateSchema
  >;

export type TeamAutomationUnavailableReason =
  z.infer<
    typeof teamAutomationUnavailableReasonSchema
  >;

export type ProjectAutomationStatus =
  z.infer<typeof projectAutomationStatusSchema>;

export type ProjectAutomationStatusResponse =
  z.infer<typeof projectAutomationStatusResponseSchema>;
