import type {
  FastifyInstance,
} from "fastify";
import { z } from "zod";

import {
  createConversationSchema,
  postConversationMessageSchema,
  updateOrchestratorSettingsSchema,
} from "@orc/shared";

import {
  ConversationServiceError,
  createConversation,
  getConversation,
  getOrchestratorSettings,
  listConversations,
  postConversationMessage,
  resetOrchestratorSettings,
  updateOrchestratorSettings,
} from "../services/conversation-service.js";
import {
  OrchestratorToolServiceError,
} from "../services/orchestrator-tool-service.js";

const idParams =
  z.object({
    id:
      z.string().uuid(),
  });

const conversationQuery =
  createConversationSchema;

/**
 * Sends known conversation and orchestrator-tool errors with their intended HTTP status.
 */
function sendError(
  error: unknown,
  reply: {
    status: (
      code: number,
    ) => {
      send: (
        body: unknown,
      ) => unknown;
    };
  },
) {
  if (
    error instanceof
      ConversationServiceError ||
    error instanceof
      OrchestratorToolServiceError
  ) {
    return reply
      .status(
        error.statusCode,
      )
      .send({
        error:
          error.message,
      });
  }

  throw error;
}

/**
 * Registers persistent Conversation and Orchestrator settings routes.
 */
export async function conversationRoutes(
  app:
    FastifyInstance,
) {
  app.get(
    "/api/conversations",
    async (
      request,
      reply,
    ) => {
      const parsed =
        conversationQuery.safeParse(
          request.query,
        );

      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error:
              "projectPath and teamId are required",
          });
      }

      try {
        return {
          conversations:
            await listConversations(
              parsed.data
                .projectPath,
              parsed.data
                .teamId,
            ),
        };
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.post(
    "/api/conversations",
    async (
      request,
      reply,
    ) => {
      const parsed =
        createConversationSchema.safeParse(
          request.body,
        );

      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error:
              "projectPath and teamId are required",
          });
      }

      try {
        return reply
          .status(201)
          .send(
            await createConversation(
              parsed.data
                .projectPath,
              parsed.data
                .teamId,
            ),
          );
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.get(
    "/api/conversations/:id",
    async (
      request,
      reply,
    ) => {
      const parsed =
        idParams.safeParse(
          request.params,
        );

      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error:
              "invalid_conversation_id",
          });
      }

      const value =
        await getConversation(
          parsed.data.id,
        );

      return (
        value ??
        reply
          .status(404)
          .send({
            error:
              "conversation_not_found",
          })
      );
    },
  );

  app.post(
    "/api/conversations/:id/messages",
    async (
      request,
      reply,
    ) => {
      const params =
        idParams.safeParse(
          request.params,
        );

      const body =
        postConversationMessageSchema.safeParse(
          request.body,
        );

      if (
        !params.success ||
        !body.success
      ) {
        return reply
          .status(400)
          .send({
            error:
              "invalid_message",
          });
      }

      try {
        const value =
          await postConversationMessage(
            params.data.id,
            body.data
              .content,
          );

        return (
          value ??
          reply
            .status(404)
            .send({
              error:
                "conversation_not_found",
            })
        );
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.get(
    "/api/orchestrator/settings",
    async (
      _request,
      reply,
    ) => {
      try {
        return await getOrchestratorSettings();
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.put(
    "/api/orchestrator/settings",
    async (
      request,
      reply,
    ) => {
      const parsed =
        updateOrchestratorSettingsSchema.safeParse(
          request.body,
        );

      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error:
              parsed.error.issues
                .map(
                  (
                    issue,
                  ) =>
                    issue.message,
                )
                .join(", "),
          });
      }

      try {
        return await updateOrchestratorSettings(
          parsed.data,
        );
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.post(
    "/api/orchestrator/settings/reset",
    async (
      _request,
      reply,
    ) => {
      try {
        return await resetOrchestratorSettings();
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );
}
