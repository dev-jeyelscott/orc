import {
  describe,
  expect,
  it,
} from "vitest";

import {
  chunkMarkdown,
  chunkPlainText,
  MAX_CHUNK_BYTES,
} from "./project-document-chunker.js";

/**
 * Reassembles chunk drafts back into their claimed byte ranges to verify contiguity.
 */
function assertContiguousOffsets(
  chunks: ReturnType<typeof chunkMarkdown>,
): void {
  chunks.forEach((chunk, index) => {
    expect(chunk.sequence).toBe(index);
    expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);

    if (index > 0) {
      expect(chunk.startOffset).toBeGreaterThanOrEqual(
        chunks[index - 1].endOffset,
      );
    }
  });
}

describe("chunkMarkdown", () => {
  it("splits nested headings into separate ordered chunks", () => {
    const content = [
      "# Roadmap",
      "Intro paragraph.",
      "## Phase One",
      "Details for phase one.",
      "### Sub detail",
      "Nested content.",
    ].join("\n");

    const chunks = chunkMarkdown(content);

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      "# Roadmap\nIntro paragraph.\n",
      "## Phase One\nDetails for phase one.\n",
      "### Sub detail\nNested content.",
    ]);

    assertContiguousOffsets(chunks);
  });

  it("does not split on headings inside fenced code blocks", () => {
    const content = [
      "# Title",
      "Some intro.",
      "```md",
      "# Not a real heading",
      "## Also not real",
      "```",
      "Trailing text.",
    ].join("\n");

    const chunks = chunkMarkdown(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(content);
    assertContiguousOffsets(chunks);
  });

  it("splits an oversized section at paragraph boundaries first, then line boundaries", () => {
    const shortParagraph = Array.from(
      { length: 10 },
      (_, index) => `Sentence number ${index} of a short paragraph.`,
    ).join("\n");

    const unsplittableParagraph = Array.from(
      { length: 50 },
      (_, index) => `line ${index} of an oversized single-line-free paragraph`,
    ).join("\n");

    const content = [
      "# Big Section",
      shortParagraph,
      "",
      shortParagraph,
      "",
      unsplittableParagraph,
    ].join("\n");

    const chunks = chunkMarkdown(content);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk.content, "utf8")).toBeLessThanOrEqual(
        MAX_CHUNK_BYTES,
      );
    }

    assertContiguousOffsets(chunks);

    expect(chunks.map((chunk) => chunk.content).join("\n\n").replace(/\n{3,}/g, "\n\n")).toContain(
      "Big Section",
    );
  });

  it("produces identical chunks for the same normalized input every time", () => {
    const content = [
      "# Stable",
      "Body text.",
      "## Nested",
      "More body text.",
    ].join("\n");

    expect(chunkMarkdown(content)).toEqual(chunkMarkdown(content));
  });
});

describe("chunkPlainText", () => {
  it("splits plain text at paragraph boundaries", () => {
    const content = [
      "First paragraph line one.",
      "",
      "Second paragraph line one.",
      "Second paragraph line two.",
    ].join("\n");

    const chunks = chunkPlainText(content);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    assertContiguousOffsets(chunks);
    expect(chunks.map((chunk) => chunk.content).join("\n\n")).toContain(
      "Second paragraph line two.",
    );
  });

  it("falls back to line boundaries for a single oversized paragraph", () => {
    const line = "x".repeat(200);
    const content = Array.from({ length: 20 }, () => line).join("\n");

    const chunks = chunkPlainText(content);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk.content, "utf8")).toBeLessThanOrEqual(
        MAX_CHUNK_BYTES,
      );
    }

    assertContiguousOffsets(chunks);
  });

  it("produces identical chunks for the same normalized input every time", () => {
    const content = "Paragraph one.\n\nParagraph two.";

    expect(chunkPlainText(content)).toEqual(chunkPlainText(content));
  });
});
