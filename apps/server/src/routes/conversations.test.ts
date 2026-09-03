import Fastify, {
  type FastifyInstance,
} from "fastify";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const serviceMocks = vi.hoisted(
  () => ({
    getConversation: vi.fn(),
    getOrCreateConversation: vi.fn(),
    getOrchestratorSettings: vi.fn(),
    postConversationMessage: vi.fn(),
  }),
);

vi.mock(
  "../services/conversation-service.js",
  () => serviceMocks,
);

import { conversationRoutes } from "./conversations.js";

describe("conversation routes", () => {
  let app: FastifyInstance;

  /** Creates an isolated Fastify application containing only conversation routes. */
  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify();

    await app.register(
      conversationRoutes,
    );

    await app.ready();
  });

  /** Closes the isolated Fastify application after every route test. */
  afterEach(async () => {
    await app.close();
  });

  /** Returns the persisted supervisor configuration through the read-only API. */
  it("returns orchestrator settings", async () => {
    serviceMocks.getOrchestratorSettings.mockResolvedValue(
      {
        harness: "codex",
        model: "default",
        reasoning: "medium",
        systemPrompt:
          "You supervise engineering workflows.",
      },
    );

    const response =
      await app.inject({
        method: "GET",
        url: "/api/orchestrator/settings",
      });

    expect(response.statusCode).toBe(
      200,
    );

    expect(response.json()).toEqual({
      harness: "codex",
      model: "default",
      reasoning: "medium",
      systemPrompt:
        "You supervise engineering workflows.",
    });
  });
});
