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
      connect:
        vi.fn(),
      callTool:
        vi.fn(),
      close:
        vi.fn(),
      clientConstructor:
        vi.fn(),
      transportConstructor:
        vi.fn(),
    }),
  );

vi.mock(
  "@modelcontextprotocol/client",
  () => ({
    Client:
      class {
        /**
         * Records construction without launching a real MCP client.
         */
        constructor(
          options:
            unknown,
        ) {
          mocks
            .clientConstructor(
              options,
            );
        }

        /**
         * Delegates connection behavior to the deterministic test fake.
         */
        connect(
          transport:
            unknown,
        ) {
          return mocks
            .connect(
              transport,
            );
        }

        /**
         * Delegates MCP tool calls to the deterministic test fake.
         */
        callTool(
          input:
            unknown,
        ) {
          return mocks
            .callTool(
              input,
            );
        }

        /**
         * Delegates client closure to the deterministic test fake.
         */
        close() {
          return mocks
            .close();
        }
      },
  }),
);

vi.mock(
  "@modelcontextprotocol/client/stdio",
  () => ({
    /**
     * Supplies a deterministic minimal child environment for the fake transport.
     */
    getDefaultEnvironment:
      () => ({
        PATH:
          "/usr/bin",
      }),

    StdioClientTransport:
      class {
        /**
         * Records transport configuration without spawning a child process.
         */
        constructor(
          options:
            unknown,
        ) {
          mocks
            .transportConstructor(
              options,
            );
        }
      },
  }),
);

const {
  env,
} =
  await import(
    "../config/env.js"
  );

const {
  closeKnowledgeMcpClient,
  getKnowledgeSection,
  searchKnowledge,
} =
  await import(
    "./knowledge-mcp-client.js"
  );

beforeEach(
  async () => {
    await closeKnowledgeMcpClient();

    for (
      const mock of
      Object.values(
        mocks,
      )
    ) {
      mock.mockReset();
    }

    mocks.connect
      .mockResolvedValue(
        undefined,
      );

    mocks.close
      .mockResolvedValue(
        undefined,
      );

    env.KNOWLEDGE_MCP_COMMAND =
      "knowledge-vault-mcp";
  },
);

afterEach(
  async () => {
    await closeKnowledgeMcpClient();

    delete env
      .KNOWLEDGE_MCP_COMMAND;
  },
);

