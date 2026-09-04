import assert from "node:assert/strict";

import type {
  ConversationMessage,
} from "@orc/shared";

import {
  pairConversationMessages,
  type ConversationExchange,
} from "./orchestrator-presentation";

/** Creates one deterministic persisted conversation message for helper verification. */
function createMessage(
  id: string,
  role: ConversationMessage["role"],
  createdAt: string,
): ConversationMessage {
  return {
    id,
    conversationId:
      "00000000-0000-4000-8000-000000000001",
    role,
    content: `${role}:${id}`,
    createdAt,
  };
}

/** Flattens display exchanges back into persisted message order for lossless-presentation assertions. */
function flattenMessageIds(
  exchanges: readonly ConversationExchange[],
): string[] {
  return exchanges.flatMap(
    (exchange) => {
      const ids: string[] =
        [];

      if (exchange.user) {
        ids.push(
          exchange.user.id,
        );
      }

      if (
        exchange.assistant
      ) {
        ids.push(
          exchange.assistant.id,
        );
      }

      return ids;
    },
  );
}

/** Verifies the normal user-to-assistant sequence forms one deterministic exchange. */
function testNormalPairing(): void {
  const user = createMessage(
    "00000000-0000-4000-8000-000000000011",
    "user",
    "2026-09-04T00:00:00.000Z",
  );

  const assistant =
    createMessage(
      "00000000-0000-4000-8000-000000000012",
      "assistant",
      "2026-09-04T00:00:01.000Z",
    );

  const exchanges =
    pairConversationMessages([
      user,
      assistant,
    ]);

  assert.equal(
    exchanges.length,
    1,
  );

  assert.equal(
    exchanges[0]?.user?.id,
    user.id,
  );

  assert.equal(
    exchanges[0]?.assistant
      ?.id,
    assistant.id,
  );
}

/** Verifies consecutive user messages remain separate instead of being incorrectly paired together. */
function testConsecutiveUsers(): void {
  const firstUser =
    createMessage(
      "00000000-0000-4000-8000-000000000021",
      "user",
      "2026-09-04T00:00:00.000Z",
    );

  const secondUser =
    createMessage(
      "00000000-0000-4000-8000-000000000022",
      "user",
      "2026-09-04T00:00:01.000Z",
    );

  const assistant =
    createMessage(
      "00000000-0000-4000-8000-000000000023",
      "assistant",
      "2026-09-04T00:00:02.000Z",
    );

  const exchanges =
    pairConversationMessages([
      firstUser,
      secondUser,
      assistant,
    ]);

  assert.equal(
    exchanges.length,
    2,
  );

  assert.equal(
    exchanges[0]?.user?.id,
    firstUser.id,
  );

  assert.equal(
    exchanges[0]?.assistant,
    null,
  );

  assert.equal(
    exchanges[1]?.user?.id,
    secondUser.id,
  );

  assert.equal(
    exchanges[1]?.assistant
      ?.id,
    assistant.id,
  );
}

/** Verifies an unmatched assistant message remains visible without a fabricated user pair. */
function testAssistantWithoutUser(): void {
  const assistant =
    createMessage(
      "00000000-0000-4000-8000-000000000031",
      "assistant",
      "2026-09-04T00:00:00.000Z",
    );

  const exchanges =
    pairConversationMessages([
      assistant,
    ]);

  assert.equal(
    exchanges.length,
    1,
  );

  assert.equal(
    exchanges[0]?.user,
    null,
  );

  assert.equal(
    exchanges[0]?.assistant
      ?.id,
    assistant.id,
  );
}

/** Verifies a final persisted user message remains visible when no assistant response exists. */
function testUnmatchedFinalUser(): void {
  const user = createMessage(
    "00000000-0000-4000-8000-000000000041",
    "user",
    "2026-09-04T00:00:00.000Z",
  );

  const exchanges =
    pairConversationMessages([
      user,
    ]);

  assert.equal(
    exchanges.length,
    1,
  );

  assert.equal(
    exchanges[0]?.user?.id,
    user.id,
  );

  assert.equal(
    exchanges[0]?.assistant,
    null,
  );
}

/** Verifies repeated assistant messages remain distinct after the first assistant closes a user exchange. */
function testConsecutiveAssistants(): void {
  const user = createMessage(
    "00000000-0000-4000-8000-000000000051",
    "user",
    "2026-09-04T00:00:00.000Z",
  );

  const firstAssistant =
    createMessage(
      "00000000-0000-4000-8000-000000000052",
      "assistant",
      "2026-09-04T00:00:01.000Z",
    );

  const secondAssistant =
    createMessage(
      "00000000-0000-4000-8000-000000000053",
      "assistant",
      "2026-09-04T00:00:02.000Z",
    );

  const exchanges =
    pairConversationMessages([
      user,
      firstAssistant,
      secondAssistant,
    ]);

  assert.equal(
    exchanges.length,
    2,
  );

  assert.equal(
    exchanges[0]?.assistant
      ?.id,
    firstAssistant.id,
  );

  assert.equal(
    exchanges[1]?.user,
    null,
  );

  assert.equal(
    exchanges[1]?.assistant
      ?.id,
    secondAssistant.id,
  );
}

/** Verifies pairing preserves every persisted message exactly once and in chronological order. */
function testPreservesEveryMessageOnceInOrder(): void {
  const messages = [
    createMessage(
      "00000000-0000-4000-8000-000000000061",
      "assistant",
      "2026-09-04T00:00:00.000Z",
    ),
    createMessage(
      "00000000-0000-4000-8000-000000000062",
      "user",
      "2026-09-04T00:00:01.000Z",
    ),
    createMessage(
      "00000000-0000-4000-8000-000000000063",
      "assistant",
      "2026-09-04T00:00:02.000Z",
    ),
    createMessage(
      "00000000-0000-4000-8000-000000000064",
      "assistant",
      "2026-09-04T00:00:03.000Z",
    ),
    createMessage(
      "00000000-0000-4000-8000-000000000065",
      "user",
      "2026-09-04T00:00:04.000Z",
    ),
  ];

  const exchanges =
    pairConversationMessages(
      messages,
    );

  assert.deepEqual(
    flattenMessageIds(
      exchanges,
    ),
    messages.map(
      (message) =>
        message.id,
    ),
  );
}

testNormalPairing();
testConsecutiveUsers();
testAssistantWithoutUser();
testUnmatchedFinalUser();
testConsecutiveAssistants();
testPreservesEveryMessageOnceInOrder();

console.log(
  "orchestrator-presentation helper tests passed",
);
