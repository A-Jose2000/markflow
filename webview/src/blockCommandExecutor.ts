import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getNodeByKey,
  $isTextNode,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey
} from "lexical";

import {
  BLOCK_COMMAND_PLANS,
  type BlockCommandKind,
  type BlockCommandPlan
} from "./blockCommands";
import type {
  BlockCommandMenuState,
  PreparedBlockCommandTargets
} from "./blockCommandTypes";
import { $buildLogicalBlockTree } from "./blockLogicalTree";
import {
  $copyMarkflowBlockMetadata,
  $getMarkflowBlockDepth,
  $setMarkflowBlockDepth,
  $setMarkflowToggleState,
  isMarkflowOutlineCarrier
} from "./blockNodeState";
import {
  $applyOutlineListType,
  $canonicalizeUnifiedOutline,
  $convertOutlineBlocks
} from "./blockOutlineOperations";
import type { MdxEditorModule } from "./editorContract";

export function $prepareBlockCommandTargets(
  menu: BlockCommandMenuState
): PreparedBlockCommandTargets | undefined {
  if (menu.slashMarker) {
    const slashTextNode = $getNodeByKey(menu.slashMarker.textNodeKey);

    if (!$isTextNode(slashTextNode) || slashTextNode.getTextContent()[menu.slashMarker.offset] !== "/") {
      return undefined;
    }

    slashTextNode.spliceText(menu.slashMarker.offset, 1, "");
  }

  if (menu.source === "context") {
    const requestedKeys = menu.targetKeys ?? [menu.targetKey];
    const tree = $buildLogicalBlockTree();
    const targetUnit = tree.units.get(menu.targetKey);
    const targetScope = targetUnit ? tree.scopes.get(targetUnit.scopeKey) : undefined;
    const targetKeys = targetScope
      ? targetScope.units
          .map((unit) => unit.key)
          .filter((key) => requestedKeys.includes(key) && $getNodeByKey(key) !== null)
      : [];

    return targetKeys.length > 0
      ? { targetKey: targetKeys[0], targetKeys }
      : undefined;
  }

  const menuTargetNode = $getNodeByKey(menu.targetKey);

  if (!menuTargetNode) {
    return undefined;
  }

  const targetNode = menu.source === "plus"
    ? $insertParagraphAfterLogicalBlock(menu.targetKey)
    : menuTargetNode;

  if (!targetNode) {
    return undefined;
  }

  $selectNodeStart(targetNode);
  return { targetKey: targetNode.getKey(), targetKeys: [targetNode.getKey()] };
}

export function executeBlockCommand(
  editor: LexicalEditor,
  editorModule: MdxEditorModule,
  command: BlockCommandKind,
  targets: PreparedBlockCommandTargets
): void {
  const plan: BlockCommandPlan = BLOCK_COMMAND_PLANS[command];

  switch (plan.kind) {
    case "element":
      editor.update(() => $convertOutlineBlocks(targets.targetKeys, () => $createCommandElement(plan.element)));
      return;

    case "list":
      editor.update(() => $applyOutlineListType(targets.targetKeys, plan.listType));
      return;

    case "toggle":
      editor.update(() => {
        $canonicalizeUnifiedOutline();

        for (const key of targets.targetKeys) {
          const targetNode = $getNodeByKey(key);

          if (targetNode && isMarkflowOutlineCarrier(targetNode)) {
            $setMarkflowToggleState(targetNode, "open");
          }
        }

        $selectNodeStart($getNodeByKey(targets.targetKey));
      });
      return;

    case "code":
      editor.update(() => {
        $canonicalizeUnifiedOutline();
        let firstCodeBlock: ReturnType<typeof editorModule.$createCodeBlockNode> | undefined;

        for (const key of targets.targetKeys) {
          const targetNode = $getNodeByKey(key);

          if (!targetNode) {
            continue;
          }

          const codeBlock = editorModule.$createCodeBlockNode({
            code: targetNode.getTextContent(),
            language: "txt"
          });
          $copyMarkflowBlockMetadata(targetNode, codeBlock);
          targetNode.replace(codeBlock);
          firstCodeBlock ??= codeBlock;
        }

        firstCodeBlock?.select();
      });
      return;

    case "table":
      editor.update(() => {
        $canonicalizeUnifiedOutline();
        const targetNode = $getNodeByKey(targets.targetKey);

        if (!targetNode) {
          return;
        }

        const rows = Array.from({ length: 3 }, () => ({
          type: "tableRow" as const,
          children: Array.from({ length: 3 }, () => ({ type: "tableCell" as const, children: [] }))
        }));
        const targetDepth = $getMarkflowBlockDepth(targetNode);
        const table = editorModule.$createTableNode({ type: "table", children: rows });
        if (targetNode.getTextContent().length > 0) {
          targetNode.insertAfter(table);
        } else {
          targetNode.replace(table);
        }
        $setMarkflowBlockDepth(table, targetDepth);
        table.select();
      });
      return;

    case "divider":
      editor.update(() => {
        $canonicalizeUnifiedOutline();
        const targetNode = $getNodeByKey(targets.targetKey);

        if (!targetNode) {
          return;
        }

        const targetDepth = $getMarkflowBlockDepth(targetNode);
        const divider = $createHorizontalRuleNode();
        const paragraph = $createParagraphNode();
        if (targetNode.getTextContent().length > 0) {
          targetNode.insertAfter(divider);
        } else {
          targetNode.replace(divider);
        }
        $setMarkflowBlockDepth(divider, targetDepth);
        divider.insertAfter(paragraph);
        $setMarkflowBlockDepth(paragraph, targetDepth);
        paragraph.selectStart();
      });
      return;

    default:
      return assertNever(plan);
  }
}

export function removeEmptyCommandParagraph(editor: LexicalEditor, nodeKey: NodeKey): void {
  editor.update(() => {
    const node = $getNodeByKey(nodeKey);

    if (node?.getType() === "paragraph" && node.getTextContentSize() === 0) {
      node.remove();
    }
  });
}

function $insertParagraphAfterLogicalBlock(targetKey: NodeKey): LexicalNode | null {
  const paragraph = $createParagraphNode();
  const tree = $buildLogicalBlockTree();
  const targetUnit = tree.units.get(targetKey);
  const insertionAnchor = $getNodeByKey(targetUnit?.nodeKeys.at(-1) ?? targetKey);

  if (!insertionAnchor) {
    return null;
  }

  insertionAnchor.insertAfter(paragraph);

  if (targetUnit?.outlineDepth !== undefined) {
    $setMarkflowBlockDepth(paragraph, targetUnit.outlineDepth);
  }
  return paragraph;
}

function $createCommandElement(
  element: Extract<BlockCommandPlan, { kind: "element" }>["element"]
): ElementNode {
  switch (element) {
    case "paragraph":
      return $createParagraphNode();
    case "heading-1":
      return $createHeadingNode("h1");
    case "heading-2":
      return $createHeadingNode("h2");
    case "heading-3":
      return $createHeadingNode("h3");
    case "quote":
      return $createQuoteNode();
    default:
      return assertNever(element);
  }
}

function $selectNodeStart(node: LexicalNode | null): void {
  if (!node) {
    return;
  }

  if ("selectStart" in node && typeof node.selectStart === "function") {
    node.selectStart();
    return;
  }

  if ("select" in node && typeof node.select === "function") {
    node.select();
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported block command plan: ${JSON.stringify(value)}`);
}
