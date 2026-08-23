import type { Definition } from "mdast";

export const MARKFLOW_BLOCK_DEPTH_DEFINITION_ID = "markflow-v1-block-depth";
export const MARKFLOW_EMPTY_BLOCK_DEFINITION_ID = "markflow-v1-empty-block";
export const MARKFLOW_BLOCK_METADATA_DEFINITION_ID = "markflow-v2-block";
export const LEGACY_MARKFLOW_BLOCK_DEPTH_DEFINITION_PREFIX = "markflow-block-depth-";

export type MarkflowToggleState = "none" | "open" | "closed";

export interface MarkflowBlockMetadata {
  depth: number;
  empty: boolean;
  listStart?: number;
  toggle: MarkflowToggleState;
}

export type MarkflowBlockMarkerKind = "depth" | "empty";

export interface MarkflowBlockMarker {
  depth: number;
  kind: MarkflowBlockMarkerKind;
}

export interface MarkdownDefinitionLike {
  identifier: string;
  title?: string | null;
  url: string;
}

export function createMarkflowBlockMetadataTitle(metadata: MarkflowBlockMetadata): string {
  const params = new URLSearchParams();
  params.set("d", String(metadata.depth));

  if (metadata.toggle !== "none") {
    params.set("t", metadata.toggle);
  }

  if (metadata.empty) {
    params.set("e", "1");
  }

  if (metadata.listStart !== undefined) {
    params.set("s", String(metadata.listStart));
  }

  return params.toString();
}

export function createMarkflowMetadataDefinition(metadata: MarkflowBlockMetadata): Definition {
  return {
    type: "definition",
    identifier: MARKFLOW_BLOCK_METADATA_DEFINITION_ID,
    label: MARKFLOW_BLOCK_METADATA_DEFINITION_ID,
    title: createMarkflowBlockMetadataTitle(metadata),
    url: "#"
  };
}

export function readMarkflowBlockMetadata(
  definition: MarkdownDefinitionLike,
  maximumDepth: number
): MarkflowBlockMetadata | undefined {
  if (
    definition.identifier.toLocaleLowerCase() !== MARKFLOW_BLOCK_METADATA_DEFINITION_ID ||
    definition.url !== "#" ||
    !definition.title
  ) {
    return undefined;
  }

  const params = new URLSearchParams(definition.title);
  const depthValue = params.get("d");
  const depth = depthValue === null ? Number.NaN : Number(depthValue);
  const toggleValue = params.get("t") ?? "none";
  const emptyValue = params.get("e") ?? "0";
  const listStartValue = params.get("s");
  const listStart = listStartValue === null ? undefined : Number(listStartValue);

  if (
    !Number.isInteger(depth) ||
    depth < 0 ||
    depth > maximumDepth ||
    (toggleValue !== "none" && toggleValue !== "open" && toggleValue !== "closed") ||
    (emptyValue !== "0" && emptyValue !== "1") ||
    (listStart !== undefined && (!Number.isSafeInteger(listStart) || listStart < 1))
  ) {
    return undefined;
  }

  return {
    depth,
    empty: emptyValue === "1",
    ...(listStart === undefined ? {} : { listStart }),
    toggle: toggleValue
  };
}

export function readMarkflowBlockMarker(
  definition: MarkdownDefinitionLike,
  maximumDepth: number
): MarkflowBlockMarker | undefined {
  const identifier = definition.identifier.toLocaleLowerCase();
  const kind = identifier === MARKFLOW_EMPTY_BLOCK_DEFINITION_ID
    ? "empty"
    : identifier === MARKFLOW_BLOCK_DEPTH_DEFINITION_ID ||
        identifier.startsWith(LEGACY_MARKFLOW_BLOCK_DEPTH_DEFINITION_PREFIX)
      ? "depth"
      : undefined;
  const depth = Number(definition.title);

  if (
    !kind ||
    definition.url !== "#" ||
    !Number.isInteger(depth) ||
    depth < 1 ||
    depth > maximumDepth
  ) {
    return undefined;
  }

  return { depth, kind };
}
