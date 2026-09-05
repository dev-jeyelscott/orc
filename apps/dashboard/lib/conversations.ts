import {
  conversationDetailSchema,
  conversationListResponseSchema,
  conversationSchema,
  orchestratorSettingsSchema,
  postConversationMessageResponseSchema,
  type Conversation,
  type ConversationDetail,
  type ConversationListResponse,
  type OrchestratorSettings,
} from "@orc/shared";

const SERVER_URL =
  process.env
    .NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/**
 * Executes one JSON API request and validates the returned payload.
 */
async function request<T>(
  path:
    string,
  options:
    RequestInit,
  parse:
    (
      value: unknown,
    ) => T,
): Promise<T> {
  const response =
    await fetch(
      `${SERVER_URL}${path}`,
      {
        ...options,
        headers: {
          "content-type":
            "application/json",
          ...options.headers,
        },
      },
    );

  if (!response.ok) {
    const body =
      (
        await response
          .json()
          .catch(
            () =>
              null,
          )
      ) as
        | {
            error?:
              string;
          }
        | null;

    throw new Error(
      body?.error ??
        `Request failed: ${response.status}`,
    );
  }

  return parse(
    await response.json(),
  );
}

/**
 * Lists persisted Conversations for the selected Project and Team.
 */
export function listConversations(
  projectPath:
    string,
  teamId:
    string,
): Promise<ConversationListResponse> {
  const query =
    new URLSearchParams({
      projectPath,
      teamId,
    });

  return request(
    `/api/conversations?${query.toString()}`,
    {},
    conversationListResponseSchema.parse,
  );
}

/**
 * Creates a new persistent Conversation for the selected Project and Team.
 */
export function createConversation(
  projectPath:
    string,
  teamId:
    string,
): Promise<Conversation> {
  return request(
    "/api/conversations",
    {
      method:
        "POST",
      body:
        JSON.stringify({
          projectPath,
          teamId,
        }),
    },
    conversationSchema.parse,
  );
}

/**
 * Loads one Conversation and its persisted message history.
 */
export function getConversation(
  id:
    string,
): Promise<ConversationDetail> {
  return request(
    `/api/conversations/${id}`,
    {},
    conversationDetailSchema.parse,
  );
}

/**
 * Posts one user message and returns the grounded persisted supervisor response.
 */
export function postMessage(
  id:
    string,
  content:
    string,
) {
  return request(
    `/api/conversations/${id}/messages`,
    {
      method:
        "POST",
      body:
        JSON.stringify({
          content,
        }),
    },
    postConversationMessageResponseSchema.parse,
  );
}

/**
 * Loads the persisted Orchestrator harness and model configuration.
 */
export function getOrchestratorSettings(): Promise<OrchestratorSettings> {
  return request(
    "/api/orchestrator/settings",
    {},
    orchestratorSettingsSchema.parse,
  );
}

/**
 * Updates the persisted Orchestrator harness and model configuration.
 */
export function updateOrchestratorSettings(
  settings:
    OrchestratorSettings,
): Promise<OrchestratorSettings> {
  return request(
    "/api/orchestrator/settings",
    {
      method:
        "PUT",
      body:
        JSON.stringify(
          settings,
        ),
    },
    orchestratorSettingsSchema.parse,
  );
}

/**
 * Restores the persisted Orchestrator configuration to current server-owned defaults.
 */
export function resetOrchestratorSettings(): Promise<OrchestratorSettings> {
  return request(
    "/api/orchestrator/settings/reset",
    {
      method:
        "POST",
    },
    orchestratorSettingsSchema.parse,
  );
}
