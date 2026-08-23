import {
  $createListItemNode,
  $isListItemNode
} from "@lexical/list";
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey
} from "lexical";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject
} from "react";

import {
  $prepareBlockCommandTargets,
  executeBlockCommand,
  removeEmptyCommandParagraph
} from "./blockCommandExecutor";
import {
  filterBlockCommands,
  type BlockCommand
} from "./blockCommands";
import type {
  BlockCommandMenuState,
  PreparedBlockCommandTargets,
  SlashMarker
} from "./blockCommandTypes";
import {
  clampMenuLeft,
  getBrowserCaretRect,
  getMenuTop
} from "./blockGeometry";
import {
  $buildLogicalBlockTree,
  getLogicalBlockTree
} from "./blockLogicalTree";
import { $placeNewOutlineSibling } from "./blockOutlineOperations";
import type { MdxEditorModule } from "./editorContract";

interface BlockCommandMenuControllerOptions {
  commitBlockSelection: (scopeKey: NodeKey | undefined, keys: NodeKey[]) => void;
  editor: LexicalEditor;
  editorModule: MdxEditorModule;
  isEditable: boolean;
  layerRef: RefObject<HTMLDivElement | null>;
  selectedBlockKeysRef: RefObject<NodeKey[]>;
}

export interface BlockCommandMenuController {
  activeCommandIndex: number;
  applyBlockCommand: (command: BlockCommand) => void;
  commandMenu: BlockCommandMenuState | undefined;
  commandQuery: string;
  filteredCommands: readonly BlockCommand[];
  handleMenuKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  menuInputRef: RefObject<HTMLInputElement | null>;
  menuRef: RefObject<HTMLElement | null>;
  openMenuAfterBlock: (blockKey: NodeKey) => void;
  openTurnIntoMenu: (event: ReactMouseEvent<HTMLButtonElement>, blockKey: NodeKey) => void;
  setActiveCommandIndex: (index: number) => void;
  updateCommandQuery: (query: string) => void;
}

