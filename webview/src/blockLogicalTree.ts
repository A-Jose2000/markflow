import {
  $isListItemNode,
  $isListNode,
  type ListType
} from "@lexical/list";
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey
} from "lexical";

import {
  $getExplicitMarkflowBlockDepth,
  $getMarkflowBlockDepth,
  $getMarkflowListStart,
  $getMarkflowToggleState,
  isMarkflowOrdinaryOutlineBlock,
  isStructuralListItem
} from "./blockNodeState";
import type { HierarchySelectionModel } from "./blockSelectionModel";
import type { OutlineRow } from "./blockIndentationModel";
import {
  resolveOutlineNumberMarkers,
  type OutlineNumberingRow
} from "./outlineNumberingModel";
import type { MarkflowToggleState } from "./blockMetadataCodec";

export interface BlockUnit {
  key: NodeKey;
  nodeKeys: NodeKey[];
}

export interface LogicalBlockUnit extends BlockUnit {
  depth: number;
  outlineDepth?: number;
  outlineHostKey?: NodeKey;
  outlinePhysicalDepth?: number;
  outlineUsesElementIndent?: boolean;
  kind: "block" | "list-item";
  listStart?: number;
  listType?: ListType;
  physicalParentKey: NodeKey;
  rowKey: NodeKey;
  scopeKey: NodeKey;
  toggle: MarkflowToggleState;
}

export interface LogicalBlockScope {
  key: NodeKey;
  parentUnitKey?: NodeKey;
  unitKeys: NodeKey[];
  units: LogicalBlockUnit[];
  virtualOutline?: boolean;
}

export interface LogicalBlockTree extends HierarchySelectionModel {
  rootScopeKey: NodeKey;
  scopes: Map<NodeKey, LogicalBlockScope>;
  units: Map<NodeKey, LogicalBlockUnit>;
}

interface UnifiedOutlineCarrier {
  kind: "block" | "list-item";
  listStart?: number;
  listType?: ListType;
  node: LexicalNode;
  physicalDepth: number;
  requestedDepth: number;
}

export function getLogicalBlockTree(editor: LexicalEditor): LogicalBlockTree {
  let tree: LogicalBlockTree | undefined;

  editor.getEditorState().read(() => {
    tree = $buildLogicalBlockTree();
  });

  if (!tree) {
    throw new Error("The logical block tree could not be read.");
  }

  return tree;
}

export function $buildLogicalBlockTree(): LogicalBlockTree {
  const root = $getRoot();
  const scopes = new Map<NodeKey, LogicalBlockScope>();
  const units = new Map<NodeKey, LogicalBlockUnit>();
  const rootScope: LogicalBlockScope = {
    key: root.getKey(),
    unitKeys: [],
    units: []
  };
  scopes.set(rootScope.key, rootScope);
  const outlineStack: LogicalBlockUnit[] = [];

  for (const carrier of $collectUnifiedOutlineCarriers(root)) {
    const outlineDepth = Math.min(carrier.requestedDepth, outlineStack.length);
    const parentUnit = outlineDepth > 0 ? outlineStack[outlineDepth - 1] : undefined;
    const targetScope = parentUnit
      ? $getOrCreateVirtualOutlineScope(parentUnit, scopes)
      : rootScope;
    const unit: LogicalBlockUnit = {
      depth: outlineDepth,
      key: carrier.node.getKey(),
      kind: carrier.kind,
      listStart: carrier.listStart,
      listType: carrier.listType,
      nodeKeys: [carrier.node.getKey()],
      outlineDepth,
      outlineHostKey: root.getKey(),
      outlinePhysicalDepth: carrier.physicalDepth,
      outlineUsesElementIndent: carrier.kind !== "list-item" && $isElementNode(carrier.node),
      physicalParentKey: carrier.node.getParent()?.getKey() ?? root.getKey(),
      rowKey: carrier.node.getKey(),
      scopeKey: targetScope.key,
      toggle: $getMarkflowToggleState(carrier.node)
    };
    targetScope.units.push(unit);
    targetScope.unitKeys = targetScope.units.map((scopeUnit) => scopeUnit.key);
    units.set(unit.key, unit);
    outlineStack.length = outlineDepth;
    outlineStack[outlineDepth] = unit;
  }

  const tree = { rootScopeKey: root.getKey(), scopes, units };
  $expandVirtualOutlineNodeKeys(tree, tree.rootScopeKey);
  return tree;
}

