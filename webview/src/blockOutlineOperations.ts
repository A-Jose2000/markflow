import {
  $createListItemNode,
  $isListItemNode,
  $isListNode,
  type ListType
} from "@lexical/list";
import { $copyBlockFormatIndent } from "@lexical/selection";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $setSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey
} from "lexical";

import {
  getOutlineInsertionIndex,
  type DraggedBlocks,
  type OutlineDropTarget
} from "./blockDragDrop";
import {
  changeOutlineDepth,
  collectOutlineSubtreeKeys,
  type OutlineRow
} from "./blockIndentationModel";
import {
  $buildLogicalBlockTree,
  getUnifiedOutlineRows,
  type LogicalBlockTree,
  type LogicalBlockUnit
} from "./blockLogicalTree";
import {
  $copyMarkflowBlockMetadata,
  $getMarkflowBlockDepth,
  $getMarkflowToggleState,
  $setMarkflowBlockDepth,
  $setMarkflowBlockMetadata,
  MAX_BLOCK_NESTING_DEPTH
} from "./blockNodeState";
import {
  OutlineReconciler,
  type OutlineReconcileRecord
} from "./blockOutlineReconciler";

interface OutlineStyleRecord extends OutlineReconcileRecord {
  toggle: ReturnType<typeof $getMarkflowToggleState>;
}

export function $canonicalizeUnifiedOutline(): LogicalBlockTree {
  return OutlineReconciler.$canonicalize($buildLogicalBlockTree());
}

export function $convertOutlineBlocks(
  requestedKeys: readonly NodeKey[],
  createElement: () => ElementNode
): boolean {
  const tree = $canonicalizeUnifiedOutline();
  const requestedKeySet = new Set(requestedKeys);
  const orderedKeys = getUnifiedOutlineRows(tree)
    .map((row) => row.key)
    .filter((key) => requestedKeySet.has(key));

  if (orderedKeys.length === 0) {
    return false;
  }

  let converted = false;

  for (const key of orderedKeys) {
    const source = $getNodeByKey(key);

    if (!source) {
      continue;
    }

    const target = createElement();

    if ($isElementNode(source)) {
      $copyBlockFormatIndent(source, target);
    }

    $copyMarkflowBlockMetadata(source, target);
    source.replace(target, true);
    converted = true;
  }

  OutlineReconciler.$canonicalize($buildLogicalBlockTree());
  return converted;
}

export function $applyOutlineListType(
  requestedKeys: readonly NodeKey[],
  listType: ListType
): boolean {
  const tree = $canonicalizeUnifiedOutline();
  const requestedKeySet = new Set(requestedKeys);
  const rows = getUnifiedOutlineRows(tree);

  if (!rows.some((row) => requestedKeySet.has(row.key))) {
    return false;
  }

  const records = rows.flatMap((row): OutlineStyleRecord[] => {
    const unit = tree.units.get(row.key);
    const node = $getNodeByKey(row.key);

    if (!unit || !node) {
      return [];
    }

    const selected = requestedKeySet.has(row.key);
    const targetListType = selected ? listType : unit.listType;
    let targetNode = node;

    if (selected && !$isListItemNode(node)) {
      const listItem = $createListItemNode(listType === "check" ? false : undefined);

      if ($isElementNode(node)) {
        listItem.setFormat(node.getFormatType());
        listItem.append(...node.getChildren());
      } else {
        const text = node.getTextContent();
        if (text) {
          listItem.append($createTextNode(text));
        }
      }

      node.remove();
      targetNode = listItem;
    }

    const keepsNumbering = targetListType === "number" && unit.listType === "number";
    const keepsChecked = targetListType === "check" && unit.listType === "check";

    if (
      selected &&
      targetListType === "number" &&
      unit.listType !== "number" &&
      $isListItemNode(targetNode)
    ) {
      targetNode.setValue(1);
    }

    return [{
      checked: targetListType === "check"
        ? keepsChecked && $isListItemNode(node) ? node.getChecked() ?? false : false
        : null,
      depth: row.depth,
      listContainerStart: keepsNumbering ? unit.listStart : 1,
      ...(keepsNumbering && unit.listStart !== undefined ? { listStart: unit.listStart } : {}),
      listType: targetListType,
      node: targetNode,
      toggle: $getMarkflowToggleState(node)
    }];
  });

  if (records.length !== rows.length) {
    return false;
  }

  for (const record of records) {
    $setMarkflowBlockMetadata(record.node, {
      depth: record.depth,
      empty: false,
      ...(record.listStart === undefined ? {} : { listStart: record.listStart }),
      toggle: record.toggle
    });

  }

  if (!OutlineReconciler.$reconcileRecords(records)) {
    return false;
  }

  const normalizedTree = $buildLogicalBlockTree();
  OutlineReconciler.$reconcileRows(normalizedTree, getUnifiedOutlineRows(normalizedTree));
  return true;
}

