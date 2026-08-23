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

export interface OutlineMutation<Key extends string = string> {
  rows: OutlineRow<Key>[];
  rootKeys: Key[];
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

export function collectCollapsedOutlineKeys<Key extends string>(
  rows: readonly OutlineRow<Key>[],
  closedKeys: ReadonlySet<Key>
): Set<Key> {
  const hiddenKeys = new Set<Key>();
  let closedDepth: number | undefined;

  for (const row of rows) {
    if (closedDepth !== undefined) {
      if (row.depth > closedDepth) {
        hiddenKeys.add(row.key);
      } else {
        closedDepth = undefined;
      }
    }

    if (closedDepth === undefined && closedKeys.has(row.key)) {
      closedDepth = row.depth;
    }
  }

  return hiddenKeys;
}

export function changeOutlineDepth<Key extends string>(
  rows: readonly OutlineRow<Key>[],
  requestedRootKeys: readonly Key[],
  direction: -1 | 1,
  maximumDepth: number
): OutlineMutation<Key> | undefined {
  const requestedKeySet = new Set(requestedRootKeys);
  const rootIndexes = rows.flatMap((row, index) => requestedKeySet.has(row.key) ? [index] : []);

  if (rootIndexes.length !== requestedKeySet.size || rootIndexes.length === 0) {
    return undefined;
  }

  const firstIndex = rootIndexes[0];
  const sourceDepth = rows[firstIndex].depth;
  const parentKey = getOutlineParentKey(rows, firstIndex);
  const siblingIndexes = rows.flatMap((row, index) =>
    row.depth === sourceDepth && getOutlineParentKey(rows, index) === parentKey ? [index] : []
  );
  const selectedSiblingPositions = siblingIndexes.flatMap((index, position) =>
    requestedKeySet.has(rows[index].key) ? [position] : []
  );

  if (
    rootIndexes.some((index) => rows[index].depth !== sourceDepth) ||
    selectedSiblingPositions.length !== rootIndexes.length ||
    selectedSiblingPositions.some(
      (position, index) => index > 0 && position !== selectedSiblingPositions[index - 1] + 1
    )
  ) {
    return undefined;
  }

  const subtreeKeys = collectOutlineSubtreeKeys(rows, requestedRootKeys);
  const movingRows = rows.filter((row) => subtreeKeys.has(row.key));

  if (direction > 0) {
    const firstSiblingPosition = selectedSiblingPositions[0];

    if (
      firstSiblingPosition === 0 ||
      movingRows.some((row) => row.depth >= maximumDepth)
    ) {
      return undefined;
    }

    return {
      rows: rows.map((row) => subtreeKeys.has(row.key) ? { ...row, depth: row.depth + 1 } : { ...row }),
      rootKeys: requestedRootKeys.slice()
    };
  }

  if (sourceDepth === 0) {
    return undefined;
  }

  const parentIndex = findOutlineParentIndex(rows, firstIndex);

  if (parentIndex < 0) {
    return undefined;
  }

  let parentSubtreeEnd = rows.length;

  for (let index = parentIndex + 1; index < rows.length; index += 1) {
    if (rows[index].depth <= rows[parentIndex].depth) {
      parentSubtreeEnd = index;
      break;
    }
  }

  const remainingRows = rows.filter((row) => !subtreeKeys.has(row.key));
  const followingKey = rows[parentSubtreeEnd]?.key;
  const insertAt = followingKey === undefined
    ? remainingRows.length
    : remainingRows.findIndex((row) => row.key === followingKey);

  if (insertAt < 0) {
    return undefined;
  }

  const adjustedRows = movingRows.map((row) => ({ ...row, depth: row.depth - 1 }));
  return {
    rows: [
      ...remainingRows.slice(0, insertAt),
      ...adjustedRows,
      ...remainingRows.slice(insertAt)
    ],
    rootKeys: requestedRootKeys.slice()
  };
}

function getOutlineParentKey<Key extends string>(
  rows: readonly OutlineRow<Key>[],
  index: number
): Key | undefined {
  const parentIndex = findOutlineParentIndex(rows, index);
  return parentIndex >= 0 ? rows[parentIndex].key : undefined;
}

function findOutlineParentIndex<Key extends string>(
  rows: readonly OutlineRow<Key>[],
  index: number
): number {
  const depth = rows[index]?.depth ?? 0;

  if (depth === 0) {
    return -1;
  }

  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (rows[candidate].depth === depth - 1) {
      return candidate;
    }
  }

  return -1;
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
