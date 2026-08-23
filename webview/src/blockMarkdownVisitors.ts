import {
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode
} from "@lexical/list";
import type {
  LexicalExportVisitor,
  MdastImportVisitor
} from "@mdxeditor/editor";
import type {
  Definition,
  List as MdastList,
  ListItem as MdastListItem,
  Nodes as MdastNode
} from "mdast";
import {
  $createParagraphNode,
  $isElementNode,
  $isParagraphNode,
  type LexicalNode
} from "lexical";

import {
  createMarkflowMetadataDefinition,
  readMarkflowBlockMetadata,
  readMarkflowBlockMarker,
  type MarkflowBlockMetadata
} from "./blockMetadataCodec";
import {
  $getExplicitMarkflowListStart,
  $getMarkflowBlockDepth,
  $getMarkflowListStart,
  $getMarkflowToggleState,
  $hasMarkflowBlockMetadata,
  $normalizeImportedBlockDepth,
  $setMarkflowBlockMetadata,
  $setMarkflowListStart,
  isMarkflowOrdinaryOutlineBlock,
  isStructuralListItem,
  MAX_BLOCK_NESTING_DEPTH
} from "./blockNodeState";

export function createBlockMarkdownVisitors() {
  const importedMetadata = new WeakMap<object, MarkflowBlockMetadata>();
  const blockMarkerImportVisitor: MdastImportVisitor<Definition> = {
    priority: 200,
    testNode: (mdastNode): mdastNode is Definition =>
      mdastNode.type === "definition" &&
      (readMarkflowBlockMetadata(mdastNode, MAX_BLOCK_NESTING_DEPTH) !== undefined ||
        readMarkflowBlockMarker(mdastNode, MAX_BLOCK_NESTING_DEPTH) !== undefined),
    visitNode({ actions, lexicalParent, mdastNode, mdastParent }) {
      const metadata = readMarkflowBlockMetadata(mdastNode, MAX_BLOCK_NESTING_DEPTH);
      const marker = readMarkflowBlockMarker(mdastNode, MAX_BLOCK_NESTING_DEPTH);

      if (!metadata && !marker) {
        return;
      }

      const blockMetadata: MarkflowBlockMetadata = metadata ?? {
        depth: marker?.depth ?? 0,
        empty: marker?.kind === "empty",
        toggle: "none"
      };

      if ($isListItemNode(lexicalParent)) {
        $setMarkflowBlockMetadata(lexicalParent, blockMetadata);
        return;
      }

      const siblings = mdastParent?.children;
      const definitionIndex = siblings?.indexOf(mdastNode as never) ?? -1;
      const target = definitionIndex >= 0 ? siblings?.[definitionIndex + 1] : undefined;

      if (!blockMetadata.empty) {
        if (target) {
          importedMetadata.set(target, blockMetadata);
        }
        return;
      }

      const isSyntheticTrailingParagraph =
        target?.type === "paragraph" &&
        target.children.length === 0 &&
        target.position === undefined &&
        siblings?.at(-1) === target;

      if (isSyntheticTrailingParagraph) {
        importedMetadata.set(target, blockMetadata);
        return;
      }

      if ($isElementNode(lexicalParent)) {
        const emptyBlock = $createParagraphNode();
        actions.addAndStepInto(emptyBlock);
        $setMarkflowBlockMetadata(emptyBlock, {
          ...blockMetadata,
          depth: $normalizeImportedBlockDepth(emptyBlock, blockMetadata.depth)
        });
      }
    }
  };
  const metadataTargetImportVisitor: MdastImportVisitor<MdastNode> = {
    priority: 100,
    testNode: (mdastNode) => importedMetadata.has(mdastNode),
    visitNode({ actions, lexicalParent, mdastNode }) {
      const previousChildKeys = $isElementNode(lexicalParent)
        ? new Set(lexicalParent.getChildrenKeys())
        : undefined;
      actions.nextVisitor();
      const importedBlock = previousChildKeys && $isElementNode(lexicalParent)
        ? lexicalParent.getChildren().find((child) => !previousChildKeys.has(child.getKey()))
        : undefined;
      const metadata = importedMetadata.get(mdastNode);

      if (importedBlock && metadata) {
        $setMarkflowBlockMetadata(importedBlock, {
          ...metadata,
          depth: $normalizeImportedBlockDepth(importedBlock, metadata.depth)
        });
      }

      importedMetadata.delete(mdastNode);
    }
  };
  const orderedListItemImportVisitor: MdastImportVisitor<MdastListItem> = {
    priority: 100,
    testNode: (mdastNode): mdastNode is MdastListItem => mdastNode.type === "listItem",
    visitNode({ actions, lexicalParent, mdastNode, mdastParent }) {
      const previousChildKeys = $isElementNode(lexicalParent)
        ? new Set(lexicalParent.getChildrenKeys())
        : undefined;
      actions.nextVisitor();

      if (
        !previousChildKeys ||
        !$isElementNode(lexicalParent) ||
        !isMdastList(mdastParent) ||
        !mdastParent.ordered
      ) {
        return;
      }

      const itemIndex = mdastParent.children.indexOf(mdastNode);
      const importedListItem = lexicalParent
        .getChildren()
        .find((child) => !previousChildKeys.has(child.getKey()));

      if (
        itemIndex >= 0 &&
        $isListItemNode(importedListItem) &&
        $getExplicitMarkflowListStart(importedListItem) === null
      ) {
        $setMarkflowListStart(importedListItem, (mdastParent.start ?? 1) + itemIndex);
      }
    }
  };
  const metadataDefinitionExportVisitor: LexicalExportVisitor<LexicalNode, Definition> = {
    priority: 100,
    testLexicalNode: (lexicalNode): lexicalNode is LexicalNode =>
      isMarkflowOrdinaryOutlineBlock(lexicalNode) && $hasMarkflowBlockMetadata(lexicalNode),
    visitLexicalNode({ actions, lexicalNode, mdastParent }) {
      const depth = $getMarkflowBlockDepth(lexicalNode);
      const isEmptyParagraph = $isParagraphNode(lexicalNode) && lexicalNode.getChildrenSize() === 0;
      actions.appendToParent(
        mdastParent,
        createMarkflowMetadataDefinition({
          depth,
          empty: isEmptyParagraph,
          toggle: $getMarkflowToggleState(lexicalNode)
        })
      );

      if (!isEmptyParagraph) {
        actions.nextVisitor();
      }
    }
  };
  const listItemMetadataExportVisitor: LexicalExportVisitor<ListItemNode, MdastListItem> = {
    priority: 100,
    testLexicalNode: (lexicalNode): lexicalNode is ListItemNode =>
      $isListItemNode(lexicalNode) &&
      !isStructuralListItem(lexicalNode) &&
      $hasMarkflowBlockMetadata(lexicalNode),
    visitLexicalNode({ actions, lexicalNode, mdastParent }) {
      const previousChildrenSize = mdastParent.children.length;
      actions.nextVisitor();
      const listItem = mdastParent.children
        .slice(previousChildrenSize)
        .find((child): child is MdastListItem => child.type === "listItem");

      if (!listItem) {
        return;
      }

      const listStart = $getMarkflowListStart(lexicalNode) === undefined
        ? null
        : $getExplicitMarkflowListStart(lexicalNode);
      const canUseMarkdownListStart =
        listStart !== null &&
        lexicalNode.getPreviousSibling() === null &&
        isMdastList(mdastParent) &&
        mdastParent.ordered;

      if (canUseMarkdownListStart) {
        mdastParent.start = listStart;
        mdastParent.spread = true;
      }

      listItem.children.unshift(createMarkflowMetadataDefinition({
        depth: $getMarkflowBlockDepth(lexicalNode),
        empty: false,
        ...(listStart === null ? {} : { listStart }),
        toggle: $getMarkflowToggleState(lexicalNode)
      }));
    }
  };
  const listSpreadExportVisitor: LexicalExportVisitor<ListNode, MdastList> = {
    priority: 100,
    testLexicalNode: (lexicalNode): lexicalNode is ListNode => $isListNode(lexicalNode),
    visitLexicalNode({ actions, mdastParent }) {
      const previousChildrenSize = mdastParent.children.length;
      actions.nextVisitor();
      const list = mdastParent.children
        .slice(previousChildrenSize)
        .find((child): child is MdastList => child.type === "list");

      if (list?.spread && isMdastListItem(mdastParent)) {
        mdastParent.spread = true;
      }
    }
  };

  return {
    exportVisitors: [
      metadataDefinitionExportVisitor,
      listItemMetadataExportVisitor,
      listSpreadExportVisitor
    ],
    importVisitors: [
      blockMarkerImportVisitor,
      metadataTargetImportVisitor,
      orderedListItemImportVisitor
    ]
  };
}

function isMdastList(node: unknown): node is MdastList {
  return Boolean(node && typeof node === "object" && "type" in node && node.type === "list");
}

function isMdastListItem(node: unknown): node is MdastListItem {
  return Boolean(node && typeof node === "object" && "type" in node && node.type === "listItem");
}
