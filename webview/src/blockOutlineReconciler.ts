import {
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListType
} from "@lexical/list";
import {
  $getNodeByKey,
  $getRoot,
  type LexicalNode,
  type NodeKey
} from "lexical";

import type { OutlineRow } from "./blockIndentationModel";
import {
  $buildLogicalBlockTree,
  getUnifiedOutlineNumberMarkers,
  getUnifiedOutlineRows,
  type LogicalBlockTree
} from "./blockLogicalTree";
import {
  $getExplicitMarkflowBlockDepth,
  $setMarkflowBlockDepth,
  $setMarkflowListStart
} from "./blockNodeState";

export interface OutlineReconcileRecord {
  checked?: boolean | null;
  depth: number;
  listContainerStart?: number;
  listStart?: number;
  listType?: ListType;
  node: LexicalNode;
}

interface OutlineReconcilerApi {
  $canonicalize: (tree: LogicalBlockTree) => LogicalBlockTree;
  $reconcileRecords: (records: readonly OutlineReconcileRecord[]) => boolean;
  $reconcileRows: (
    tree: LogicalBlockTree,
    orderedRows: readonly OutlineRow<NodeKey>[]
  ) => boolean;
}

export const OutlineReconciler: OutlineReconcilerApi = {
  $canonicalize(tree) {
    if ($isCanonical(tree)) {
      return tree;
    }

    if (!OutlineReconciler.$reconcileRows(tree, getUnifiedOutlineRows(tree))) {
      return tree;
    }
    return $buildLogicalBlockTree();
  },

  $reconcileRows(tree, orderedRows) {
    const rowKeySet = new Set(orderedRows.map((row) => row.key));

    if (
      orderedRows.length !== tree.units.size ||
      rowKeySet.size !== orderedRows.length ||
      Array.from(tree.units.keys()).some((key) => !rowKeySet.has(key))
    ) {
      return false;
    }

    const listMarkers = getUnifiedOutlineNumberMarkers(tree, orderedRows);
    const records = orderedRows.flatMap((row): OutlineReconcileRecord[] => {
      const unit = tree.units.get(row.key);
      const node = $getNodeByKey(row.key);

      return unit && node ? [{
        depth: row.depth,
        listContainerStart: unit.listStart ?? ($isListItemNode(node) ? node.getValue() : undefined),
        listStart: listMarkers.get(row.key),
        listType: unit.listType,
        node
      }] : [];
    });

    return records.length === orderedRows.length && OutlineReconciler.$reconcileRecords(records);
  },

  $reconcileRecords(records) {
    const root = $getRoot();
    const recordKeys = records.map((record) => record.node.getKey());

    if (new Set(recordKeys).size !== recordKeys.length) {
      return false;
    }

    const oldLists = new Set<ReturnType<typeof $createListNode>>();

    for (const child of root.getChildren()) {
      if ($isListNode(child)) {
        $collectListNodes(child, oldLists);
      }
    }

    for (const record of records) {
      if (!$isListItemNode(record.node)) {
        continue;
      }

      for (const nestedList of record.node.getChildren().filter($isListNode)) {
        nestedList.remove();
      }
    }

    let currentList: ReturnType<typeof $createListNode> | undefined;

    for (const record of records) {
      $setMarkflowBlockDepth(record.node, record.depth);
      $setMarkflowListStart(record.node, record.listStart);

      if ($isListItemNode(record.node) && record.listType) {
        if (!currentList || currentList.getListType() !== record.listType) {
          currentList = $createListNode(
            record.listType,
            Math.max(1, record.listContainerStart ?? record.listStart ?? record.node.getValue())
          );
          root.append(currentList);
        }

        currentList.append(record.node);
        if (record.checked !== undefined) {
          record.node.setChecked(record.checked ?? undefined);
        }
        continue;
      }

      currentList = undefined;
      root.append(record.node);
    }

    for (const list of oldLists) {
      if (list.isAttached()) {
        list.remove();
      }
    }

    return true;
  }
};

function $isCanonical(tree: LogicalBlockTree): boolean {
  const root = $getRoot();

  for (const unit of tree.units.values()) {
    const node = $getNodeByKey(unit.key);

    if (!node) {
      return false;
    }

    if (unit.kind !== "list-item") {
      if (!node.getParent()?.is(root)) {
        return false;
      }
      continue;
    }

    const list = node.getParent();

    if (
      !$isListItemNode(node) ||
      !$isListNode(list) ||
      !list.getParent()?.is(root) ||
      node.getChildren().some($isListNode) ||
      $getExplicitMarkflowBlockDepth(node) === null
    ) {
      return false;
    }
  }

  return true;
}

function $collectListNodes(
  list: ReturnType<typeof $createListNode>,
  lists: Set<ReturnType<typeof $createListNode>>
): void {
  lists.add(list);

  for (const item of list.getChildren().filter($isListItemNode)) {
    for (const nestedList of item.getChildren().filter($isListNode)) {
      $collectListNodes(nestedList, lists);
    }
  }
}
