import {
  z,
} from "zod";

const teamFieldsSchema =
  z.object({
    slug:
      z.string()
        .trim()
        .min(1)
        .max(100)
        .regex(
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
          "Slug must be lowercase kebab-case",
        ),
    name:
      z.string()
        .trim()
        .min(1)
        .max(160),
    description:
      z.string()
        .trim()
        .max(2000)
        .default(""),
    enabled:
      z.boolean()
        .default(true),
  });

export const createTeamSchema =
  teamFieldsSchema;

export const updateTeamSchema =
  teamFieldsSchema.partial();

export const teamSchema =
  teamFieldsSchema.extend({
    id:
      z.string().uuid(),
    createdAt:
      z.string().datetime(),
    updatedAt:
      z.string().datetime(),
  });

export const teamListResponseSchema =
  z.object({
    teams:
      z.array(
        teamSchema,
      ),
  });

export type Team =
  z.infer<
    typeof teamSchema
  >;

export type CreateTeam =
  z.infer<
    typeof createTeamSchema
  >;

export type UpdateTeam =
  z.infer<
    typeof updateTeamSchema
  >;
