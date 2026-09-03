import {
  conversationDetailSchema,
  conversationSchema,
  orchestratorSettingsSchema,
  postConversationMessageResponseSchema,
  type Conversation,
  type ConversationDetail,
  type OrchestratorSettings,
  type PostConversationMessageResponse,
} from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/** Performs one validated request against the conversation API. */
async function request<T>(
  path: string,
  options: RequestInit,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await fetch(
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
    const body = (await response
      .json()
      .catch(() => null)) as {
      error?: string;
    } | null;

    throw new Error(
      body?.error ??
        `Request failed: ${response.status}`,
    );
  }

  return parse(
    await response.json(),
  );
}

/** Opens the latest persisted conversation for one filesystem-backed project. */
export function openConversation(
  projectPath: string,
): Promise<Conversation> {
  return request(
    "/api/conversations",
    {
      method: "POST",
      body: JSON.stringify({
        projectPath,
      }),
    },
    conversationSchema.parse,
  );
}

/** Loads one conversation and its authoritative persisted messages. */
export function getConversation(
  id: string,
): Promise<ConversationDetail> {
  return request(
    `/api/conversations/${id}`,
    {
      cache: "no-store",
    },
    conversationDetailSchema.parse,
  );
}

/** Sends one user message and returns the supervisor reply with updated linkage. */
export function postMessage(
  id: string,
  content: string,
): Promise<PostConversationMessageResponse> {
  return request(
    `/api/conversations/${id}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content,
      }),
    },
    postConversationMessageResponseSchema.parse,
  );
}

/** Loads the separately configured supervisor harness, model, reasoning, and prompt. */
export function getOrchestratorSettings(): Promise<OrchestratorSettings> {
  return request(
    "/api/orchestrator/settings",
    {
      cache: "no-store",
    },
    orchestratorSettingsSchema.parse,
  );
}
