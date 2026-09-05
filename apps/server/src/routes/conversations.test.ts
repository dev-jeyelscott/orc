import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks =
  vi.hoisted(
    () => ({
      createConversation:
        vi.fn(),
      listConversations:
        vi.fn(),
      getConversation:
        vi.fn(),
      postConversationMessage:
        vi.fn(),
      getOrchestratorSettings:
        vi.fn(),
      updateOrchestratorSettings:
        vi.fn(),
      resetOrchestratorSettings:
        vi.fn(),
    }),
  );

vi.mock(
  "../services/conversation-service.js",
  () => {
    class ConversationServiceError extends Error {
      /**
       * Creates the route-test service error.
       */
      constructor(
        message:
          string,
        readonly statusCode:
          number,
      ) {
        super(
          message,
        );
      }
    }

    return {
      ConversationServiceError,
      createConversation:
        mocks.createConversation,
      listConversations:
        mocks.listConversations,
      getConversation:
        mocks.getConversation,
      postConversationMessage:
        mocks.postConversationMessage,
      getOrchestratorSettings:
        mocks.getOrchestratorSettings,
      updateOrchestratorSettings:
        mocks.updateOrchestratorSettings,
      resetOrchestratorSettings:
        mocks.resetOrchestratorSettings,
    };
  },
);

vi.mock(
  "../services/orchestrator-tool-service.js",
  () => {
    class OrchestratorToolServiceError extends Error {
      /**
       * Creates the route-test Orchestrator tool error.
       */
      constructor(
        message:
          string,
        readonly statusCode:
          number,
      ) {
        super(
          message,
        );
      }
    }

    return {
      OrchestratorToolServiceError,
    };
  },
);

const {
  buildApp,
} =
  await import(
    "../app.js"
  );

const TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

let app:
  Awaited<
    ReturnType<
      typeof buildApp
    >
  >;

/**
 * Creates a valid persisted Team-scoped Conversation response for route tests.
 */
function conversation() {
  return {
    id:
      crypto.randomUUID(),
    teamId:
      TEAM_ID,
    projectPath:
      "/workspace/orc",
    taskId:
      null,
    runId:
      null,
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  };
}

/**
 * Creates the canonical server-owned Orchestrator defaults for route assertions.
 */
function defaultSettings() {
  return {
    harness:
      "codex" as const,
    model:
      "default",
    reasoning:
      "low",
    systemPrompt:
      "You supervise engineering workflows. Use only supplied system state and never invent execution progress.",
  };
}

beforeEach(
  async () => {
    for (
      const mock of
      Object.values(
        mocks,
      )
    ) {
      mock.mockReset();
    }

    app =
      await buildApp();
  },
);

afterEach(
  async () => {
    await app.close();
  },
);

describe(
  "conversation routes",
  () => {
    it(
      "lists Conversations explicitly by Project and Team",
      async () => {
        const value =
          conversation();

        mocks.listConversations.mockResolvedValue(
          [
            value,
          ],
        );

        const response =
          await app.inject({
            method:
              "GET",
            url:
              `/api/conversations?projectPath=${encodeURIComponent(value.projectPath)}&teamId=${encodeURIComponent(value.teamId)}`,
          });

        expect(
          response.statusCode,
        ).toBe(
          200,
        );

        expect(
          mocks.listConversations,
        ).toHaveBeenCalledWith(
          value.projectPath,
          value.teamId,
        );

        expect(
          response.json(),
        ).toEqual({
          conversations: [
            value,
          ],
        });
      },
    );

    it(
      "creates a new Conversation for explicit Project and Team context",
      async () => {
        const value =
          conversation();

        mocks.createConversation.mockResolvedValue(
          value,
        );

        const response =
          await app.inject({
            method:
              "POST",
            url:
              "/api/conversations",
            payload: {
              projectPath:
                value.projectPath,
              teamId:
                value.teamId,
            },
          });

        expect(
          response.statusCode,
        ).toBe(
          201,
        );

        expect(
          mocks.createConversation,
        ).toHaveBeenCalledWith(
          value.projectPath,
          value.teamId,
        );
      },
    );

    it(
      "rejects Conversation creation without Team context",
      async () => {
        const response =
          await app.inject({
            method:
              "POST",
            url:
              "/api/conversations",
            payload: {
              projectPath:
                "/workspace/orc",
            },
          });

        expect(
          response.statusCode,
        ).toBe(
          400,
        );

        expect(
          mocks.createConversation,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects Conversation listing without Team context",
      async () => {
        const response =
          await app.inject({
            method:
              "GET",
            url:
              `/api/conversations?projectPath=${encodeURIComponent("/workspace/orc")}`,
          });

        expect(
          response.statusCode,
        ).toBe(
          400,
        );

        expect(
          mocks.listConversations,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects malformed Conversation identifiers",
      async () => {
        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/conversations/not-a-uuid",
          });

        expect(
          response.statusCode,
        ).toBe(
          400,
        );
      },
    );

    it(
      "returns persisted Orchestrator settings with canonical low reasoning",
      async () => {
        const value =
          defaultSettings();

        mocks.getOrchestratorSettings.mockResolvedValue(
          value,
        );

        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/orchestrator/settings",
          });

        expect(
          response.statusCode,
        ).toBe(
          200,
        );

        expect(
          response.json(),
        ).toEqual(
          value,
        );
      },
    );

    it(
      "updates valid Orchestrator settings",
      async () => {
        const value = {
          harness:
            "claude" as const,
          model:
            "default",
          reasoning:
            "low",
          systemPrompt:
            "Customized base prompt.",
        };

        mocks.updateOrchestratorSettings.mockResolvedValue(
          value,
        );

        const response =
          await app.inject({
            method:
              "PUT",
            url:
              "/api/orchestrator/settings",
            payload:
              value,
          });

        expect(
          response.statusCode,
        ).toBe(
          200,
        );

        expect(
          response.json(),
        ).toEqual(
          value,
        );
      },
    );

    it(
      "validates Orchestrator settings before updating persistence",
      async () => {
        const response =
          await app.inject({
            method:
              "PUT",
            url:
              "/api/orchestrator/settings",
            payload: {
              harness:
                "unsupported",
              model:
                "",
              reasoning:
                "",
              systemPrompt:
                "",
            },
          });

        expect(
          response.statusCode,
        ).toBe(
          400,
        );

        expect(
          mocks.updateOrchestratorSettings,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "resets Orchestrator settings through the server-owned reset capability",
      async () => {
        const value =
          defaultSettings();

        mocks.resetOrchestratorSettings.mockResolvedValue(
          value,
        );

        const response =
          await app.inject({
            method:
              "POST",
            url:
              "/api/orchestrator/settings/reset",
          });

        expect(
          response.statusCode,
        ).toBe(
          200,
        );

        expect(
          response.json(),
        ).toEqual(
          value,
        );
      },
    );
  },
);
