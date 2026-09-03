import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state =
  vi.hoisted(
    () => ({
      sendInstructionToExecution:
        vi.fn(),
    }),
  );

vi.mock(
  "../services/agent-execution-service.js",
  () => {
    class AgentExecutionServiceError extends Error {
      /**
       * Creates the route-test execution service error.
       */
      constructor(
        message: string,
        readonly statusCode:
          number,
      ) {
        super(message);
      }
    }

    return {
      AgentExecutionServiceError,

      /**
       * Returns a stub run for unrelated application routes.
       */
      createRun:
        vi.fn(),

      /**
       * Returns no execution for unrelated application routes.
       */
      getExecution:
        vi.fn(),

      /**
       * Returns unavailable metrics for unrelated application routes.
       */
      getLiveProcessMetrics:
        vi.fn(
          async () => ({
            cpuPercent:
              null,
            memoryBytes:
              null,
          }),
        ),

      /**
       * Returns no terminal history for unrelated application routes.
       */
      listTerminalChunks:
        vi.fn(
          async () => [],
        ),

      /**
       * Rejects resize operations in this focused route test.
       */
      resizeLiveExecution:
        vi.fn(
          () =>
            false,
        ),

      /**
       * Executes the focused instruction-control assertion.
       */
      sendInstructionToExecution:
        state.sendInstructionToExecution,

      /**
       * Provides an unused worker-start stub required by route registration.
       */
      startAgentExecution:
        vi.fn(),

      /**
       * Provides an unused terminal subscription stub required by route registration.
       */
      subscribeToExecutionTerminal:
        vi.fn(
          () =>
            undefined,
        ),

      /**
       * Provides the workflow cancellation export expected by workflow-service imports.
       */
      cancelLiveExecution:
        vi.fn(
          async () =>
            false,
        ),

      /**
       * Provides the workflow execution export expected by workflow-service imports.
       */
      startSnapshotAgentExecution:
        vi.fn(),
    };
  },
);

const {
  buildApp,
} =
  await import(
    "../app.js"
  );

let app:
  Awaited<
    ReturnType<
      typeof buildApp
    >
  >;

beforeEach(
  async () => {
    state.sendInstructionToExecution.mockReset();

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
  "agent execution instruction route",
  () => {
    it(
      "rejects an empty additional instruction",
      async () => {
        const response =
          await app.inject({
            method:
              "POST",
            url:
              `/api/agent-executions/${crypto.randomUUID()}/instructions`,
            payload: {
              instruction:
                "",
            },
          });

        expect(
          response.statusCode,
        ).toBe(400);
      },
    );

    it(
      "returns explicit unsupported state for one-shot harness sessions",
      async () => {
        state.sendInstructionToExecution.mockResolvedValue(
          {
            supported:
              false,
            delivered:
              false,
            reason:
              "The active harness invocation does not support additional instructions.",
          },
        );

        const executionId =
          crypto.randomUUID();

        const response =
          await app.inject({
            method:
              "POST",
            url:
              `/api/agent-executions/${executionId}/instructions`,
            payload: {
              instruction:
                "Please run the focused tests.",
            },
          });

        expect(
          response.statusCode,
        ).toBe(200);

        expect(
          response.json(),
        ).toEqual({
          supported:
            false,
          delivered:
            false,
          reason:
            "The active harness invocation does not support additional instructions.",
        });

        expect(
          state.sendInstructionToExecution,
        ).toHaveBeenCalledWith(
          executionId,
          "Please run the focused tests.",
        );
      },
    );
  },
);
