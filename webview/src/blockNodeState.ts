import {
  $isListItemNode,
  $isListNode,
  type ListItemNode
} from "@lexical/list";
import {
  $getState,
  $isElementNode,
  $setState,
  createState,
  type LexicalNode
} from "lexical";

import type {
  MarkflowBlockMetadata,
  MarkflowToggleState
} from "./blockMetadataCodec";

export const MAX_BLOCK_NESTING_DEPTH = 7;

const markflowBlockDepthState = createState("markflowBlockDepth", {
  parse(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(MAX_BLOCK_NESTING_DEPTH, Math.round(value)))
      : null;
  }
});

const markflowToggleState = createState("markflowToggle", {
  parse(value): MarkflowToggleState {
    return value === "open" || value === "closed" ? value : "none";
  }
});

const markflowListStartState = createState("markflowListStart", {
  parse(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? value
      : null;
  }
});

export function isStructuralListItem(node: ListItemNode): boolean {
  return node.getChildrenSize() === 1 && $isListNode(node.getFirstChild());
}

export function isMarkflowOrdinaryOutlineBlock(
  node: LexicalNode | null | undefined
): boolean {
  if (
    !node ||
    node.getType() === "root" ||
    node.isInline() ||
    $isListNode(node) ||
    $isListItemNode(node)
  ) {
    return false;
  }

  const parent = node.getParent();
  return parent === null || (
    $isElementNode(parent) && (parent.getType() === "root" || $isListItemNode(parent))
  );
}

export function isMarkflowOutlineCarrier(
  node: LexicalNode | null | undefined
): boolean {
  return isMarkflowOrdinaryOutlineBlock(node) || Boolean(
    $isListItemNode(node) && !isStructuralListItem(node)
  );
}

export function $getExplicitMarkflowBlockDepth(node: LexicalNode): number | null {
  return isMarkflowOutlineCarrier(node)
    ? $getState(node, markflowBlockDepthState)
    : null;
}

export function $getMarkflowBlockDepth(node: LexicalNode): number {
  if (!isMarkflowOutlineCarrier(node)) {
    return 0;
  }

  const nodeStateDepth = $getExplicitMarkflowBlockDepth(node);

  if (nodeStateDepth !== null) {
    return nodeStateDepth;
  }

  const elementDepth = $isElementNode(node) ? node.getIndent() : 0;
  return Math.max(0, Math.min(MAX_BLOCK_NESTING_DEPTH, elementDepth));
}

export function $setMarkflowBlockDepth(node: LexicalNode, depth: number): void {
  if (!isMarkflowOutlineCarrier(node)) {
    return;
  }

  const normalizedDepth = Math.max(0, Math.min(MAX_BLOCK_NESTING_DEPTH, Math.round(depth)));
  $setState(node, markflowBlockDepthState, normalizedDepth);

  if ($isElementNode(node) && !$isListItemNode(node)) {
    node.setIndent(normalizedDepth);
  }
}

export function $getMarkflowToggleState(node: LexicalNode): MarkflowToggleState {
  return isMarkflowOutlineCarrier(node) ? $getState(node, markflowToggleState) : "none";
}

export function $getExplicitMarkflowListStart(node: LexicalNode): number | null {
  if (!$isListItemNode(node)) {
    return null;
  }

  return $getState(node, markflowListStartState);
}

export function $getMarkflowListStart(node: LexicalNode): number | undefined {
  if (!$isListItemNode(node)) {
    return undefined;
  }

  const list = node.getParent();

  if (!$isListNode(list) || list.getListType() !== "number") {
    return undefined;
  }

  return $getExplicitMarkflowListStart(node) ?? node.getValue();
}

export function $setMarkflowListStart(node: LexicalNode, listStart: number | undefined): void {
  if ($isListItemNode(node)) {
    $setState(node, markflowListStartState, listStart ?? null);
  }
}

export function $setMarkflowToggleState(node: LexicalNode, toggle: MarkflowToggleState): void {
  if (isMarkflowOutlineCarrier(node)) {
    $setState(node, markflowToggleState, toggle);
  }
}

export function $setMarkflowBlockMetadata(
  node: LexicalNode,
  metadata: MarkflowBlockMetadata
): void {
  $setMarkflowBlockDepth(node, metadata.depth);
  $setMarkflowListStart(node, metadata.listStart);
  $setMarkflowToggleState(node, metadata.toggle);
}

export function $copyMarkflowBlockMetadata(
  source: LexicalNode,
  target: LexicalNode
): void {
  if (!isMarkflowOutlineCarrier(source) || !isMarkflowOutlineCarrier(target)) {
    return;
  }

  $setMarkflowBlockMetadata(target, {
    depth: $getMarkflowBlockDepth(source),
    empty: false,
    ...($getMarkflowListStart(source) === undefined
      ? {}
      : { listStart: $getMarkflowListStart(source) }),
    toggle: $getMarkflowToggleState(source)
  });
}

export function $hasMarkflowBlockMetadata(node: LexicalNode): boolean {
  if (!isMarkflowOutlineCarrier(node)) {
    return false;
  }

  const hasToggle = $getMarkflowToggleState(node) !== "none";

  if ($isListItemNode(node)) {
    const explicitDepth = $getExplicitMarkflowBlockDepth(node);
    const explicitListStart = $getExplicitMarkflowListStart(node);
    const hasDistinctListStart =
      $getMarkflowListStart(node) !== undefined &&
      explicitListStart !== null &&
      explicitListStart !== node.getValue();
    return hasToggle || hasDistinctListStart || (explicitDepth !== null && explicitDepth > 0);
  }

  return hasToggle || $getMarkflowBlockDepth(node) > 0;
}

export function $normalizeImportedBlockDepth(
  node: LexicalNode,
  requestedDepth: number
): number {
  const previousCarrier = $getLastOutlineCarrier(node.getPreviousSibling());
  const maximumDepth = previousCarrier
    ? $getMarkflowBlockDepth(previousCarrier) + 1
    : 0;
  return Math.min(Math.max(0, requestedDepth), maximumDepth, MAX_BLOCK_NESTING_DEPTH);
}

function $getLastOutlineCarrier(node: LexicalNode | null): LexicalNode | null {
  if (isMarkflowOutlineCarrier(node)) {
    return node;
  }

  if (!$isListNode(node)) {
    return null;
  }

  let lastCarrier: LexicalNode | null = null;

  for (const child of node.getChildren()) {
    if (!$isListItemNode(child)) {
      continue;
    }

    if (!isStructuralListItem(child)) {
      lastCarrier = child;
    }

    for (const nestedList of child.getChildren().filter($isListNode)) {
      lastCarrier = $getLastOutlineCarrier(nestedList) ?? lastCarrier;
    }
  }

  return lastCarrier;
}