export function getUnifiedOutlineRows(tree: LogicalBlockTree): OutlineRow<NodeKey>[] {
  return Array.from(tree.units.values()).map((unit) => ({
    depth: unit.outlineDepth ?? 0,
    key: unit.key
  }));
}

export function getUnifiedOutlineNumberMarkers(
  tree: LogicalBlockTree,
  rows: readonly OutlineRow<NodeKey>[] = getUnifiedOutlineRows(tree)
): Map<NodeKey, number> {
  return resolveOutlineNumberMarkers(
    getUnifiedOutlineNumberingRows(tree),
    getUnifiedOutlineNumberingRows(tree, rows)
  );
}

export function $getLogicalUnitAtSelection(
  tree: LogicalBlockTree
): LogicalBlockUnit | undefined {
  const selection = $getSelection();
  const selectedNodes = $isRangeSelection(selection)
    ? [selection.anchor.getNode()]
    : $isNodeSelection(selection)
      ? selection.getNodes()
      : [];

  for (const selectedNode of selectedNodes) {
    let node: LexicalNode | null = selectedNode;

    while (node) {
      const unit = tree.units.get(node.getKey());

      if (unit) {
        return unit;
      }

      node = node.getParent();
    }
  }

  return undefined;
}

export function $getOutlineUnitAtSelection(
  tree: LogicalBlockTree
): LogicalBlockUnit | undefined {
  const unit = $getLogicalUnitAtSelection(tree);
  return unit ? getNearestOutlineUnit(tree, unit) : undefined;
}

export function getNearestOutlineUnit(
  tree: LogicalBlockTree,
  startingUnit: LogicalBlockUnit
): LogicalBlockUnit | undefined {
  let unit: LogicalBlockUnit | undefined = startingUnit;

  while (unit) {
    const parentUnitKey: NodeKey | undefined = tree.scopes.get(unit.scopeKey)?.parentUnitKey;
    const parentUnit: LogicalBlockUnit | undefined = parentUnitKey
      ? tree.units.get(parentUnitKey)
      : undefined;

    if (unit.outlineDepth !== undefined) {
      return unit;
    }

    unit = parentUnit;
  }

  return undefined;
}

export function $getSelectedLogicalUnits(
  tree: LogicalBlockTree,
  scopeKey: NodeKey | undefined,
  selectedKeys: readonly NodeKey[]
): LogicalBlockUnit[] {
  const scope = scopeKey ? tree.scopes.get(scopeKey) : undefined;

  if (!scope || selectedKeys.length === 0) {
    return [];
  }

  return scope.units.filter((unit) => selectedKeys.includes(unit.key));
}

export function $isSelectionAtOutlineUnitStart(unit: LogicalBlockUnit): boolean {
  const selection = $getSelection();

  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.offset !== 0) {
    return false;
  }

  const block = $getNodeByKey(unit.key);
  const anchorNode = selection.anchor.getNode();

  if (!block) {
    return false;
  }

  const firstDescendant = $isElementNode(block) ? block.getFirstDescendant() : null;
  return anchorNode.is(block) || Boolean(firstDescendant && anchorNode.is(firstDescendant));
}

