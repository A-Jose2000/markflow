export interface OutlineRow<Key extends string = string> {
  depth: number;
  key: Key;
}

export interface OutlineInsertion<Key extends string = string> {
  afterKey?: Key;
  beforeKey?: Key;
  depth: number;
  parentKey?: Key;
}

export const MARKFLOW_BLOCK_DEPTH_DEFINITION_ID = "markflow-v1-block-depth";
export const MARKFLOW_EMPTY_BLOCK_DEFINITION_ID = "markflow-v1-empty-block";
export const LEGACY_MARKFLOW_BLOCK_DEPTH_DEFINITION_PREFIX = "markflow-block-depth-";

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

export function getOutlineDragDepthDelta(deltaX: number, indentWidth: number): number {
  if (!Number.isFinite(deltaX) || !Number.isFinite(indentWidth) || indentWidth <= 0) {
    return 0;
  }

  const deadZone = indentWidth + 12;
  const distance = Math.abs(deltaX);

  if (distance < deadZone) {
    return 0;
  }

  return Math.sign(deltaX) * (1 + Math.floor((distance - deadZone) / indentWidth));
}

export function collectOutlineSubtreeKeys<Key extends string>(
  rows: readonly OutlineRow<Key>[],
  rootKeys: readonly Key[]
): Set<Key> {
  const rootKeySet = new Set(rootKeys);
  const subtreeKeys = new Set<Key>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    if (!rootKeySet.has(row.key)) {
      continue;
    }

    subtreeKeys.add(row.key);

    for (let descendantIndex = index + 1; descendantIndex < rows.length; descendantIndex += 1) {
      const descendant = rows[descendantIndex];

      if (descendant.depth <= row.depth) {
        break;
      }

      subtreeKeys.add(descendant.key);
    }
  }

  return subtreeKeys;
}

export function resolveOutlineInsertion<Key extends string>(
  rows: readonly OutlineRow<Key>[],
  insertAt: number,
  requestedDepth: number
): OutlineInsertion<Key> | undefined {
  if (insertAt < 0 || insertAt > rows.length) {
    return undefined;
  }

  const previous = rows[insertAt - 1];
  const next = rows[insertAt];
  const minimumDepth = next?.depth ?? 0;
  const maximumDepth = previous ? previous.depth + 1 : 0;

  if (minimumDepth > maximumDepth) {
    return undefined;
  }

  const depth = Math.max(minimumDepth, Math.min(Math.max(0, Math.round(requestedDepth)), maximumDepth));
  let parentKey: Key | undefined;

  if (depth > 0) {
    for (let index = insertAt - 1; index >= 0; index -= 1) {
      if (rows[index].depth === depth - 1) {
        parentKey = rows[index].key;
        break;
      }
    }

    if (!parentKey) {
      return undefined;
    }
  }

  return {
    afterKey: previous?.key,
    beforeKey: next?.key,
    depth,
    parentKey
  };
}
