import type { CodexSelectionState } from "./codexSelectionModel";

interface SelectionSnapshotInput {
  readonly capturedAt: Date;
  readonly selection: CodexSelectionState;
  readonly sourcePath: string;
}

export function createSelectionSnapshotFileName(documentPath: string, capturedAt: Date): string {
  const sourceName = documentPath.split("/").at(-1)?.replace(/[^a-zA-Z0-9._-]/g, "-") || "selection.md";
  const timestamp = capturedAt.toISOString().replace(/[:.]/g, "-");

  return `${timestamp}-${sourceName}`;
}

export function createSelectionSnapshot(input: SelectionSnapshotInput): string {
  return [
    "# Markflow Selection",
    "",
    `Source file: ${input.sourcePath}`,
    `Selection source: ${input.selection.source}`,
    `Captured at: ${input.capturedAt.toISOString()}`,
    "",
    fencedMarkdown(input.selection.text),
    ""
  ].join("\n");
}

function fencedMarkdown(value: string): string {
  const longestFenceLength = Math.max(3, ...Array.from(value.matchAll(/`+/g)).map((match) => match[0].length + 1));
  const fence = "`".repeat(longestFenceLength);

  return `${fence}markdown\n${value}\n${fence}`;
}
