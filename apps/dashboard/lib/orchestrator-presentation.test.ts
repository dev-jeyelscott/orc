import assert from "node:assert/strict";

import type {
  ConversationMessage,
} from "@orc/shared";

import {
  pairConversationMessages,
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

/** Verifies the normal user-to-assistant sequence forms one exchange row. */
function testNormalPairing(): void {
  const user = createMessage(
    "00000000-0000-4000-8000-000000000011",
    "user",
    "2026-09-04T00:00:00.000Z",
  );

  const assistant = createMessage(
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
    exchanges[0]?.assistant?.id,
    assistant.id,
  );
}

/** Verifies consecutive user messages are not incorrectly paired together. */
function testConsecutiveUsers(): void {
  const firstUser = createMessage(
    "00000000-0000-4000-8000-000000000021",
    "user",
    "2026-09-04T00:00:00.000Z",
  );

  const secondUser = createMessage(
    "00000000-0000-4000-8000-000000000022",
    "user",
    "2026-09-04T00:00:01.000Z",
  );

  const assistant = createMessage(
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
    exchanges[1]?.assistant?.id,
    assistant.id,
  );
}

/** Verifies an unmatched assistant message remains visible without a fabricated user pair. */
function testAssistantWithoutUser(): void {
  const assistant = createMessage(
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
    exchanges[0]?.assistant?.id,
    assistant.id,
  );
}

/** Verifies a final persisted user message remains visible when supervisor execution fails. */
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

testNormalPairing();
testConsecutiveUsers();
testAssistantWithoutUser();
testUnmatchedFinalUser();

console.log(
  "orchestrator-presentation helper tests passed",
);
