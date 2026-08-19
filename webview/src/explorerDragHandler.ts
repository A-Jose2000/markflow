import type { DesktopFolderEntry } from "./desktopApi";

export const MARKFLOW_EXPLORER_DRAG_TYPE = "application/x-markflow-explorer-entry+json";

export interface ExplorerDragPayload {
  readonly rootId: string;
  readonly entry: DesktopFolderEntry;
}

export function writeExplorerDragPayload(dataTransfer: DataTransfer, payload: ExplorerDragPayload): void {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(MARKFLOW_EXPLORER_DRAG_TYPE, JSON.stringify(payload));
  dataTransfer.setData("text/plain", payload.entry.name);
}

export function hasExplorerDragPayload(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).some(
    (type) => type.toLocaleLowerCase() === MARKFLOW_EXPLORER_DRAG_TYPE
  );
}

export function readExplorerDragPayload(dataTransfer: DataTransfer): ExplorerDragPayload | undefined {
  if (!hasExplorerDragPayload(dataTransfer)) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(dataTransfer.getData(MARKFLOW_EXPLORER_DRAG_TYPE));
    return isExplorerDragPayload(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isExplorerDragPayload(value: unknown): value is ExplorerDragPayload {
  if (!isRecord(value) || typeof value.rootId !== "string" || !isRecord(value.entry)) {
    return false;
  }

  const entry = value.entry;

  if (
    typeof entry.name !== "string" ||
    typeof entry.relativePath !== "string" ||
    typeof entry.kind !== "string"
  ) {
    return false;
  }

  if (entry.kind === "directory") {
    return true;
  }

  return (
    ["markdown", "image", "audio", "video", "pdf"].includes(entry.kind) &&
    typeof entry.mimeType === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