export function recommitLogicalSelection(
  editor: LexicalEditor,
  keys: readonly NodeKey[],
  commit: (scopeKey: NodeKey | undefined, nextKeys: NodeKey[]) => void
): void {
  const tree = getLogicalBlockTree(editor);
  const firstUnit = keys.flatMap((key) => {
    const unit = tree.units.get(key);
    return unit ? [unit] : [];
  })[0];
  const scope = firstUnit ? tree.scopes.get(firstUnit.scopeKey) : undefined;
  const selectedKeys = scope
    ? scope.units.map((unit) => unit.key).filter((key) => keys.includes(key))
    : [];
  commit(scope?.key, selectedKeys);
}

function $collectUnifiedOutlineCarriers(root: LexicalNode): UnifiedOutlineCarrier[] {
  if (!$isElementNode(root)) {
    return [];
  }

  const carriers: UnifiedOutlineCarrier[] = [];

  for (const node of root.getChildren()) {
    if ($isListNode(node)) {
      $collectUnifiedListCarriers(node, 0, carriers);
      continue;
    }

    if (isMarkflowOrdinaryOutlineBlock(node)) {
      carriers.push({
        kind: "block",
        node,
        physicalDepth: 0,
        requestedDepth: $getMarkflowBlockDepth(node)
      });
    }
  }

  return carriers;
}

function $collectUnifiedListCarriers(
  list: LexicalNode,
  physicalDepth: number,
  carriers: UnifiedOutlineCarrier[]
): void {
  if (!$isListNode(list)) {
    return;
  }

  for (const child of list.getChildren()) {
    if (!$isListItemNode(child)) {
      continue;
    }

    if (!isStructuralListItem(child)) {
      carriers.push({
        kind: "list-item",
        listStart: $getMarkflowListStart(child) ?? child.getValue(),
        listType: list.getListType(),
        node: child,
        physicalDepth,
        requestedDepth: $getExplicitMarkflowBlockDepth(child) ?? physicalDepth
      });
    }

    for (const nestedChild of child.getChildren()) {
      if ($isListNode(nestedChild)) {
        $collectUnifiedListCarriers(nestedChild, physicalDepth + 1, carriers);
        continue;
      }

      if (isMarkflowOrdinaryOutlineBlock(nestedChild)) {
        carriers.push({
          kind: "block",
          node: nestedChild,
          physicalDepth: physicalDepth + 1,
          requestedDepth:
            $getExplicitMarkflowBlockDepth(nestedChild) ?? physicalDepth + 1
        });
      }
    }
  }
}

function getUnifiedOutlineNumberingRows(
  tree: LogicalBlockTree,
  rows: readonly OutlineRow<NodeKey>[] = getUnifiedOutlineRows(tree)
): OutlineNumberingRow<NodeKey>[] {
  return rows.map((row) => {
    const unit = tree.units.get(row.key);
    return {
      ...row,
      kind: unit?.kind === "list-item" && unit.listType === "number" ? "ordered" : "other",
      ...(unit?.listStart === undefined ? {} : { preferredStart: unit.listStart })
    };
  });
}

function $getOrCreateVirtualOutlineScope(
  parentUnit: LogicalBlockUnit,
  scopes: Map<NodeKey, LogicalBlockScope>
): LogicalBlockScope {
  const existing = scopes.get(parentUnit.key);

  if (existing) {
    return existing;
  }

  const scope: LogicalBlockScope = {
    key: parentUnit.key,
    parentUnitKey: parentUnit.key,
    unitKeys: [],
    units: [],
    virtualOutline: true
  };
  scopes.set(scope.key, scope);
  return scope;
}

function $expandVirtualOutlineNodeKeys(tree: LogicalBlockTree, scopeKey: NodeKey): void {
  const scope = tree.scopes.get(scopeKey);

  if (!scope) {
    return;
  }

  for (const unit of scope.units) {
    const childScope = tree.scopes.get(unit.key);

    if (!childScope) {
      continue;
    }

    $expandVirtualOutlineNodeKeys(tree, childScope.key);

    if (childScope.virtualOutline) {
      unit.nodeKeys = [
        ...unit.nodeKeys,
        ...childScope.units.flatMap((child) => child.nodeKeys)
      ];
    }
  }
}
