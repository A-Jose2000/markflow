import {
  $getNodeByKey,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type NodeKey
} from "lexical";
import { useEffect, type RefObject } from "react";

import {
  $buildLogicalBlockTree,
  $getLogicalUnitAtSelection,
  $getOutlineUnitAtSelection,
  $getSelectedLogicalUnits,
  $isSelectionAtOutlineUnitStart,
  getNearestOutlineUnit,
  recommitLogicalSelection
} from "./blockLogicalTree";
import {
  $changeUnifiedOutlineDepths,
  deleteLogicalBlocks,
  $placeNewOutlineSibling
} from "./blockOutlineOperations";

interface BlockOutlineKeyboardOptions {
  commitBlockSelection: (scopeKey: NodeKey | undefined, keys: NodeKey[]) => void;
  editor: LexicalEditor;
  isEditable: boolean;
  requestMeasureHandles: () => void;
  rootElement: HTMLElement | undefined;
  selectedBlockCount: number;
  selectedBlockKeysRef: RefObject<NodeKey[]>;
  selectedBlockScopeKeyRef: RefObject<NodeKey | undefined>;
}

export function useBlockOutlineKeyboard({
  commitBlockSelection,
  editor,
  isEditable,
  requestMeasureHandles,
  rootElement,
  selectedBlockCount,
  selectedBlockKeysRef,
  selectedBlockScopeKeyRef
}: BlockOutlineKeyboardOptions): void {
  useEffect(() => {
    if (!rootElement || !isEditable || selectedBlockCount === 0) {
      return;
    }

    const handleSelectedBlockKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete" && event.key !== "Tab") {
        return;
      }

      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("input, textarea, select, .markflow-block-command-menu")
      ) {
        return;
      }

      const scopeKey = selectedBlockScopeKeyRef.current;
      const keys = [...selectedBlockKeysRef.current];

      if (!scopeKey || keys.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Tab") {
        let changed = false;

        editor.update(() => {
          const tree = $buildLogicalBlockTree();
          const units = $getSelectedLogicalUnits(tree, scopeKey, keys);
          changed = $changeUnifiedOutlineDepths(tree, units, event.shiftKey ? -1 : 1);
        }, {
          onUpdate: () => {
            if (changed) {
              recommitLogicalSelection(editor, keys, commitBlockSelection);
            }
            requestMeasureHandles();
          }
        });
        return;
      }

      deleteLogicalBlocks(editor, scopeKey, keys);
      commitBlockSelection(undefined, []);
      requestMeasureHandles();
    };

    document.addEventListener("keydown", handleSelectedBlockKeyDown, true);
    return () => document.removeEventListener("keydown", handleSelectedBlockKeyDown, true);
  }, [
    commitBlockSelection,
    editor,
    isEditable,
    requestMeasureHandles,
    rootElement,
    selectedBlockCount,
    selectedBlockKeysRef,
    selectedBlockScopeKeyRef
  ]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (!editor.isEditable() || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
          return false;
        }

        const tree = $buildLogicalBlockTree();
        const selectedUnits = $getSelectedLogicalUnits(
          tree,
          selectedBlockScopeKeyRef.current,
          selectedBlockKeysRef.current
        );
        const currentLogicalUnit = selectedUnits.length === 0 ? $getLogicalUnitAtSelection(tree) : undefined;
        const currentUnit = currentLogicalUnit
          ? getNearestOutlineUnit(tree, currentLogicalUnit)
          : undefined;
        const selectedOutlineUnits = selectedUnits.length > 0 && selectedUnits.every(
          (unit) => unit.outlineDepth !== undefined
        )
          ? selectedUnits
          : [];
        const outlineUnits = selectedOutlineUnits.length > 0
          ? selectedOutlineUnits
          : currentUnit
            ? [currentUnit]
            : [];
        const preserveBlockSelection = selectedUnits.length > 0;

        if (event.key === "Tab") {
          if (outlineUnits.length === 0) {
            if (selectedUnits.length > 0) {
              event.preventDefault();
              return true;
            }

            return false;
          }

          const currentNode = outlineUnits.length === 1 ? $getNodeByKey(outlineUnits[0].key) : null;

          if (!preserveBlockSelection && currentNode?.getType() === "table") {
            return false;
          }

          const changed = $changeUnifiedOutlineDepths(tree, outlineUnits, event.shiftKey ? -1 : 1);

          if (!changed) {
            event.preventDefault();
            return true;
          }

          event.preventDefault();
          const changedKeys = outlineUnits.map((unit) => unit.key);
          window.requestAnimationFrame(() => {
            if (preserveBlockSelection) {
              recommitLogicalSelection(editor, changedKeys, commitBlockSelection);
            }
            requestMeasureHandles();
          });
          return true;
        }

        if (
          event.key === "Backspace" &&
          outlineUnits.length === 1 &&
          (outlineUnits[0].outlineDepth ?? 0) > 0 &&
          $isSelectionAtOutlineUnitStart(outlineUnits[0]) &&
          $changeUnifiedOutlineDepths(tree, outlineUnits, -1)
        ) {
          event.preventDefault();
          const changedKey = outlineUnits[0].key;
          window.requestAnimationFrame(() => {
            if (preserveBlockSelection) {
              recommitLogicalSelection(editor, [changedKey], commitBlockSelection);
            }
            requestMeasureHandles();
          });
          return true;
        }

        if (event.key !== "Enter" || event.shiftKey || outlineUnits.length !== 1) {
          return false;
        }

        const sourceUnit = outlineUnits[0];

        if (
          sourceUnit.outlineDepth === undefined ||
          (sourceUnit.kind !== "block" && sourceUnit.kind !== "list-item")
        ) {
          return false;
        }

        const sourceKey = sourceUnit.key;
        const sourceKind = sourceUnit.kind;
        const sourceLastNodeKey = sourceUnit.nodeKeys.at(-1) ?? sourceKey;
        const sourceDepth = sourceUnit.outlineDepth;
        const sourceHostKey = sourceUnit.outlineHostKey;

        window.setTimeout(() => {
          editor.update(() => {
            const nextTree = $buildLogicalBlockTree();
            const nextUnit = $getOutlineUnitAtSelection(nextTree);

            if (
              !nextUnit ||
              nextUnit.key === sourceKey ||
              nextUnit.outlineHostKey !== sourceHostKey ||
              nextUnit.kind !== sourceKind
            ) {
              return;
            }

            const nextNode = $getNodeByKey(nextUnit.key);

            if (nextNode) {
              $placeNewOutlineSibling(nextNode, sourceLastNodeKey, sourceDepth);
            }
          }, { onUpdate: requestMeasureHandles });
        });
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [
    commitBlockSelection,
    editor,
    requestMeasureHandles,
    selectedBlockKeysRef,
    selectedBlockScopeKeyRef
  ]);
}
