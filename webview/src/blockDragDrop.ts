import type { LexicalEditor, NodeKey } from "lexical";

import {
  getEditorContentHorizontalBounds,
  getBlockNestingIndentWidth,
  getVisualBlockRect
} from "./blockGeometry";
import {
  collectOutlineSubtreeKeys,
  getOutlineDragDepthDelta,
  resolveOutlineInsertion,
  type OutlineRow
} from "./blockIndentationModel";
import {
  getLogicalBlockTree,
  getUnifiedOutlineRows,
  type LogicalBlockTree
} from "./blockLogicalTree";
import { MAX_BLOCK_NESTING_DEPTH } from "./blockNodeState";

export interface DraggedBlocks {
  keys: NodeKey[];
  originX: number;
  outlineDepth: number;
  outlineHostKey: NodeKey;
  sourceKey: NodeKey;
}

export interface OutlineDropTarget {
  afterKey?: NodeKey;
  beforeKey?: NodeKey;
  depth: number;
  kind: "outline";
  parentKey?: NodeKey;
}

export interface DropIndicator {
  left: number;
  top: number;
  width: number;
}

export function getDropTarget(
  editor: LexicalEditor,
  clientX: number,
  clientY: number,
  draggedBlocks: DraggedBlocks
): OutlineDropTarget | undefined {
  const tree = getLogicalBlockTree(editor);
  return getOutlineDropTarget(editor, tree, clientX, clientY, draggedBlocks);
}

export function getDropIndicator(
  editor: LexicalEditor,
  target: OutlineDropTarget,
  layer: HTMLDivElement | null
): DropIndicator | undefined {
  return getOutlineDropIndicator(editor, getLogicalBlockTree(editor), target, layer);
}

export function getOutlineInsertionIndex(
  rows: readonly OutlineRow<NodeKey>[],
  beforeKey: NodeKey | undefined,
  afterKey: NodeKey | undefined
): number {
  if (beforeKey) {
    return rows.findIndex((row) => row.key === beforeKey);
  }

  if (!afterKey) {
    return rows.length === 0 ? 0 : -1;
  }

  const afterIndex = rows.findIndex((row) => row.key === afterKey);

  if (afterIndex < 0) {
    return -1;
  }

  let insertAt = afterIndex + 1;

  while (insertAt < rows.length && rows[insertAt].depth > rows[afterIndex].depth) {
    insertAt += 1;
  }

  return insertAt;
}

function getOutlineDropTarget(
  editor: LexicalEditor,
  tree: LogicalBlockTree,
  clientX: number,
  clientY: number,
  draggedBlocks: DraggedBlocks
): OutlineDropTarget | undefined {
  const hostKey = draggedBlocks.outlineHostKey;
  const sourceDepth = draggedBlocks.outlineDepth;
  const outlineRows = getUnifiedOutlineRows(tree).filter((row) => {
    const unit = tree.units.get(row.key);
    return unit?.outlineHostKey === hostKey;
  });
  const measuredRows = outlineRows.flatMap(
    (unit): Array<OutlineRow<NodeKey> & { rect: DOMRect }> => {
      const logicalUnit = tree.units.get(unit.key);

      if (!logicalUnit || logicalUnit.outlineDepth === undefined) {
        return [];
      }

      const element = editor.getElementByKey(logicalUnit.rowKey);

      if (!element || element.hidden) {
        return [];
      }

      const rect = getVisualBlockRect(element);
      return rect.height > 0 && rect.width > 0
        ? [{ ...unit, rect }]
        : [];
    }
  );
  const draggedSubtreeKeys = collectOutlineSubtreeKeys(outlineRows, draggedBlocks.keys);
  const remainingRows = outlineRows.filter((row) => !draggedSubtreeKeys.has(row.key));
  const visibleRemainingRows = measuredRows.filter((row) => !draggedSubtreeKeys.has(row.key));
  let insertAt = visibleRemainingRows.length;

  for (let index = 0; index < visibleRemainingRows.length; index += 1) {
    const rect = visibleRemainingRows[index].rect;

    if (clientY < rect.top + rect.height / 2) {
      insertAt = index;
      break;
    }
  }

  const movingRows = outlineRows.filter((row) => draggedSubtreeKeys.has(row.key));
  const maximumMovingDepth = movingRows.reduce(
    (maximum, row) => Math.max(maximum, row.depth),
    sourceDepth
  );
  const maximumRootDepth = MAX_BLOCK_NESTING_DEPTH - (maximumMovingDepth - sourceDepth);
  const indentWidth = getBlockNestingIndentWidth(editor.getRootElement());
  const requestedDepth = Math.min(
    maximumRootDepth,
    sourceDepth + getOutlineDragDepthDelta(clientX - draggedBlocks.originX, indentWidth)
  );
  const insertion = resolveOutlineInsertion(visibleRemainingRows, insertAt, requestedDepth);

  if (!insertion) {
    return undefined;
  }

  const fullInsertAt = getOutlineInsertionIndex(
    remainingRows,
    insertion.beforeKey,
    insertion.afterKey
  );

  if (fullInsertAt < 0) {
    return undefined;
  }

  const depthDelta = insertion.depth - sourceDepth;
  const proposedRows = [
    ...remainingRows.slice(0, fullInsertAt),
    ...movingRows.map((row) => ({ ...row, depth: row.depth + depthDelta })),
    ...remainingRows.slice(fullInsertAt)
  ];
  const isUnchanged = proposedRows.length === outlineRows.length && proposedRows.every(
    (row, index) => row.key === outlineRows[index].key && row.depth === outlineRows[index].depth
  );

  return isUnchanged
    ? undefined
    : {
        afterKey: insertion.afterKey,
        beforeKey: insertion.beforeKey,
        depth: insertion.depth,
        kind: "outline",
        parentKey: insertion.parentKey
      };
}

function getOutlineDropIndicator(
  editor: LexicalEditor,
  tree: LogicalBlockTree,
  target: OutlineDropTarget,
  layer: HTMLDivElement | null
): DropIndicator | undefined {
  const root = editor.getRootElement();

  if (!root || !layer) {
    return undefined;
  }

  const beforeUnit = target.beforeKey ? tree.units.get(target.beforeKey) : undefined;
  const afterUnit = target.afterKey ? tree.units.get(target.afterKey) : undefined;
  const beforeElement = beforeUnit ? editor.getElementByKey(beforeUnit.rowKey) : null;
  const afterElement = afterUnit ? editor.getElementByKey(afterUnit.rowKey) : null;
  const beforeRect = beforeElement ? getVisualBlockRect(beforeElement) : undefined;
  const afterRect = afterElement ? getVisualBlockRect(afterElement) : undefined;
  const rootRect = root.getBoundingClientRect();
  const contentBounds = getEditorContentHorizontalBounds(root, rootRect);
  const overlayRect = layer.getBoundingClientRect();
  const top = beforeRect?.top ?? afterRect?.bottom;

  if (top === undefined) {
    return undefined;
  }

  const indentWidth = getBlockNestingIndentWidth(root);
  const left = Math.min(
    contentBounds.right,
    contentBounds.left + target.depth * indentWidth
  );
  return {
    left: left - overlayRect.left,
    top: top - overlayRect.top - 2,
    width: Math.max(0, contentBounds.right - left)
  };
}