describe(
  "knowledge MCP client",
  () => {
    it(
      "returns knowledge_unavailable without constructing a client when knowledge is disabled",
      async () => {
        delete env
          .KNOWLEDGE_MCP_COMMAND;

        const result =
          await searchKnowledge({
            projectName:
              "orc",
            query:
              "workflow",
            area:
              "project",
            scope:
              "default",
            limit:
              5,
          });

        expect(
          result.status,
        ).toBe(
          "knowledge_unavailable",
        );

        expect(
          mocks
            .clientConstructor,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "maps default Project search to only the approved MCP search tool",
      async () => {
        mocks.callTool
          .mockResolvedValue({
            structuredContent: {
              results: [
                {
                  path:
                    "Projects/orc/Decisions/Workflow.md",
                  title:
                    "Workflow",
                  authority: {
                    tier:
                      "tier1",
                    class:
                      "curated",
                    access:
                      "default-searchable",
                  },
                  score:
                    10,
                  metadata: {
                    project:
                      ["orc"],
                    tags:
                      [],
                    type:
                      [],
                    status:
                      [],
                  },
                  evidence: [
                    {
                      kind:
                        "heading",
                      text:
                        "Workflow snapshots",
                    },
                  ],
                },
              ],
            },
          });

        const result =
          await searchKnowledge({
            projectName:
              "orc",
            query:
              "workflow",
            area:
              "project",
            scope:
              "default",
            limit:
              5,
          });

        expect(
          result.status,
        ).toBe(
          "ok",
        );

        expect(
          result.results[0]
            ?.authority.tier,
        ).toBe(
          "tier1",
        );

        expect(
          mocks.callTool,
        ).toHaveBeenCalledWith({
          name:
            "search_knowledge",
          arguments: {
            query:
              "workflow",
            project:
              "orc",
            scope:
              "default",
            limit:
              5,
          },
        });
      },
    );

    it(
      "maps wiki and explicit Tier 2 retrieval without exposing source scope",
      async () => {
        mocks.callTool
          .mockResolvedValue({
            structuredContent: {
              results: [
                {
                  path:
                    "wiki/Architecture.md",
                  title:
                    "Architecture",
                  authority: {
                    tier:
                      "tier1",
                    class:
                      "curated",
                    access:
                      "default-searchable",
                  },
                  score:
                    4,
                  metadata: {
                    project:
                      [],
                    tags:
                      [],
                    type:
                      [],
                    status:
                      [],
                  },
                  evidence:
                    [],
                },
              ],
            },
          });

        await searchKnowledge({
          projectName:
            "orc",
          query:
            "architecture",
          area:
            "wiki",
          scope:
            "tier2",
          limit:
            3,
        });

        expect(
          mocks.callTool,
        ).toHaveBeenCalledWith({
          name:
            "search_knowledge",
          arguments: {
            query:
              "architecture",
            folder:
              "wiki",
            scope:
              "tier2",
            limit:
              3,
          },
        });
      },
    );

    it(
      "distinguishes successful empty results from unavailable knowledge",
      async () => {
        mocks.callTool
          .mockResolvedValue({
            structuredContent: {
              results: [],
            },
          });

        const empty =
          await searchKnowledge({
            projectName:
              "orc",
            query:
              "nothing",
            area:
              "project",
            scope:
              "default",
            limit:
              5,
          });

        expect(
          empty,
        ).toMatchObject({
          status:
            "ok",
          results: [],
        });

        await closeKnowledgeMcpClient();

        mocks.connect
          .mockRejectedValue(
            new Error(
              "spawn ENOENT",
            ),
          );

        const unavailable =
          await searchKnowledge({
            projectName:
              "orc",
            query:
              "workflow",
            area:
              "project",
            scope:
              "default",
            limit:
              5,
          });

        expect(
          unavailable.status,
        ).toBe(
          "knowledge_unavailable",
        );
      },
    );

    it(
      "returns retrieval_error for MCP retrieval errors and malformed structured content",
      async () => {
        mocks.callTool
          .mockResolvedValueOnce({
            isError:
              true,
            content: [],
          });

        const retrievalError =
          await searchKnowledge({
            projectName:
              "orc",
            query:
              "workflow",
            area:
              "project",
            scope:
              "default",
            limit:
              5,
          });

        expect(
          retrievalError.status,
        ).toBe(
          "retrieval_error",
        );

        mocks.callTool
          .mockResolvedValueOnce({
            structuredContent: {
              unexpected:
                true,
            },
          });

        const malformed =
          await searchKnowledge({
            projectName:
              "orc",
            query:
              "workflow",
            area:
              "project",
            scope:
              "default",
            limit:
              5,
          });

        expect(
          malformed.status,
        ).toBe(
          "retrieval_error",
        );
      },
    );

    it(
      "maps exact bounded sections only to get_note_section",
      async () => {
        mocks.callTool
          .mockResolvedValue({
            structuredContent: {
              path:
                "Projects/orc/Overview.md",
              title:
                "ORC Overview",
              authority: {
                tier:
                  "tier1",
                class:
                  "curated",
                access:
                  "default-searchable",
              },
              heading:
                "Architecture",
              content:
                "Persisted runtime state remains authoritative.",
              truncated:
                false,
              charsReturned:
                46,
              bytesReturned:
                46,
            },
          });

        const result =
          await getKnowledgeSection({
            projectName:
              "orc",
            path:
              "Projects/orc/Overview.md",
            heading:
              "Architecture",
            maxChars:
              800,
          });

        expect(
          result.status,
        ).toBe(
          "ok",
        );

        expect(
          result.section
            ?.ref,
        ).toMatchObject({
          source:
            "vault",
          path:
            "Projects/orc/Overview.md",
          heading:
            "Architecture",
        });

        expect(
          mocks.callTool,
        ).toHaveBeenCalledWith({
          name:
            "get_note_section",
          arguments: {
            path:
              "Projects/orc/Overview.md",
            heading:
              "Architecture",
            maxChars:
              800,
          },
        });
      },
    );

    it(
      "never surfaces a search result from another Project or excluded runtime note returned by a faulty fake",
      async () => {
        mocks.callTool
          .mockResolvedValue({
            structuredContent: {
              results: [
                {
                  path:
                    "Projects/other/Decisions/Foreign.md",
                  title:
                    "Foreign",
                  authority: {
                    tier:
                      "tier1",
                    class:
                      "curated",
                    access:
                      "default-searchable",
                  },
                  score:
                    100,
                  metadata: {
                    project:
                      ["other"],
                    tags:
                      [],
                    type:
                      [],
                    status:
                      [],
                  },
                  evidence:
                    [],
                },
                {
                  path:
                    "Projects/orc/STATE.md",
                  title:
                    "STATE",
                  authority: {
                    tier:
                      "tier3",
                    class:
                      "excluded",
                    access:
                      "exact-read-only",
                  },
                  score:
                    99,
                  metadata: {
                    project:
                      ["orc"],
                    tags:
                      [],
                    type:
                      [],
                    status:
                      [],
                  },
                  evidence:
                    [],
                },
              ],
            },
          });

        const result =
          await searchKnowledge({
            projectName:
              "orc",
            query:
              "status",
            area:
              "project",
            scope:
              "default",
            limit:
              5,
          });

        expect(
          result.results.some(
            (
              item,
            ) =>
              item.path.startsWith(
                "Projects/other/",
              ),
          ),
        ).toBe(
          false,
        );

        expect(
          mocks.callTool,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            name:
              "search_knowledge",
            arguments:
              expect.objectContaining({
                scope:
                  "default",
              }),
          }),
        );
      },
    );

    it(
      "uses only the two hardcoded MCP tool names",
      async () => {
        mocks.callTool
          .mockResolvedValueOnce({
            structuredContent: {
              results: [],
            },
          })
          .mockResolvedValueOnce({
            structuredContent: {
              path:
                "wiki/Runbook.md",
              title:
                "Runbook",
              authority: {
                tier:
                  "tier1",
                class:
                  "curated",
                access:
                  "default-searchable",
              },
              heading:
                "Recovery",
              content:
                "Recovery context.",
              truncated:
                false,
              charsReturned:
                17,
              bytesReturned:
                17,
            },
          });

        await searchKnowledge({
          projectName:
            "orc",
          query:
            "runbook",
          area:
            "project",
          scope:
            "default",
          limit:
            5,
        });

        await getKnowledgeSection({
          projectName:
            "orc",
          path:
            "wiki/Runbook.md",
          heading:
            "Recovery",
          maxChars:
            500,
        });

        expect(
          mocks.callTool.mock.calls.map(
            (
              call,
            ) =>
              (
                call[0] as {
                  name:
                    string;
                }
              ).name,
          ),
        ).toEqual([
          "search_knowledge",
          "get_note_section",
        ]);
      },
    );
  },
);
