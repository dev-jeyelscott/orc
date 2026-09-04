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
  path: string,
  options:
    RequestInit,
  parse: (
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
      (await response
        .json()
        .catch(
          () =>
            null,
        )) as
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
 * Lists persisted conversations for the selected project.
 */
export function listConversations(
  projectPath: string,
): Promise<ConversationListResponse> {
  return request(
    `/api/conversations?projectPath=${encodeURIComponent(projectPath)}`,
    {},
    conversationListResponseSchema.parse,
  );
}

/**
 * Creates a new persistent conversation for the selected project.
 */
export function createConversation(
  projectPath: string,
): Promise<Conversation> {
  return request(
    "/api/conversations",
    {
      method:
        "POST",
      body:
        JSON.stringify({
          projectPath,
        }),
    },
    conversationSchema.parse,
  );
}

/**
 * Loads one conversation and its persisted message history.
 */
export function getConversation(
  id: string,
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
  id: string,
  content: string,
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
 * Loads the persisted orchestrator harness and model configuration.
 */
export function getOrchestratorSettings(): Promise<OrchestratorSettings> {
  return request(
    "/api/orchestrator/settings",
    {},
    orchestratorSettingsSchema.parse,
  );
}

/**
 * Updates the persisted orchestrator harness and model configuration.
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
