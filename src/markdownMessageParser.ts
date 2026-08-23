import type { WebviewToExtensionMessage } from "../shared/markdownMessages";

export function parseWebviewMessage(value: unknown): WebviewToExtensionMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  switch (value.type) {
    case "ready":
    case "requestOpenSource":
      return { type: value.type };

    case "edit":
      return typeof value.markdown === "string"
        ? { type: "edit", markdown: value.markdown }
        : undefined;

    case "copyText":
      return typeof value.text === "string"
        ? { type: "copyText", text: value.text }
        : undefined;

    case "codexSelection":
      return parseCodexSelectionMessage(value);

    default:
      return undefined;
  }
}

function parseCodexSelectionMessage(
  value: Record<string, unknown>
): WebviewToExtensionMessage | undefined {
  if (
    typeof value.text !== "string" ||
    (value.source !== "raw" && value.source !== "rich")
  ) {
    return undefined;
  }

  const hasStartIndex = value.startIndex !== undefined;
  const hasEndIndex = value.endIndex !== undefined;

  if (!hasStartIndex && !hasEndIndex) {
    return {
      type: "codexSelection",
      text: value.text,
      source: value.source
    };
  }

  if (
    !hasStartIndex ||
    !hasEndIndex ||
    typeof value.startIndex !== "number" ||
    typeof value.endIndex !== "number" ||
    !Number.isInteger(value.startIndex) ||
    !Number.isInteger(value.endIndex) ||
    value.startIndex < 0 ||
    value.endIndex <= value.startIndex
  ) {
    return undefined;
  }

  return {
    type: "codexSelection",
    text: value.text,
    source: value.source,
    startIndex: value.startIndex,
    endIndex: value.endIndex
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