export function $placeNewOutlineSibling(
  node: LexicalNode,
  sourceLastNodeKey: NodeKey,
  depth: number
): void {
  $setMarkflowBlockDepth(node, depth);
  const tree = $buildLogicalBlockTree();
  const rows = getUnifiedOutlineRows(tree);
  const nodeIndex = rows.findIndex((row) => row.key === node.getKey());

  if (nodeIndex < 0) {
    return;
  }

  const remainingRows = rows.filter((row) => row.key !== node.getKey());
  const sourceLastIndex = remainingRows.findIndex((row) => row.key === sourceLastNodeKey);

  if (sourceLastIndex < 0 || nodeIndex === sourceLastIndex + 1) {
    return;
  }

  OutlineReconciler.$reconcileRows(tree, [
    ...remainingRows.slice(0, sourceLastIndex + 1),
    { depth, key: node.getKey() },
    ...remainingRows.slice(sourceLastIndex + 1)
  ]);
}

export function $changeUnifiedOutlineDepths(
  initialTree: LogicalBlockTree,
  requestedUnits: readonly LogicalBlockUnit[],
  direction: -1 | 1
): boolean {
  const requestedKeys = requestedUnits.map((unit) => unit.key);
  const currentUnits = requestedKeys.flatMap((key) => {
    const unit = initialTree.units.get(key);
    return unit ? [unit] : [];
  });

  if (
    currentUnits.length !== requestedKeys.length ||
    currentUnits.some((unit) => unit.outlineDepth === undefined)
  ) {
    return false;
  }

  const mutation = changeOutlineDepth(
    getUnifiedOutlineRows(initialTree),
    requestedKeys,
    direction,
    MAX_BLOCK_NESTING_DEPTH
  );

  if (!mutation) {
    return false;
  }

  const tree = OutlineReconciler.$canonicalize(initialTree);
  return OutlineReconciler.$reconcileRows(tree, mutation.rows);
}

export function moveLogicalBlocks(
  editor: LexicalEditor,
  draggedBlocks: DraggedBlocks,
  target: OutlineDropTarget
): void {
  editor.update(() => {
    $moveOutlineBlocks($buildLogicalBlockTree(), draggedBlocks, target);
  });
}

export function deleteLogicalBlocks(
  editor: LexicalEditor,
  scopeKey: NodeKey,
  requestedKeys: readonly NodeKey[]
): void {
  editor.update(() => {
    const tree = OutlineReconciler.$canonicalize($buildLogicalBlockTree());
    const scope = tree.scopes.get(scopeKey);

    if (!scope) {
      return;
    }

    const requestedKeySet = new Set(requestedKeys);
    const nodeKeySet = new Set(
      scope.units
        .filter((unit) => requestedKeySet.has(unit.key))
        .flatMap((unit) => unit.nodeKeys)
    );
    const parentKeys = new Set<NodeKey>();

    for (const nodeKey of nodeKeySet) {
      const node = $getNodeByKey(nodeKey);
      const parent = node?.getParent();

      if (node && parent) {
        parentKeys.add(parent.getKey());
        node.remove();
      }
    }

    for (const parentKey of parentKeys) {
      const parent = $getNodeByKey(parentKey);

      if ($isListNode(parent) && parent.getChildrenSize() === 0) {
        const wrapper = parent.getParent();
        parent.remove();

        if ($isListItemNode(wrapper) && wrapper.getChildrenSize() === 0) {
          wrapper.remove();
        }
      }
    }

    const root = $getRoot();

    if (root.getChildrenSize() === 0) {
      root.append($createParagraphNode());
    }

    $setSelection(null);
  });
}

function $moveOutlineBlocks(
  initialTree: LogicalBlockTree,
  draggedBlocks: DraggedBlocks,
  target: OutlineDropTarget
): void {
  const tree = OutlineReconciler.$canonicalize(initialTree);
  const sourceDepth = draggedBlocks.outlineDepth;
  const rows = getUnifiedOutlineRows(tree);
  const draggedSubtreeKeys = collectOutlineSubtreeKeys(rows, draggedBlocks.keys);
  const movingRows = rows.filter((row) => draggedSubtreeKeys.has(row.key));
  const remainingRows = rows.filter((row) => !draggedSubtreeKeys.has(row.key));

  if (movingRows.length === 0 || draggedBlocks.keys.some((key) => !tree.units.has(key))) {
    return;
  }

  const insertAt = getOutlineInsertionIndex(
    remainingRows,
    target.beforeKey,
    target.afterKey
  );

  if (insertAt < 0) {
    return;
  }

  const depthDelta = target.depth - sourceDepth;
  const nextRows = [
    ...remainingRows.slice(0, insertAt),
    ...movingRows.map((row) => ({ ...row, depth: row.depth + depthDelta })),
    ...remainingRows.slice(insertAt)
  ];
  $setSelection(null);
  OutlineReconciler.$reconcileRows(tree, nextRows);
}
