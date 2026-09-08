export const MAX_CHUNK_BYTES = 2000;

export type ProjectDocumentChunkDraft = {
  sequence: number;
  startOffset: number;
  endOffset: number;
  content: string;
};

type CharRange = {
  start: number;
  end: number;
};

const HEADING_PATTERN = /^(#{1,6})\s+/;
const FENCE_PATTERN = /^(```|~~~)/;

/**
 * Groups Markdown content into heading-delimited character ranges, ignoring heading syntax inside fenced code blocks.
 */
function splitIntoHeadingRanges(content: string): CharRange[] {
  const ranges: CharRange[] = [];

  let sectionStart = 0;
  let cursor = 0;
  let insideFence = false;
  let sawNonHeadingContent = false;

  const lines = content.split("\n");

  for (const line of lines) {
    const lineStart = cursor;
    const lineEnd = cursor + line.length;

    if (FENCE_PATTERN.test(line)) {
      insideFence = !insideFence;
      sawNonHeadingContent = true;
    } else if (!insideFence && HEADING_PATTERN.test(line)) {
      if (sawNonHeadingContent && lineStart > sectionStart) {
        ranges.push({ start: sectionStart, end: lineStart });
        sectionStart = lineStart;
      }

      sawNonHeadingContent = true;
    } else {
      sawNonHeadingContent = true;
    }

    cursor = lineEnd + 1;
  }

  if (sectionStart < content.length) {
    ranges.push({ start: sectionStart, end: content.length });
  }

  return ranges.filter((range) => content.slice(range.start, range.end).trim().length > 0);
}

/**
 * Splits paragraphs (separated by one or more blank lines) within a character range into sub-ranges.
 */
function splitIntoParagraphRanges(content: string, range: CharRange): CharRange[] {
  const ranges: CharRange[] = [];
  const paragraphPattern = /\n{2,}/g;

  let paragraphStart = range.start;
  paragraphPattern.lastIndex = range.start;

  let match: RegExpExecArray | null;

  while ((match = paragraphPattern.exec(content)) !== null) {
    if (match.index >= range.end) {
      break;
    }

    ranges.push({ start: paragraphStart, end: match.index });
    paragraphStart = match.index + match[0].length;
    paragraphPattern.lastIndex = paragraphStart;
  }

  ranges.push({ start: paragraphStart, end: range.end });

  return ranges.filter((piece) => content.slice(piece.start, piece.end).trim().length > 0);
}

/**
 * Splits a character range into line-bounded sub-ranges, each no larger than one line's worth of content.
 */
function splitIntoLineRanges(content: string, range: CharRange): CharRange[] {
  const ranges: CharRange[] = [];
  let lineStart = range.start;

  for (let index = range.start; index < range.end; index += 1) {
    if (content[index] === "\n") {
      ranges.push({ start: lineStart, end: index });
      lineStart = index + 1;
    }
  }

  ranges.push({ start: lineStart, end: range.end });

  return ranges.filter((piece) => content.slice(piece.start, piece.end).trim().length > 0);
}

/**
 * Merges adjacent sub-ranges up to the byte budget, never combining ranges across a hard split point.
 */
function mergeRangesToBudget(content: string, ranges: CharRange[]): CharRange[] {
  const merged: CharRange[] = [];
  let current: CharRange | null = null;

  for (const range of ranges) {
    if (!current) {
      current = { ...range };
      continue;
    }

    const candidateText = content.slice(current.start, range.end);

    if (Buffer.byteLength(candidateText, "utf8") <= MAX_CHUNK_BYTES) {
      current = { start: current.start, end: range.end };
      continue;
    }

    merged.push(current);
    current = { ...range };
  }

  if (current) {
    merged.push(current);
  }

  return merged;
}

/**
 * Splits one oversized range at paragraph boundaries, falling back to line boundaries for oversized paragraphs.
 */
function splitOversizedRange(content: string, range: CharRange): CharRange[] {
  const paragraphRanges = splitIntoParagraphRanges(content, range);
  const boundedRanges: CharRange[] = [];

  for (const paragraphRange of paragraphRanges) {
    const paragraphText = content.slice(paragraphRange.start, paragraphRange.end);

    if (Buffer.byteLength(paragraphText, "utf8") <= MAX_CHUNK_BYTES) {
      boundedRanges.push(paragraphRange);
      continue;
    }

    boundedRanges.push(...mergeRangesToBudget(content, splitIntoLineRanges(content, paragraphRange)));
  }

  return mergeRangesToBudget(content, boundedRanges);
}

/**
 * Converts ordered character ranges into byte-offset chunk drafts with stable sequence numbers.
 */
function toChunkDrafts(content: string, ranges: CharRange[]): ProjectDocumentChunkDraft[] {
  return ranges.map((range, index) => ({
    sequence: index,
    startOffset: Buffer.byteLength(content.slice(0, range.start), "utf8"),
    endOffset: Buffer.byteLength(content.slice(0, range.end), "utf8"),
    content: content.slice(range.start, range.end),
  }));
}

/**
 * Deterministically chunks Markdown content using heading hierarchy outside fenced code blocks.
 */
export function chunkMarkdown(content: string): ProjectDocumentChunkDraft[] {
  const headingRanges = splitIntoHeadingRanges(content);
  const ranges: CharRange[] = [];

  for (const headingRange of headingRanges) {
    const sectionText = content.slice(headingRange.start, headingRange.end);

    if (Buffer.byteLength(sectionText, "utf8") <= MAX_CHUNK_BYTES) {
      ranges.push(headingRange);
      continue;
    }

    ranges.push(...splitOversizedRange(content, headingRange));
  }

  return toChunkDrafts(content, ranges);
}

/**
 * Deterministically chunks plain text content at paragraph boundaries, falling back to line boundaries.
 */
export function chunkPlainText(content: string): ProjectDocumentChunkDraft[] {
  const fullRange: CharRange = { start: 0, end: content.length };
  const paragraphRanges = splitIntoParagraphRanges(content, fullRange);
  const boundedRanges: CharRange[] = [];

  for (const paragraphRange of paragraphRanges) {
    const paragraphText = content.slice(paragraphRange.start, paragraphRange.end);

    if (Buffer.byteLength(paragraphText, "utf8") <= MAX_CHUNK_BYTES) {
      boundedRanges.push(paragraphRange);
      continue;
    }

    boundedRanges.push(...mergeRangesToBudget(content, splitIntoLineRanges(content, paragraphRange)));
  }

  const merged = mergeRangesToBudget(content, boundedRanges);

  return toChunkDrafts(content, merged);
}