export function useBlockCommandMenuController({
  commitBlockSelection,
  editor,
  editorModule,
  isEditable,
  layerRef,
  selectedBlockKeysRef
}: BlockCommandMenuControllerOptions): BlockCommandMenuController {
  const menuRef = useRef<HTMLElement | null>(null);
  const menuInputRef = useRef<HTMLInputElement | null>(null);
  const commandMenuRef = useRef<BlockCommandMenuState | undefined>(undefined);
  const ignoredSlashMarkerRef = useRef<SlashMarker | undefined>(undefined);
  const [commandMenu, setCommandMenu] = useState<BlockCommandMenuState | undefined>();
  const [commandQuery, setCommandQuery] = useState("");
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const filteredCommands = useMemo(
    () => filterBlockCommands(commandQuery, commandMenu?.source === "context"),
    [commandMenu?.source, commandQuery]
  );

  const resetCommandMenu = useCallback(() => {
    commandMenuRef.current = undefined;
    ignoredSlashMarkerRef.current = undefined;
    setCommandMenu(undefined);
    setCommandQuery("");
    setActiveCommandIndex(0);
  }, []);

  useEffect(() => {
    if (!isEditable) {
      resetCommandMenu();
    }
  }, [isEditable, resetCommandMenu]);

  const closeCommandMenu = useCallback(
    (options: { insertSpace?: boolean; removeSlash?: boolean; restoreFocus?: boolean } = {}) => {
      const menu = commandMenu;
      commandMenuRef.current = undefined;

      if (menu?.slashMarker) {
        ignoredSlashMarkerRef.current = menu.slashMarker;
      }

      setCommandMenu(undefined);
      setCommandQuery("");
      setActiveCommandIndex(0);

      if (!menu || (!options.insertSpace && !options.removeSlash && !options.restoreFocus)) {
        return;
      }

      editor.update(
        () => {
          if (options.removeSlash && menu.slashMarker) {
            const textNode = $getNodeByKey(menu.slashMarker.textNodeKey);

            if ($isTextNode(textNode) && textNode.getTextContent()[menu.slashMarker.offset] === "/") {
              textNode.spliceText(menu.slashMarker.offset, 1, "");
              textNode.select(menu.slashMarker.offset, menu.slashMarker.offset);
              return;
            }
          }

          if (options.insertSpace && menu.slashMarker) {
            const textNode = $getNodeByKey(menu.slashMarker.textNodeKey);

            if ($isTextNode(textNode)) {
              const insertionOffset = Math.min(menu.slashMarker.offset + 1, textNode.getTextContentSize());
              textNode.spliceText(insertionOffset, 0, " ");
              textNode.select(insertionOffset + 1, insertionOffset + 1);
              return;
            }
          }

          if (menu.slashMarker) {
            const textNode = $getNodeByKey(menu.slashMarker.textNodeKey);

            if ($isTextNode(textNode)) {
              const caretOffset = Math.min(menu.slashMarker.offset + 1, textNode.getTextContentSize());
              textNode.select(caretOffset, caretOffset);
              return;
            }
          }

          const targetNode = $getNodeByKey(menu.targetKey);

          if (menu.source === "plus") {
            selectNodeEnd(targetNode);
            return;
          }

          selectNodeStart(targetNode);
        },
        { onUpdate: () => editor.focus() }
      );
    },
    [commandMenu, editor]
  );

  const openMenuAtSelection = useCallback(() => {
    if (!editor.isEditable() || commandMenuRef.current) {
      return;
    }

    let targetKey: NodeKey | undefined;
    let slashMarker: SlashMarker | undefined;

    editor.getEditorState().read(() => {
      const selection = $getSelection();

      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return;
      }

      const anchorNode = selection.anchor.getNode();
      const anchorOffset = selection.anchor.offset;

      if (!$isTextNode(anchorNode) || anchorOffset < 1 || anchorNode.getTextContent()[anchorOffset - 1] !== "/") {
        return;
      }

      targetKey = anchorNode.getTopLevelElementOrThrow().getKey();
      slashMarker = {
        textNodeKey: anchorNode.getKey(),
        offset: anchorOffset - 1
      };
    });

    const layer = layerRef.current;
    const targetElement = targetKey ? editor.getElementByKey(targetKey) : null;

    if (!layer || !targetKey || !slashMarker || !targetElement) {
      return;
    }

    const ignoredMarker = ignoredSlashMarkerRef.current;

    if (ignoredMarker?.textNodeKey === slashMarker.textNodeKey && ignoredMarker.offset === slashMarker.offset) {
      return;
    }

    const targetRect = targetElement.getBoundingClientRect();
    const caretRect = getBrowserCaretRect();
    const anchorRect = caretRect ?? targetRect;

    setCommandQuery("");
    setActiveCommandIndex(0);
    const nextMenu: BlockCommandMenuState = {
      targetKey,
      slashMarker,
      source: "slash",
      left: clampMenuLeft(anchorRect.left, window.innerWidth),
      top: getMenuTop(anchorRect)
    };
    commandMenuRef.current = nextMenu;
    setCommandMenu(nextMenu);
  }, [editor, layerRef]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (
          event.key !== "/" ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.isComposing ||
          !editor.isEditable()
        ) {
          return false;
        }

        window.requestAnimationFrame(openMenuAtSelection);
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, openMenuAtSelection]);

  useEffect(() => {
    return editor.registerUpdateListener(({ dirtyLeaves, editorState }) => {
      if (!editor.isEditable() || commandMenuRef.current || dirtyLeaves.size === 0) {
        return;
      }

      const ignoredMarker = ignoredSlashMarkerRef.current;

      if (ignoredMarker) {
        let ignoredSlashStillExists = false;
        editorState.read(() => {
          const ignoredNode = $getNodeByKey(ignoredMarker.textNodeKey);
          ignoredSlashStillExists =
            $isTextNode(ignoredNode) && ignoredNode.getTextContent()[ignoredMarker.offset] === "/";
        });

        if (!ignoredSlashStillExists) {
          ignoredSlashMarkerRef.current = undefined;
        }
      }

      window.requestAnimationFrame(openMenuAtSelection);
    });
  }, [editor, openMenuAtSelection]);

  useEffect(() => {
    if (!commandMenu) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => menuInputRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Node && !menuRef.current?.contains(target)) {
        closeCommandMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [closeCommandMenu, commandMenu]);

  useEffect(() => {
    if (activeCommandIndex >= filteredCommands.length) {
      setActiveCommandIndex(0);
    }
  }, [activeCommandIndex, filteredCommands.length]);

  useEffect(() => {
    const activeCommand = filteredCommands[activeCommandIndex];

    if (!activeCommand) {
      return;
    }

    menuRef.current
      ?.querySelector<HTMLElement>(`#markflow-block-command-${activeCommand.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeCommandIndex, filteredCommands]);

  const openMenuAfterBlock = useCallback((blockKey: NodeKey) => {
    if (!editor.isEditable()) {
      return;
    }

    let blockExists = false;
    let listItemChecked: boolean | undefined;
    let isListItem = false;
    editor.getEditorState().read(() => {
      const block = $getNodeByKey(blockKey);
      blockExists = block !== null;

      if ($isListItemNode(block)) {
        isListItem = true;
        listItemChecked = block.getChecked();
      }
    });

    const blockElement = editor.getElementByKey(blockKey);

    if (!blockExists || !blockElement) {
      return;
    }

    if (isListItem) {
      editor.update(
        () => {
          const block = $getNodeByKey(blockKey);

          if (!$isListItemNode(block)) {
            return;
          }

          const tree = $buildLogicalBlockTree();
          const targetUnit = tree.units.get(blockKey);

          if (!targetUnit || targetUnit.outlineDepth === undefined) {
            return;
          }

          const listItem = $createListItemNode(typeof listItemChecked === "boolean" ? false : undefined);
          block.insertAfter(listItem);
          $placeNewOutlineSibling(
            listItem,
            targetUnit.nodeKeys.at(-1) ?? blockKey,
            targetUnit.outlineDepth
          );
          listItem.selectStart();
        },
        { onUpdate: () => editor.focus() }
      );
      return;
    }

    const blockRect = blockElement.getBoundingClientRect();
    setCommandQuery("");
    setActiveCommandIndex(0);
    const nextMenu: BlockCommandMenuState = {
      targetKey: blockKey,
      source: "plus",
      left: clampMenuLeft(blockRect.left, window.innerWidth),
      top: getMenuTop(blockRect)
    };
    commandMenuRef.current = nextMenu;
    setCommandMenu(nextMenu);
  }, [editor]);

  const openTurnIntoMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, blockKey: NodeKey) => {
      if (!editor.isEditable()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const tree = getLogicalBlockTree(editor);
      const unit = tree.units.get(blockKey);
      const scope = unit ? tree.scopes.get(unit.scopeKey) : undefined;

      if (!unit || !scope) {
        return;
      }

      const selectedKeys = selectedBlockKeysRef.current.includes(blockKey)
        ? selectedBlockKeysRef.current
        : [blockKey];
      let orderedKeys = scope.units
        .filter((candidate) => selectedKeys.includes(candidate.key))
        .map((candidate) => candidate.key);

      if (orderedKeys.length === 0) {
        return;
      }

      const selectedIndexes = orderedKeys.map((key) => scope.units.findIndex((unit) => unit.key === key));

      if (selectedIndexes.some((index, position) => position > 0 && index !== selectedIndexes[position - 1] + 1)) {
        orderedKeys = [blockKey];
      }

      commitBlockSelection(scope.key, orderedKeys);
      setCommandQuery("");
      setActiveCommandIndex(0);
      const anchorRect = new DOMRect(event.clientX, event.clientY, 0, 0);
      const nextMenu: BlockCommandMenuState = {
        targetKey: blockKey,
        targetKeys: orderedKeys,
        source: "context",
        left: clampMenuLeft(event.clientX, window.innerWidth),
        top: getMenuTop(anchorRect)
      };
      commandMenuRef.current = nextMenu;
      setCommandMenu(nextMenu);
    },
    [commitBlockSelection, editor, selectedBlockKeysRef]
  );

  const applyBlockCommand = useCallback(
    (command: BlockCommand) => {
      const menu = commandMenu;

      if (!menu || !editor.isEditable()) {
        return;
      }

      resetCommandMenu();
      let commandTargets: PreparedBlockCommandTargets | undefined;

      editor.update(
        () => {
          commandTargets = $prepareBlockCommandTargets(menu);
        },
        {
          onUpdate: () => {
            const targets = commandTargets;

            if (!targets) {
              return;
            }

            if (menu.source === "context") {
              commitBlockSelection(undefined, []);
            }

            if (!editor.isEditable()) {
              removeEmptyCommandParagraph(editor, targets.targetKey);
              return;
            }

            editor.focus(() => {
              executeBlockCommand(editor, editorModule, command.id, targets);
            });
          }
        }
      );
    },
    [commandMenu, commitBlockSelection, editor, editorModule, resetCommandMenu]
  );

  const handleMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveCommandIndex((current) =>
          filteredCommands.length === 0 ? 0 : (current + 1) % filteredCommands.length
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveCommandIndex((current) =>
          filteredCommands.length === 0 ? 0 : (current - 1 + filteredCommands.length) % filteredCommands.length
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const command = filteredCommands[activeCommandIndex];

        if (command) {
          applyBlockCommand(command);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandMenu({ restoreFocus: true });
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        commandMenu?.source === "slash" &&
        commandQuery.length === 0
      ) {
        event.preventDefault();
        closeCommandMenu({ removeSlash: true });
        return;
      }

      if (event.key === " " && commandMenu?.source === "slash" && commandQuery.length === 0) {
        event.preventDefault();
        closeCommandMenu({ insertSpace: true });
      }
    },
    [activeCommandIndex, applyBlockCommand, closeCommandMenu, commandMenu?.source, commandQuery.length, filteredCommands]
  );

  const updateCommandQuery = useCallback((query: string) => {
    setCommandQuery(query);
    setActiveCommandIndex(0);
  }, []);

  return {
    activeCommandIndex,
    applyBlockCommand,
    commandMenu,
    commandQuery,
    filteredCommands,
    handleMenuKeyDown,
    menuInputRef,
    menuRef,
    openMenuAfterBlock,
    openTurnIntoMenu,
    setActiveCommandIndex,
    updateCommandQuery
  };
}

function selectNodeStart(node: LexicalNode | null): void {
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

function selectNodeEnd(node: LexicalNode | null): void {
  if (!node) {
    return;
  }

  if ("selectEnd" in node && typeof node.selectEnd === "function") {
    node.selectEnd();
    return;
  }

  if ("select" in node && typeof node.select === "function") {
    node.select();
  }
}
