export interface CodexSelectionState {
  readonly text: string;
  readonly source: "raw" | "rich";
  readonly startIndex?: number;
  readonly endIndex?: number;
}

export interface CodexSelectionPayload {
  readonly text: unknown;
  readonly source: unknown;
  readonly startIndex?: unknown;
  readonly endIndex?: unknown;
}

export interface SourceIndexRange {
  readonly startIndex: number;
  readonly endIndex: number;
}

export function createCodexSelectionState(
  payload: CodexSelectionPayload
): CodexSelectionState | undefined {
  if (typeof payload.text !== "string" || payload.text.trim().length === 0) {
    return undefined;
  }

  const selection: {
    text: string;
    source: "raw" | "rich";
    startIndex?: number;
    endIndex?: number;
  } = {
    text: payload.text,
    source: payload.source === "raw" ? "raw" : "rich"
  };

  if (
    typeof payload.startIndex === "number" &&
    typeof payload.endIndex === "number" &&
    Number.isInteger(payload.startIndex) &&
    Number.isInteger(payload.endIndex) &&
    payload.startIndex >= 0 &&
    payload.endIndex > payload.startIndex
  ) {
    selection.startIndex = payload.startIndex;
    selection.endIndex = payload.endIndex;
  }

  return selection;
}

export function resolveCodexSelectionRange(
  markdown: string,
  selection: CodexSelectionState
): SourceIndexRange | undefined {
  return getValidatedSourceRange(markdown, selection) ?? findUniqueSelectionTextRange(markdown, selection.text);
}

function getValidatedSourceRange(
  markdown: string,
  selection: CodexSelectionState
): SourceIndexRange | undefined {
  if (selection.startIndex === undefined || selection.endIndex === undefined) {
    return undefined;
  }

  if (selection.startIndex < 0 || selection.endIndex > markdown.length || selection.startIndex >= selection.endIndex) {
    return undefined;
  }

  if (markdown.slice(selection.startIndex, selection.endIndex) !== selection.text) {
    return undefined;
  }

  return {
    startIndex: selection.startIndex,
    endIndex: selection.endIndex
  };
}

function findUniqueSelectionTextRange(markdown: string, selectedText: string): SourceIndexRange | undefined {
  const normalizedSelectedText = selectedText.replace(/\u00a0/g, " ");
  const directRange = findUniqueRange(markdown, normalizedSelectedText);

  if (directRange) {
    return directRange;
  }

  return findUniqueRangeWithNormalizedLineEndings(markdown, normalizedSelectedText);
}

function findUniqueRange(source: string, needle: string): SourceIndexRange | undefined {
  if (needle.length === 0) {
    return undefined;
  }

  const startIndex = source.indexOf(needle);

  if (startIndex === -1) {
    return undefined;
  }

  const secondMatchIndex = source.indexOf(needle, startIndex + 1);

  if (secondMatchIndex !== -1) {
    return undefined;
  }

  return {
    startIndex,
    endIndex: startIndex + needle.length
  };
}

function findUniqueRangeWithNormalizedLineEndings(
  source: string,
  needle: string
): SourceIndexRange | undefined {
  const normalizedNeedle = needle.replace(/\r\n?/g, "\n");

  if (normalizedNeedle === needle && !source.includes("\r")) {
    return undefined;
  }

  const { normalizedSource, indexMap } = normalizeLineEndingsWithIndexMap(source);
  const normalizedStartIndex = normalizedSource.indexOf(normalizedNeedle);

  if (normalizedStartIndex === -1) {
    return undefined;
  }

  const secondMatchIndex = normalizedSource.indexOf(normalizedNeedle, normalizedStartIndex + 1);

  if (secondMatchIndex !== -1) {
    return undefined;
  }

  const normalizedEndIndex = normalizedStartIndex + normalizedNeedle.length;

  return {
    startIndex: indexMap[normalizedStartIndex],
    endIndex: normalizedEndIndex < indexMap.length ? indexMap[normalizedEndIndex] : source.length
  };
}

function normalizeLineEndingsWithIndexMap(source: string): {
  normalizedSource: string;
  indexMap: number[];
} {
  const normalizedCharacters: string[] = [];
  const indexMap: number[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === "\r") {
      normalizedCharacters.push("\n");
      indexMap.push(index);

      if (source[index + 1] === "\n") {
        index += 1;
      }

      continue;
    }

    normalizedCharacters.push(character);
    indexMap.push(index);
  }

  return {
    normalizedSource: normalizedCharacters.join(""),
    indexMap
  };
}
