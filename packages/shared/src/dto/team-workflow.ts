import {
  z,
} from "zod";

import {
  agentRouteOutcomeSchema,
  terminalActionSchema,
} from "../enums/agent-route.js";
import {
  agentSchema,
} from "./agent.js";

const workflowRouteTargetFieldsSchema =
  z.object({
    targetAgentId:
      z.string()
        .uuid()
        .nullable(),
    terminalAction:
      terminalActionSchema
        .nullable(),
  });

/**
 * One desired outcome route in a Team workflow save request, addressed by
 * Agent ID because that is what the operator selects; the service resolves
 * Agent IDs to stable `team_members` rows and persists routes against Team
 * member IDs internally.
 */
export const teamWorkflowRouteInputSchema =
  workflowRouteTargetFieldsSchema
    .extend({
      outcome:
        agentRouteOutcomeSchema,
    })
    .superRefine(
      (
        value,
        context,
      ) => {
        if (
          (
            value.targetAgentId ===
            null
          ) ===
          (
            value.terminalAction ===
            null
          )
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            message:
              "Set exactly one target agent or terminal action",
          });
        }
      },
    );

/**
 * One desired Team member in a Team workflow save request.
 */
export const teamWorkflowMemberInputSchema =
  z.object({
    agentId:
      z.string().uuid(),
    layer:
      z.number()
        .int()
        .min(1),
    executionOrder:
      z.number()
        .int()
        .min(1),
    routes:
      z.array(
        teamWorkflowRouteInputSchema,
      )
        .default([]),
  });

export const teamWorkflowInputSchema =
  z.object({
    members:
      z.array(
        teamWorkflowMemberInputSchema,
      )
        .default([]),
  });

/**
 * One persisted Team-owned outcome route, resolved back to concrete
 * Team member/Agent IDs for dashboard presentation.
 */
export const teamMemberRouteSchema =
  z.object({
    id:
      z.string().uuid(),
    sourceTeamMemberId:
      z.string().uuid(),
    outcome:
      agentRouteOutcomeSchema,
    targetTeamMemberId:
      z.string()
        .uuid()
        .nullable(),
    targetAgentId:
      z.string()
        .uuid()
        .nullable(),
    terminalAction:
      terminalActionSchema
        .nullable(),
  });

/**
 * One persisted Team member together with its resolved Agent/Department
 * configuration and outbound routes.
 */
export const teamMemberSchema =
  z.object({
    id:
      z.string().uuid(),
    teamId:
      z.string().uuid(),
    departmentId:
      z.string().uuid(),
    agentId:
      z.string().uuid(),
    agent:
      agentSchema,
    layer:
      z.number().int().min(1),
    executionOrder:
      z.number().int().min(1),
    routes:
      z.array(
        teamMemberRouteSchema,
      ),
  });

export const teamWorkflowSchema =
  z.object({
    teamId:
      z.string().uuid(),
    members:
      z.array(
        teamMemberSchema,
      ),
  });

export type TeamWorkflowRouteInput =
  z.infer<
    typeof teamWorkflowRouteInputSchema
  >;

export type TeamWorkflowMemberInput =
  z.infer<
    typeof teamWorkflowMemberInputSchema
  >;

export type TeamWorkflowInput =
  z.infer<
    typeof teamWorkflowInputSchema
  >;

export type TeamMemberRoute =
  z.infer<
    typeof teamMemberRouteSchema
  >;

export type TeamMember =
  z.infer<
    typeof teamMemberSchema
  >;

export type TeamWorkflow =
  z.infer<
    typeof teamWorkflowSchema
  >;
