import type { OutlineRow } from "./blockIndentationModel";

export interface OutlineNumberingRow<Key extends string = string> extends OutlineRow<Key> {
  kind: "ordered" | "other";
  preferredStart?: number;
}

export function resolveOutlineNumberMarkers<Key extends string>(
  currentRows: readonly OutlineNumberingRow<Key>[],
  nextRows: readonly OutlineNumberingRow<Key>[]
): Map<Key, number> {
  const markers = new Map<Key, number>();
  const currentParents = getOutlineParentKeys(currentRows);
  const nextParents = getOutlineParentKeys(nextRows);
  const counters: Array<{ parentKey?: Key; value: number } | undefined> = [];

  for (const row of nextRows) {
    const parentKey = nextParents.get(row.key);
    counters.length = row.depth + 1;

    if (row.kind === "ordered") {
      const current = counters[row.depth];
      const wasReparented =
        currentParents.has(row.key) && currentParents.get(row.key) !== parentKey;
      const value = current && current.parentKey === parentKey
        ? current.value + 1
        : wasReparented
          ? 1
          : normalizeStart(row.preferredStart);
      counters[row.depth] = { parentKey, value };
      markers.set(row.key, value);
    } else {
      counters[row.depth] = undefined;
    }
  }

  return markers;
}

function getOutlineParentKeys<Key extends string>(
  rows: readonly OutlineRow<Key>[]
): Map<Key, Key | undefined> {
  const parents = new Map<Key, Key | undefined>();
  const stack: Key[] = [];

  for (const row of rows) {
    parents.set(row.key, row.depth > 0 ? stack[row.depth - 1] : undefined);
    stack.length = row.depth;
    stack[row.depth] = row.key;
  }

  return parents;
}

function normalizeStart(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : 1;
}
