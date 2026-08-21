import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { $createListItemNode, $isListItemNode, $isListNode, type ListItemNode } from "@lexical/list";
import type { RealmPlugin } from "@mdxeditor/editor";
import type { Realm } from "@mdxeditor/gurx";
import { $createHeadingNode, $createQuoteNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createRangeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  type LexicalNode,
  type NodeKey
} from "lexical";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";

type MdxEditorModule = typeof import("@mdxeditor/editor");
type DropPlacement = "before" | "after";

interface BlockHandle {
  key: NodeKey;
  isContainer: boolean;
  isListItem: boolean;
  left: number;
  top: number;
}

interface BlockUnit {
  key: NodeKey;
  nodeKeys: NodeKey[];
}

interface BlockScope {
  parentKey: NodeKey;
  units: BlockUnit[];
}

interface DraggedBlocks {
  parentKey: NodeKey;
  keys: NodeKey[];
  sourceKey: NodeKey;
}

interface DragPoint {
  x: number;
  y: number;
}

interface SlashMarker {
  textNodeKey: NodeKey;
  offset: number;
}

interface CommandMenuState {
  targetKey: NodeKey;
  targetKeys?: NodeKey[];
  left: number;
  top: number;
  source: "context" | "plus" | "slash";
  slashMarker?: SlashMarker;
}

interface SelectionGutter {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SelectionMarquee {
  left: number;
  top: number;
  width: number;
  height: number;
}

type BlockCommandKind =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "number-list"
  | "check-list"
  | "quote"
  | "code"
  | "table"
  | "divider";

interface BlockCommand {
  id: BlockCommandKind;
  label: string;
  description: string;
  icon: string;
  keywords: string;
}

interface DropTarget {
  key: NodeKey;
  placement: DropPlacement;
}

interface DropIndicator {
  left: number;
  top: number;
  width: number;
}

const BLOCK_DRAG_DATA_FORMAT = "application/x-markflow-block-key";
const BLOCK_HANDLE_HEIGHT = 25;
const BLOCK_DRAG_SCROLL_EDGE = 64;
const BLOCK_DRAG_SCROLL_MAX_SPEED = 900;

const BLOCK_COMMANDS: readonly BlockCommand[] = [
  {
    id: "paragraph",
    label: "Text",
    description: "Plain paragraph",
    icon: "T",
    keywords: "text paragraph plain body"
  },
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Large section heading",
    icon: "H1",
    keywords: "title heading one h1"
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Medium section heading",
    icon: "H2",
    keywords: "subtitle heading two h2"
  },
  {
    id: "heading-3",
    label: "Heading 3",
    description: "Small section heading",
    icon: "H3",
    keywords: "heading three h3"
  },
  {
    id: "bullet-list",
    label: "Bulleted list",
    description: "Create a simple list",
    icon: "•",
    keywords: "bullet unordered list"
  },
  {
    id: "number-list",
    label: "Numbered list",
    description: "Create an ordered list",
    icon: "1.",
    keywords: "number ordered list"
  },
  {
    id: "check-list",
    label: "To-do list",
    description: "Track tasks with checkboxes",
    icon: "✓",
    keywords: "todo task checkbox check list"
  },
  {
    id: "quote",
    label: "Quote",
    description: "Capture a quotation",
    icon: "\u201c",
    keywords: "quote blockquote citation"
  },
  {
    id: "code",
    label: "Code block",
    description: "Insert a fenced code block",
    icon: "</>",
    keywords: "code programming source fence"
  },
  {
    id: "table",
    label: "Table",
    description: "Insert a 3 by 3 table",
    icon: "▦",
    keywords: "table grid rows columns"
  },
  {
    id: "divider",
    label: "Divider",
    description: "Separate sections",
    icon: "—",
    keywords: "divider separator horizontal rule line"
  }
];

const TURN_INTO_BLOCK_COMMANDS = BLOCK_COMMANDS.filter(
  (command) => command.id !== "table" && command.id !== "divider"
);

export function createDraggableBlocksPlugin(editorModule: MdxEditorModule): RealmPlugin {
  return editorModule.realmPlugin({
    init(realm) {
      function MarkflowBlockControls(): JSX.Element {
        return <MarkflowDraggableBlocks editorModule={editorModule} realm={realm} />;
      }

      realm.pub(editorModule.addComposerChild$, MarkflowBlockControls);
    }
  })();
}

function MarkflowDraggableBlocks({ editorModule, realm }: { editorModule: MdxEditorModule; realm: Realm }): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const frameRef = useRef<number | undefined>(undefined);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const menuInputRef = useRef<HTMLInputElement | null>(null);
  const rootElementRef = useRef<HTMLElement | undefined>(undefined);
  const draggedBlocksRef = useRef<DraggedBlocks | undefined>(undefined);
  const dragPointRef = useRef<DragPoint | undefined>(undefined);
  const dragScrollFrameRef = useRef<number | undefined>(undefined);
  const dragScrollLastTimeRef = useRef<number | undefined>(undefined);
  const nativeDragEndCleanupRef = useRef<(() => void) | undefined>(undefined);
  const commandMenuRef = useRef<CommandMenuState | undefined>(undefined);
  const ignoredSlashMarkerRef = useRef<SlashMarker | undefined>(undefined);
  const selectedBlockKeysRef = useRef<NodeKey[]>([]);
  const selectedBlockElementsRef = useRef(new Set<HTMLElement>());
  const [rootElement, setRootElement] = useState<HTMLElement | undefined>();
  const [isEditable, setIsEditable] = useState(editor.isEditable());
  const [handles, setHandles] = useState<BlockHandle[]>([]);
  const [selectedBlockKeys, setSelectedBlockKeys] = useState<NodeKey[]>([]);
  const [selectionGutter, setSelectionGutter] = useState<SelectionGutter | undefined>();
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee | undefined>();
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | undefined>();
  const [commandMenu, setCommandMenu] = useState<CommandMenuState | undefined>();
  const [commandQuery, setCommandQuery] = useState("");
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);

  const stopDragAutoScroll = useCallback(() => {
    dragPointRef.current = undefined;
    dragScrollLastTimeRef.current = undefined;

    if (dragScrollFrameRef.current !== undefined) {
      window.cancelAnimationFrame(dragScrollFrameRef.current);
      dragScrollFrameRef.current = undefined;
    }
  }, []);

  const finishBlockDrag = useCallback(() => {
    nativeDragEndCleanupRef.current?.();
    nativeDragEndCleanupRef.current = undefined;
    draggedBlocksRef.current = undefined;
    stopDragAutoScroll();
    setDropIndicator(undefined);
  }, [stopDragAutoScroll]);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = commandQuery.trim().toLocaleLowerCase();
    const availableCommands = commandMenu?.source === "context" ? TURN_INTO_BLOCK_COMMANDS : BLOCK_COMMANDS;

    if (!normalizedQuery) {
      return availableCommands;
    }

    return availableCommands.filter((command) =>
      `${command.label} ${command.description} ${command.keywords}`.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [commandMenu?.source, commandQuery]);

  const commitSelectedBlockKeys = useCallback(
    (nextKeys: NodeKey[]) => {
      const uniqueKeys = Array.from(new Set(nextKeys));

      if (areNodeKeyListsEqual(selectedBlockKeysRef.current, uniqueKeys)) {
        return;
      }

      for (const element of selectedBlockElementsRef.current) {
        element.removeAttribute("data-markflow-block-selected");
      }

      const nextElements = new Set<HTMLElement>();

      for (const key of uniqueKeys) {
        const element = editor.getElementByKey(key);

        if (element) {
          element.setAttribute("data-markflow-block-selected", "true");
          nextElements.add(element);
        }
      }

      selectedBlockElementsRef.current = nextElements;
      selectedBlockKeysRef.current = uniqueKeys;
      setSelectedBlockKeys(uniqueKeys);
    },
    [editor]
  );

  const measureHandles = useCallback(() => {
    const root = rootElementRef.current;
    const layer = layerRef.current;
    const scroller = root?.parentElement;

    if (!root || !layer || !scroller) {
      setHandles([]);
      setSelectionGutter(undefined);
      return;
    }

    const contentBlockKeys = getHandleBlockKeys(editor);
    const containerKeySet = new Set(getTopLevelNestedContainerKeys(editor));
    const blockKeys = Array.from(new Set([...containerKeySet, ...contentBlockKeys]));

    const overlayRect = layer.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const rootPaddingLeft = Number.parseFloat(window.getComputedStyle(root).paddingLeft) || 0;
    const gutterLeft = Math.max(0, scrollerRect.left - overlayRect.left);
    const gutterRight = Math.min(scrollerRect.right, rootRect.left + rootPaddingLeft - 4) - overlayRect.left;
    const nextGutter = {
      left: gutterLeft,
      top: Math.max(0, scrollerRect.top - overlayRect.top),
      width: Math.max(0, gutterRight - gutterLeft),
      height: Math.max(0, scrollerRect.height)
    };
    setSelectionGutter((current) => (areSelectionGuttersEqual(current, nextGutter) ? current : nextGutter));

    const validSelectedKeys = selectedBlockKeysRef.current.filter((key) => blockKeys.includes(key));

    if (!areNodeKeyListsEqual(selectedBlockKeysRef.current, validSelectedKeys)) {
      commitSelectedBlockKeys(validSelectedKeys);
    } else if (validSelectedKeys.length > 0) {
      const nextSelectedElements = new Set<HTMLElement>();

      for (const key of validSelectedKeys) {
        const element = editor.getElementByKey(key);

        if (element) {
          element.setAttribute("data-markflow-block-selected", "true");
          nextSelectedElements.add(element);
        }
      }

      selectedBlockElementsRef.current = nextSelectedElements;
    }

    const nextHandles = blockKeys.flatMap((key): BlockHandle[] => {
      const element = editor.getElementByKey(key);

      if (!element) {
        return [];
      }

      const isContainer = containerKeySet.has(key);
      const rect = isContainer ? element.getBoundingClientRect() : getVisualBlockRect(element);

      if (rect.height <= 0 || rect.width <= 0) {
        return [];
      }

      const handleViewportTop = rect.top + 2;
      const isDragSource = draggedBlocksRef.current?.sourceKey === key;

      if (
        !isDragSource &&
        (handleViewportTop < scrollerRect.top ||
          handleViewportTop + BLOCK_HANDLE_HEIGHT > scrollerRect.bottom)
      ) {
        return [];
      }

      return [
        {
          key,
          isContainer,
          isListItem: isListItemBlock(editor, key),
          left: Math.max(6, rect.left - overlayRect.left - (isContainer ? 88 : 58)),
          top: rect.top - overlayRect.top + 2
        }
      ];
    });

    setHandles(nextHandles);
  }, [commitSelectedBlockKeys, editor]);

  const requestMeasureHandles = useCallback(() => {
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = undefined;
      measureHandles();
    });
  }, [measureHandles]);

  useEffect(() => {
    const updateRoot = (nextRootElement: HTMLElement | null) => {
      rootElementRef.current = nextRootElement ?? undefined;
      setRootElement(nextRootElement ?? undefined);
    };

    updateRoot(editor.getRootElement());

    return editor.registerRootListener(updateRoot);
  }, [editor]);

  useEffect(() => editor.registerEditableListener(setIsEditable), [editor]);

  useEffect(() => {
    if (isEditable) {
      return;
    }

    commandMenuRef.current = undefined;
    ignoredSlashMarkerRef.current = undefined;
    finishBlockDrag();
    setCommandMenu(undefined);
    setCommandQuery("");
    setActiveCommandIndex(0);
    setSelectionMarquee(undefined);
    commitSelectedBlockKeys([]);
  }, [commitSelectedBlockKeys, finishBlockDrag, isEditable]);

  useEffect(
    () => () => {
      for (const element of selectedBlockElementsRef.current) {
        element.removeAttribute("data-markflow-block-selected");
      }
    },
    []
  );

  useEffect(() => {
    const root = rootElement;
    const scroller = root?.parentElement;

    if (!root || !scroller) {
      return;
    }

    requestMeasureHandles();

    const unregisterUpdateListener = editor.registerUpdateListener(() => {
      requestMeasureHandles();
    });
    const resizeObserver = new ResizeObserver(requestMeasureHandles);
    const handleScrollOrResize = () => requestMeasureHandles();

    resizeObserver.observe(root);
    resizeObserver.observe(scroller);
    scroller.addEventListener("scroll", handleScrollOrResize);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      unregisterUpdateListener();
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", handleScrollOrResize);
      window.removeEventListener("resize", handleScrollOrResize);

      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
    };
  }, [editor, requestMeasureHandles, rootElement]);

  const startMarqueeSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootElementRef.current;
      const layer = layerRef.current;
      const scroller = root?.parentElement;

      if (!editor.isEditable() || event.button !== 0 || !event.isPrimary || !root || !layer || !scroller) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();

      const pointerId = event.pointerId;
      const overlayRect = layer.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const startX = clamp(event.clientX, scrollerRect.left, scrollerRect.right);
      const startY = clamp(event.clientY, scrollerRect.top, scrollerRect.bottom);
      let moved = false;
      let selectionScope: BlockScope | undefined;

      const removeListeners = () => {
        document.removeEventListener("pointermove", handlePointerMove, true);
        document.removeEventListener("pointerup", handlePointerUp, true);
        document.removeEventListener("pointercancel", handlePointerCancel, true);
        window.removeEventListener("blur", handleWindowBlur);
      };

      const finish = () => {
        removeListeners();
        document.body.classList.remove("markflow-blocks-are-selecting");
        setSelectionMarquee(undefined);

        if (!moved) {
          commitSelectedBlockKeys([]);
        }
      };

      const updateSelection = (clientX: number, clientY: number) => {
        const currentX = clamp(clientX, scrollerRect.left, scrollerRect.right);
        const currentY = clamp(clientY, scrollerRect.top, scrollerRect.bottom);
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const right = Math.max(startX, currentX);
        const bottom = Math.max(startY, currentY);
        moved ||= Math.hypot(currentX - startX, currentY - startY) >= 4;
        setSelectionMarquee({
          left: left - overlayRect.left,
          top: top - overlayRect.top,
          width: right - left,
          height: bottom - top
        });

        if (!moved) {
          return;
        }

        const intersectingBlocks = getHandleBlockKeys(editor).flatMap((key): Array<{ key: NodeKey; rect: DOMRect }> => {
          const element = editor.getElementByKey(key);

          if (!element) {
            return [];
          }

          const rect = getVisualBlockRect(element);
          return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom
            ? [{ key, rect }]
            : [];
        });

        if (!selectionScope && intersectingBlocks.length > 0) {
          const anchorBlock = intersectingBlocks.reduce((closest, candidate) =>
            distanceFromYToRect(startY, candidate.rect) < distanceFromYToRect(startY, closest.rect)
              ? candidate
              : closest
          );
          selectionScope = getBlockScope(editor, anchorBlock.key);
        }

        const selectedUnitKeySet = new Set(
          intersectingBlocks.flatMap(({ key }) => {
            if (!selectionScope) {
              return [key];
            }

            const unitKey = getBlockUnitKeyInScope(editor, key, selectionScope);
            return unitKey ? [unitKey] : [];
          })
        );
        const selectedKeys = selectionScope
          ? selectionScope.units.map((unit) => unit.key).filter((key) => selectedUnitKeySet.has(key))
          : [...selectedUnitKeySet];
        commitSelectedBlockKeys(selectedKeys);
      };

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }

        pointerEvent.preventDefault();
        updateSelection(pointerEvent.clientX, pointerEvent.clientY);
      };

      const handlePointerUp = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }

        pointerEvent.preventDefault();
        finish();
      };

      const handlePointerCancel = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId === pointerId) {
          finish();
        }
      };

      const handleWindowBlur = () => finish();

      document.body.classList.add("markflow-blocks-are-selecting");
      setSelectionMarquee({
        left: startX - overlayRect.left,
        top: startY - overlayRect.top,
        width: 0,
        height: 0
      });
      document.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
      document.addEventListener("pointerup", handlePointerUp, true);
      document.addEventListener("pointercancel", handlePointerCancel, true);
      window.addEventListener("blur", handleWindowBlur);
    },
    [commitSelectedBlockKeys, editor]
  );

  useEffect(() => {
    const scroller = rootElement?.parentElement;

    if (!scroller) {
      return;
    }

    const clearBlockSelection = (event: PointerEvent) => {
      const target = event.target;

      if (
        event.button !== 0 ||
        !(target instanceof Element) ||
        target.closest(".markflow-block-controls, .markflow-block-command-menu, .markflow-block-selection-gutter")
      ) {
        return;
      }

      commitSelectedBlockKeys([]);
    };

    scroller.addEventListener("pointerdown", clearBlockSelection, true);
    return () => scroller.removeEventListener("pointerdown", clearBlockSelection, true);
  }, [commitSelectedBlockKeys, rootElement]);

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

            if (
              $isTextNode(textNode) &&
              textNode.getTextContent()[menu.slashMarker.offset] === "/"
            ) {
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
        {
          onUpdate: () => {
            editor.focus();
          }
        }
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

    if (
      ignoredMarker?.textNodeKey === slashMarker.textNodeKey &&
      ignoredMarker.offset === slashMarker.offset
    ) {
      return;
    }

    const targetRect = targetElement.getBoundingClientRect();
    const caretRect = getBrowserCaretRect();
    const anchorRect = caretRect ?? targetRect;

    setCommandQuery("");
    setActiveCommandIndex(0);
    const nextMenu: CommandMenuState = {
      targetKey,
      slashMarker,
      source: "slash",
      left: clampMenuLeft(anchorRect.left, window.innerWidth),
      top: getMenuTop(anchorRect)
    };
    commandMenuRef.current = nextMenu;
    setCommandMenu(nextMenu);
  }, [editor]);

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

    const focusFrame = window.requestAnimationFrame(() => {
      menuInputRef.current?.focus();
    });

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

  const openMenuAfterBlock = useCallback(
    (blockKey: NodeKey) => {
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

            const listItem = $createListItemNode(typeof listItemChecked === "boolean" ? false : undefined);
            const parent = block.getParent();
            const unit = $isElementNode(parent)
              ? $getSiblingBlockUnits(parent).find((candidate) => candidate.key === blockKey)
              : undefined;
            const insertionAnchor = $getNodeByKey(unit?.nodeKeys.at(-1) ?? blockKey);

            if (!$isListItemNode(insertionAnchor)) {
              return;
            }

            insertionAnchor.insertAfter(listItem);
            listItem.selectStart();
          },
          { onUpdate: () => editor.focus() }
        );
        return;
      }

      const blockRect = blockElement.getBoundingClientRect();
      setCommandQuery("");
      setActiveCommandIndex(0);
      const nextMenu: CommandMenuState = {
        targetKey: blockKey,
        source: "plus",
        left: clampMenuLeft(blockRect.left, window.innerWidth),
        top: getMenuTop(blockRect)
      };
      commandMenuRef.current = nextMenu;
      setCommandMenu(nextMenu);
    },
    [editor]
  );

  const openTurnIntoMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, blockKey: NodeKey) => {
      if (!editor.isEditable()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const scope = getBlockScope(editor, blockKey);

      if (!scope) {
        return;
      }

      const selectedKeys = selectedBlockKeysRef.current.includes(blockKey)
        ? selectedBlockKeysRef.current
        : [blockKey];
      let orderedKeys = scope.units
        .map((unit) => unit.key)
        .filter((key) => selectedKeys.includes(key));

      if (orderedKeys.length === 0) {
        return;
      }

      const selectedIndexes = orderedKeys.map((key) => scope.units.findIndex((unit) => unit.key === key));

      if (selectedIndexes.some((index, position) => position > 0 && index !== selectedIndexes[position - 1] + 1)) {
        orderedKeys = [blockKey];
      }

      commitSelectedBlockKeys(orderedKeys);
      setCommandQuery("");
      setActiveCommandIndex(0);
      const anchorRect = new DOMRect(event.clientX, event.clientY, 0, 0);
      const nextMenu: CommandMenuState = {
        targetKey: blockKey,
        targetKeys: orderedKeys,
        source: "context",
        left: clampMenuLeft(event.clientX, window.innerWidth),
        top: getMenuTop(anchorRect)
      };
      commandMenuRef.current = nextMenu;
      setCommandMenu(nextMenu);
    },
    [commitSelectedBlockKeys, editor]
  );

  const applyBlockCommand = useCallback(
    (command: BlockCommand) => {
      const menu = commandMenu;

      if (!menu || !editor.isEditable()) {
        return;
      }

      commandMenuRef.current = undefined;
      ignoredSlashMarkerRef.current = undefined;
      setCommandMenu(undefined);
      setCommandQuery("");
      setActiveCommandIndex(0);

      let commandTargetKey: NodeKey | undefined;
      let commandTargetKeys: NodeKey[] = [];

      editor.update(
        () => {
          if (menu.slashMarker) {
            const slashTextNode = $getNodeByKey(menu.slashMarker.textNodeKey);

            if (!$isTextNode(slashTextNode) || slashTextNode.getTextContent()[menu.slashMarker.offset] !== "/") {
              return;
            }

            slashTextNode.spliceText(menu.slashMarker.offset, 1, "");
          }

          if (menu.source === "context") {
            const requestedKeys = menu.targetKeys ?? [menu.targetKey];
            const targetNode = $getNodeByKey(menu.targetKey);
            const targetParent = targetNode?.getParent();
            commandTargetKeys = $isElementNode(targetParent)
              ? targetParent
                  .getChildrenKeys()
                  .filter((key) => requestedKeys.includes(key) && $getNodeByKey(key) !== null)
              : [];

            if (commandTargetKeys.length === 0) {
              return;
            }

            commandTargetKey = commandTargetKeys[0];
            selectSiblingBlockRange(commandTargetKeys);
            return;
          }

          const menuTargetNode = $getNodeByKey(menu.targetKey);

          if (!menuTargetNode) {
            return;
          }

          const targetNode = menu.source === "plus"
            ? (() => {
                if ($isListItemNode(menuTargetNode)) {
                  return null;
                }

                const paragraph = $createParagraphNode();
                menuTargetNode.insertAfter(paragraph);
                return paragraph;
              })()
            : menuTargetNode;

          if (!targetNode) {
            return;
          }

          commandTargetKey = targetNode.getKey();
          commandTargetKeys = [commandTargetKey];
          selectNodeStart(targetNode);
        },
        {
          onUpdate: () => {
            const targetKey = commandTargetKey;

            if (!targetKey) {
              return;
            }

            if (menu.source === "context") {
              commitSelectedBlockKeys([]);
            }

            if (!editor.isEditable()) {
              removeEmptyParagraph(editor, targetKey);
              return;
            }

            editor.focus(() => {
              publishBlockCommand(editor, editorModule, realm, command.id, targetKey, commandTargetKeys);
            });
          }
        }
      );
    },
    [commandMenu, commitSelectedBlockKeys, editor, editorModule, realm]
  );

  const handleMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveCommandIndex((current) => (filteredCommands.length === 0 ? 0 : (current + 1) % filteredCommands.length));
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

  useEffect(() => {
    const root = rootElement;
    const scroller = root?.parentElement;

    if (!root || !scroller) {
      return;
    }

    const updateDropIndicator = (clientY: number) => {
      const draggedBlocks = draggedBlocksRef.current;

      if (!draggedBlocks) {
        setDropIndicator(undefined);
        return;
      }

      const target = getDropTarget(editor, clientY, draggedBlocks);
      setDropIndicator(target ? getDropIndicator(editor, target, layerRef.current) : undefined);
    };

    const runDragAutoScroll = (timestamp: number) => {
      dragScrollFrameRef.current = undefined;
      const point = dragPointRef.current;

      if (!point || !draggedBlocksRef.current) {
        dragScrollLastTimeRef.current = undefined;
        return;
      }

      const rect = scroller.getBoundingClientRect();

      if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) {
        dragScrollLastTimeRef.current = undefined;
        return;
      }

      const edgeSize = Math.min(BLOCK_DRAG_SCROLL_EDGE, rect.height / 2);
      let edgeRatio = 0;

      if (point.y < rect.top + edgeSize) {
        edgeRatio = -1 + (point.y - rect.top) / edgeSize;
      } else if (point.y > rect.bottom - edgeSize) {
        edgeRatio = 1 - (rect.bottom - point.y) / edgeSize;
      }

      if (edgeRatio === 0) {
        dragScrollLastTimeRef.current = undefined;
        return;
      }

      const previousTimestamp = dragScrollLastTimeRef.current ?? timestamp - 1000 / 60;
      const elapsedMs = Math.min(32, Math.max(0, timestamp - previousTimestamp));
      dragScrollLastTimeRef.current = timestamp;
      const previousScrollTop = scroller.scrollTop;
      scroller.scrollTop += edgeRatio * BLOCK_DRAG_SCROLL_MAX_SPEED * (elapsedMs / 1000);

      if (scroller.scrollTop === previousScrollTop) {
        dragScrollLastTimeRef.current = undefined;
        return;
      }

      updateDropIndicator(point.y);
      dragScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScroll);
    };

    const scheduleDragAutoScroll = () => {
      if (dragScrollFrameRef.current === undefined) {
        dragScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScroll);
      }
    };

    const handleNativeDragOver = (event: globalThis.DragEvent) => {
      if (!editor.isEditable() || !draggedBlocksRef.current) {
        return;
      }

      event.preventDefault();

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }

      dragPointRef.current = { x: event.clientX, y: event.clientY };
      updateDropIndicator(event.clientY);
      scheduleDragAutoScroll();
    };

    const handleDocumentDragOver = (event: globalThis.DragEvent) => {
      if (!draggedBlocksRef.current) {
        return;
      }

      const rect = scroller.getBoundingClientRect();

      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        stopDragAutoScroll();
        setDropIndicator(undefined);
      }
    };

    const handleDocumentDragLeave = (event: globalThis.DragEvent) => {
      if (
        draggedBlocksRef.current &&
        event.relatedTarget === null &&
        (event.clientX <= 0 ||
          event.clientX >= window.innerWidth ||
          event.clientY <= 0 ||
          event.clientY >= window.innerHeight)
      ) {
        stopDragAutoScroll();
        setDropIndicator(undefined);
      }
    };

    const handleDocumentDrop = (event: globalThis.DragEvent) => {
      const target = event.target;

      if (draggedBlocksRef.current && (!(target instanceof Node) || !scroller.contains(target))) {
        finishBlockDrag();
      }
    };

    const handleNativeDrop = (event: globalThis.DragEvent) => {
      const draggedBlocks = draggedBlocksRef.current;

      if (!editor.isEditable() || !draggedBlocks) {
        finishBlockDrag();
        return;
      }

      event.preventDefault();
      const target = getDropTarget(editor, event.clientY, draggedBlocks);

      if (!target) {
        finishBlockDrag();
        return;
      }

      moveSiblingBlocks(editor, draggedBlocks, target);
      finishBlockDrag();
      requestMeasureHandles();
    };

    const handleWindowBlur = () => finishBlockDrag();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        finishBlockDrag();
      }
    };

    scroller.addEventListener("dragover", handleNativeDragOver, true);
    scroller.addEventListener("drop", handleNativeDrop, true);
    document.addEventListener("dragleave", handleDocumentDragLeave, true);
    document.addEventListener("dragover", handleDocumentDragOver, true);
    document.addEventListener("drop", handleDocumentDrop, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      scroller.removeEventListener("dragover", handleNativeDragOver, true);
      scroller.removeEventListener("drop", handleNativeDrop, true);
      document.removeEventListener("dragleave", handleDocumentDragLeave, true);
      document.removeEventListener("dragover", handleDocumentDragOver, true);
      document.removeEventListener("drop", handleDocumentDrop, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      finishBlockDrag();
    };
  }, [editor, finishBlockDrag, requestMeasureHandles, rootElement, stopDragAutoScroll]);

  if (!rootElement) {
    return null;
  }

  return (
    <div ref={layerRef} className="markflow-block-handle-layer" contentEditable={false}>
      {isEditable && selectionGutter ? (
        <div
          aria-label="Drag to select blocks"
          className="markflow-block-selection-gutter"
          onPointerDown={startMarqueeSelection}
          role="presentation"
          style={{
            left: `${selectionGutter.left}px`,
            top: `${selectionGutter.top}px`,
            width: `${selectionGutter.width}px`,
            height: `${selectionGutter.height}px`
          }}
          title="Drag to select multiple blocks"
        />
      ) : null}
      {selectionMarquee ? (
        <div
          aria-hidden="true"
          className="markflow-block-selection-marquee"
          style={{
            left: `${selectionMarquee.left}px`,
            top: `${selectionMarquee.top}px`,
            width: `${selectionMarquee.width}px`,
            height: `${selectionMarquee.height}px`
          }}
        />
      ) : null}
      {isEditable ? handles.map((handle) => (
        <div
          key={handle.key}
          className="markflow-block-controls"
          data-container={handle.isContainer || undefined}
          data-selected={selectedBlockKeys.includes(handle.key)}
          style={{ left: `${handle.left}px`, top: `${handle.top}px` }}
        >
          {!handle.isContainer ? (
            <button
              aria-label={handle.isListItem ? "Add list item below" : "Add block below"}
              className="markflow-block-add-button"
              onClick={() => openMenuAfterBlock(handle.key)}
              title={handle.isListItem ? "Add list item below" : "Add block below"}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
          ) : null}
          <button
            aria-label={handle.isContainer ? "Drag block group" : "Drag block"}
            aria-pressed={selectedBlockKeys.includes(handle.key)}
            className="markflow-block-drag-handle"
            draggable
            onDragEnd={() => {
              finishBlockDrag();
              requestMeasureHandles();
            }}
            onDragStart={(event: DragEvent<HTMLButtonElement>) => {
              if (!editor.isEditable()) {
                event.preventDefault();
                return;
              }

              const scope = getBlockScope(editor, handle.key);

              if (!scope) {
                event.preventDefault();
                return;
              }

              const selectedKeys = selectedBlockKeysRef.current.includes(handle.key)
                ? selectedBlockKeysRef.current
                : [handle.key];
              const orderedKeys = scope.units
                .map((unit) => unit.key)
                .filter((key) => selectedKeys.includes(key));

              if (orderedKeys.length === 0) {
                event.preventDefault();
                return;
              }

              const draggedBlocks = { parentKey: scope.parentKey, keys: orderedKeys, sourceKey: handle.key };
              draggedBlocksRef.current = draggedBlocks;
              commitSelectedBlockKeys(orderedKeys);
              const sourceElement = event.currentTarget;
              const handleNativeDragEnd = () => finishBlockDrag();
              nativeDragEndCleanupRef.current?.();
              sourceElement.addEventListener("dragend", handleNativeDragEnd, { once: true });
              nativeDragEndCleanupRef.current = () => sourceElement.removeEventListener("dragend", handleNativeDragEnd);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(BLOCK_DRAG_DATA_FORMAT, JSON.stringify(draggedBlocks));
            }}
            onContextMenu={handle.isListItem || handle.isContainer ? undefined : (event) => openTurnIntoMenu(event, handle.key)}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }

              const currentKeys = selectedBlockKeysRef.current;
              const scope = getBlockScope(editor, handle.key);

              if (!scope) {
                return;
              }

              const siblingKeys = scope.units.map((unit) => unit.key);
              const siblingKeySet = new Set(siblingKeys);
              const selectedSiblingKeys = currentKeys.filter((key) => siblingKeySet.has(key));

              if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                commitSelectedBlockKeys(
                  selectedSiblingKeys.includes(handle.key)
                    ? selectedSiblingKeys.filter((key) => key !== handle.key)
                    : siblingKeys.filter((key) => [...selectedSiblingKeys, handle.key].includes(key))
                );
                return;
              }

              if (!currentKeys.includes(handle.key)) {
                commitSelectedBlockKeys([handle.key]);
              }
            }}
            title={
              handle.isContainer
                ? "Drag block group"
                : handle.isListItem
                  ? "Drag list item"
                  : "Drag block · Right-click to change type"
            }
            type="button"
          >
            <svg aria-hidden="true" className="markflow-block-drag-handle-glyph" viewBox="0 0 16 16">
              <circle cx="5" cy="3" r="1.25" />
              <circle cx="11" cy="3" r="1.25" />
              <circle cx="5" cy="8" r="1.25" />
              <circle cx="11" cy="8" r="1.25" />
              <circle cx="5" cy="13" r="1.25" />
              <circle cx="11" cy="13" r="1.25" />
            </svg>
          </button>
        </div>
      )) : null}
      {dropIndicator ? (
        <div
          aria-hidden="true"
          className="markflow-block-drop-line"
          style={{ left: `${dropIndicator.left}px`, top: `${dropIndicator.top}px`, width: `${dropIndicator.width}px` }}
        />
      ) : null}
      {commandMenu && isEditable ? createPortal(
        <section
          ref={menuRef}
          aria-label={commandMenu.source === "context" ? "Turn blocks into" : "Block menu"}
          className="markflow-block-command-menu"
          style={{ left: `${commandMenu.left}px`, top: `${commandMenu.top}px` }}
        >
          <label className="markflow-block-command-search">
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <circle cx="7" cy="7" r="4.25" />
              <path d="m10.2 10.2 3.1 3.1" />
            </svg>
            <span className="visually-hidden">Search blocks</span>
            <input
              ref={menuInputRef}
              aria-activedescendant={
                filteredCommands[activeCommandIndex]
                  ? `markflow-block-command-${filteredCommands[activeCommandIndex].id}`
                  : undefined
              }
              aria-controls="markflow-block-command-list"
              aria-label="Search blocks"
              autoComplete="off"
              onChange={(event) => {
                setCommandQuery(event.currentTarget.value);
                setActiveCommandIndex(0);
              }}
              onKeyDown={handleMenuKeyDown}
              placeholder={commandMenu.source === "context" ? "Search block types..." : "Search blocks..."}
              role="combobox"
              spellCheck={false}
              value={commandQuery}
            />
          </label>
          <div className="markflow-block-command-caption">
            {commandMenu.source === "context"
              ? `Turn ${commandMenu.targetKeys?.length === 1 ? "block" : `${commandMenu.targetKeys?.length ?? 1} blocks`} into`
              : "Basic blocks"}
          </div>
          <div id="markflow-block-command-list" className="markflow-block-command-list" role="listbox">
            {filteredCommands.length > 0 ? (
              filteredCommands.map((command, index) => (
                <button
                  key={command.id}
                  id={`markflow-block-command-${command.id}`}
                  aria-selected={index === activeCommandIndex}
                  className="markflow-block-command-option"
                  data-active={index === activeCommandIndex}
                  onClick={() => applyBlockCommand(command)}
                  onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault()}
                  onMouseEnter={() => setActiveCommandIndex(index)}
                  role="option"
                  type="button"
                >
                  <span aria-hidden="true" className="markflow-block-command-icon">
                    {command.icon}
                  </span>
                  <span>
                    <strong>{command.label}</strong>
                    <small>{command.description}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="markflow-block-command-empty">No blocks found</p>
            )}
          </div>
          {commandMenu.source === "slash" && commandQuery.length === 0 ? (
            <p className="markflow-block-command-hint">Space closes · Backspace/Delete removes /</p>
          ) : null}
        </section>,
        document.body
      ) : null}
    </div>
  );
}

function selectSiblingBlockRange(blockKeys: NodeKey[]): void {
  const firstNode = $getNodeByKey(blockKeys[0]);
  const parent = firstNode?.getParent();

  if (!$isElementNode(parent)) {
    return;
  }

  const siblingKeys = parent.getChildrenKeys();
  const selectedIndexes = blockKeys
    .map((key) => siblingKeys.indexOf(key))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);

  if (selectedIndexes.length === 0) {
    return;
  }

  if (selectedIndexes.length === 1) {
    selectNodeStart($getNodeByKey(siblingKeys[selectedIndexes[0]]));
    return;
  }

  const selection = $createRangeSelection();
  selection.anchor.set(parent.getKey(), selectedIndexes[0], "element");
  selection.focus.set(parent.getKey(), selectedIndexes[selectedIndexes.length - 1] + 1, "element");
  $setSelection(selection);
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

function removeEmptyParagraph(editor: ReturnType<typeof useLexicalComposerContext>[0], nodeKey: NodeKey): void {
  editor.update(() => {
    const node = $getNodeByKey(nodeKey);

    if (node?.getType() === "paragraph" && node.getTextContentSize() === 0) {
      node.remove();
    }
  });
}

function getBrowserCaretRect(): DOMRect | undefined {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(false);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();

  return rect.width > 0 || rect.height > 0 ? rect : undefined;
}

function clampMenuLeft(left: number, layerWidth: number): number {
  const estimatedMenuWidth = Math.min(320, Math.max(0, window.innerWidth - 32));
  return Math.max(8, Math.min(left, Math.max(8, layerWidth - estimatedMenuWidth - 8)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

function areNodeKeyListsEqual(left: readonly NodeKey[], right: readonly NodeKey[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function areSelectionGuttersEqual(
  left: SelectionGutter | undefined,
  right: SelectionGutter
): boolean {
  return Boolean(
    left &&
      left.left === right.left &&
      left.top === right.top &&
      left.width === right.width &&
      left.height === right.height
  );
}

function getMenuTop(anchorRect: DOMRect): number {
  const viewportGap = 8;
  const estimatedMenuHeight = Math.min(400, Math.max(0, window.innerHeight - viewportGap * 2));
  const belowTop = anchorRect.bottom + viewportGap;
  const aboveTop = anchorRect.top - viewportGap - estimatedMenuHeight;

  if (window.innerHeight - belowTop >= estimatedMenuHeight) {
    return belowTop;
  }

  if (aboveTop >= viewportGap) {
    return aboveTop;
  }

  const spaceBelow = window.innerHeight - belowTop;
  const spaceAbove = anchorRect.top - viewportGap;
  return spaceBelow >= spaceAbove
    ? Math.max(viewportGap, window.innerHeight - estimatedMenuHeight - viewportGap)
    : viewportGap;
}

function publishBlockCommand(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  editorModule: MdxEditorModule,
  realm: Realm,
  command: BlockCommandKind,
  targetKey: NodeKey,
  targetKeys: NodeKey[] = [targetKey]
): void {
  switch (command) {
    case "paragraph":
      realm.pub(editorModule.convertSelectionToNode$, () => $createParagraphNode());
      return;

    case "heading-1":
      realm.pub(editorModule.convertSelectionToNode$, () => $createHeadingNode("h1"));
      return;

    case "heading-2":
      realm.pub(editorModule.convertSelectionToNode$, () => $createHeadingNode("h2"));
      return;

    case "heading-3":
      realm.pub(editorModule.convertSelectionToNode$, () => $createHeadingNode("h3"));
      return;

    case "bullet-list":
      realm.pub(editorModule.applyListType$, "bullet");
      return;

    case "number-list":
      realm.pub(editorModule.applyListType$, "number");
      return;

    case "check-list":
      realm.pub(editorModule.applyListType$, "check");
      return;

    case "quote":
      realm.pub(editorModule.convertSelectionToNode$, () => $createQuoteNode());
      return;

    case "code":
      editor.update(() => {
        let firstCodeBlock: ReturnType<typeof editorModule.$createCodeBlockNode> | undefined;

        for (const key of targetKeys) {
          const targetNode = $getNodeByKey(key);

          if (!targetNode) {
            continue;
          }

          const codeBlock = editorModule.$createCodeBlockNode({
            code: targetNode.getTextContent(),
            language: "txt"
          });
          targetNode.replace(codeBlock);
          firstCodeBlock ??= codeBlock;
        }

        firstCodeBlock?.select();
      });
      return;

    case "table":
      editor.update(() => {
        const targetNode = $getNodeByKey(targetKey);

        if (!targetNode) {
          return;
        }

        const rows = Array.from({ length: 3 }, () => ({
          type: "tableRow" as const,
          children: Array.from({ length: 3 }, () => ({ type: "tableCell" as const, children: [] }))
        }));
        const table = editorModule.$createTableNode({ type: "table", children: rows });
        if (targetNode.getTextContent().length > 0) {
          targetNode.insertAfter(table);
        } else {
          targetNode.replace(table);
        }
        table.select();
      });
      return;

    case "divider":
      editor.update(() => {
        const targetNode = $getNodeByKey(targetKey);

        if (!targetNode) {
          return;
        }

        const divider = $createHorizontalRuleNode();
        const paragraph = $createParagraphNode();
        if (targetNode.getTextContent().length > 0) {
          targetNode.insertAfter(divider);
        } else {
          targetNode.replace(divider);
        }
        divider.insertAfter(paragraph);
        paragraph.selectStart();
      });
  }
}

function getHandleBlockKeys(editor: ReturnType<typeof useLexicalComposerContext>[0]): NodeKey[] {
  const blockKeys: NodeKey[] = [];

  editor.getEditorState().read(() => {
    for (const node of $getRoot().getChildren()) {
      $collectHandleBlockKeys(node, blockKeys);
    }
  });

  return blockKeys;
}

function getTopLevelNestedContainerKeys(
  editor: ReturnType<typeof useLexicalComposerContext>[0]
): NodeKey[] {
  let containerKeys: NodeKey[] = [];

  editor.getEditorState().read(() => {
    containerKeys = $getRoot()
      .getChildren()
      .filter((node) => $isListNode(node) || ($isQuoteNode(node) && node.getChildren().some((child) => !child.isInline())))
      .map((node) => node.getKey());
  });

  return containerKeys;
}

function isListItemBlock(editor: ReturnType<typeof useLexicalComposerContext>[0], blockKey: NodeKey): boolean {
  let isListItem = false;

  editor.getEditorState().read(() => {
    isListItem = $isListItemNode($getNodeByKey(blockKey));
  });

  return isListItem;
}

function $collectHandleBlockKeys(node: LexicalNode, blockKeys: NodeKey[]): void {
  if ($isListNode(node)) {
    const units = $getSiblingBlockUnits(node);
    const claimedNodeKeys = new Set(units.flatMap((unit) => unit.nodeKeys));

    for (const unit of units) {
      blockKeys.push(unit.key);

      for (const unitNodeKey of unit.nodeKeys) {
        const unitNode = $getNodeByKey(unitNodeKey);

        if (!$isElementNode(unitNode)) {
          continue;
        }

        for (const child of unitNode.getChildren()) {
          if ($isListNode(child)) {
            $collectHandleBlockKeys(child, blockKeys);
          }
        }
      }
    }

    for (const child of node.getChildren()) {
      if (!claimedNodeKeys.has(child.getKey()) && $isListItemNode(child) && isStructuralListItem(child)) {
        const nestedList = child.getFirstChild();

        if ($isListNode(nestedList)) {
          $collectHandleBlockKeys(nestedList, blockKeys);
        }
      }
    }
    return;
  }

  if ($isQuoteNode(node)) {
    const childBlocks = node.getChildren().filter((child) => !child.isInline());

    if (childBlocks.length === 0) {
      blockKeys.push(node.getKey());
      return;
    }

    for (const child of childBlocks) {
      if ($isListNode(child) || $isQuoteNode(child)) {
        $collectHandleBlockKeys(child, blockKeys);
      } else {
        blockKeys.push(child.getKey());
      }
    }
    return;
  }

  blockKeys.push(node.getKey());
}

function $getSiblingBlockUnits(parent: LexicalNode): BlockUnit[] {
  if (!$isElementNode(parent)) {
    return [];
  }

  if (!$isListNode(parent)) {
    return parent.getChildren().map((node) => ({ key: node.getKey(), nodeKeys: [node.getKey()] }));
  }

  const units: BlockUnit[] = [];

  for (const node of parent.getChildren()) {
    if (!$isListItemNode(node)) {
      continue;
    }

    if (isStructuralListItem(node)) {
      const previousUnit = units.at(-1);

      if (previousUnit) {
        previousUnit.nodeKeys.push(node.getKey());
      }
      continue;
    }

    units.push({ key: node.getKey(), nodeKeys: [node.getKey()] });
  }

  return units;
}

function isStructuralListItem(node: ListItemNode): boolean {
  return node.getChildrenSize() === 1 && $isListNode(node.getFirstChild());
}

function getBlockScope(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  blockKey: NodeKey
): BlockScope | undefined {
  let scope: BlockScope | undefined;

  editor.getEditorState().read(() => {
    const node = $getNodeByKey(blockKey);
    const parent = node?.getParent();

    if (!$isElementNode(parent)) {
      return;
    }

    const units = $getSiblingBlockUnits(parent);

    if (units.some((unit) => unit.key === blockKey)) {
      scope = { parentKey: parent.getKey(), units };
    }
  });

  return scope;
}

function getBlockUnitKeyInScope(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  blockKey: NodeKey,
  scope: BlockScope
): NodeKey | undefined {
  let unitKey: NodeKey | undefined;

  editor.getEditorState().read(() => {
    let node = $getNodeByKey(blockKey);

    while (node && node.getKey() !== scope.parentKey) {
      const nodeKey = node.getKey();
      const matchingUnit = scope.units.find((unit) => unit.nodeKeys.includes(nodeKey));

      if (matchingUnit) {
        unitKey = matchingUnit.key;
        return;
      }

      node = node.getParent();
    }
  });

  return unitKey;
}

function getBlockScopeByParent(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  parentKey: NodeKey
): BlockScope | undefined {
  let scope: BlockScope | undefined;

  editor.getEditorState().read(() => {
    const parent = $getNodeByKey(parentKey);

    if ($isElementNode(parent)) {
      scope = { parentKey, units: $getSiblingBlockUnits(parent) };
    }
  });

  return scope;
}

function getDropTarget(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  clientY: number,
  draggedBlocks: DraggedBlocks
): DropTarget | undefined {
  const scope = getBlockScopeByParent(editor, draggedBlocks.parentKey);

  if (!scope || !scope.units.some((unit) => draggedBlocks.keys.includes(unit.key))) {
    return undefined;
  }

  let target: DropTarget | undefined;

  for (const unit of scope.units) {
    const rect = getBlockUnitRect(editor, unit);

    if (!rect || rect.height <= 0 || rect.width <= 0) {
      continue;
    }

    target = { key: unit.key, placement: "after" };

    if (clientY < rect.top + rect.height / 2) {
      target = { key: unit.key, placement: "before" };
      break;
    }
  }

  if (!target || !getBlockMovePlan(scope.units.map((unit) => unit.key), draggedBlocks.keys, target)) {
    return undefined;
  }

  return target;
}

function getDropIndicator(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  target: DropTarget,
  layer: HTMLDivElement | null
): DropIndicator | undefined {
  const scope = getBlockScope(editor, target.key);
  const targetUnit = scope?.units.find((unit) => unit.key === target.key);
  const targetElement = editor.getElementByKey(target.key);
  const root = editor.getRootElement();

  if (!targetElement || !targetUnit || !root || !layer) {
    return undefined;
  }

  const targetRect = getBlockUnitRect(editor, targetUnit);
  const visualRect = getVisualBlockRect(targetElement);

  if (!targetRect) {
    return undefined;
  }

  const rootRect = root.getBoundingClientRect();
  const overlayRect = layer.getBoundingClientRect();
  const top = target.placement === "before" ? targetRect.top : targetRect.bottom;
  const left = Math.max(rootRect.left + 28, visualRect.left);
  const right = Math.min(rootRect.right - 28, visualRect.right);

  return {
    left: left - overlayRect.left,
    top: top - overlayRect.top - 2,
    width: Math.max(0, right - left)
  };
}

function moveSiblingBlocks(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  draggedBlocks: DraggedBlocks,
  target: DropTarget
): void {
  editor.update(() => {
    const parent = $getNodeByKey(draggedBlocks.parentKey);

    if (!$isElementNode(parent)) {
      return;
    }

    const units = $getSiblingBlockUnits(parent);
    const plan = getBlockMovePlan(units.map((unit) => unit.key), draggedBlocks.keys, target);

    if (!plan) {
      return;
    }

    $setSelection(null);
    const unitsByKey = new Map(units.map((unit) => [unit.key, unit]));
    const movingNodeKeys = plan.draggedKeys.flatMap((key) => unitsByKey.get(key)?.nodeKeys ?? []);
    const remainingUnits = plan.remainingKeys.flatMap((key) => {
      const unit = unitsByKey.get(key);
      return unit ? [unit] : [];
    });

    if (plan.insertAt < remainingUnits.length) {
      const anchor = $getNodeByKey(remainingUnits[plan.insertAt].nodeKeys[0]);

      if (!anchor) {
        return;
      }

      for (const key of movingNodeKeys) {
        const node = $getNodeByKey(key);

        if (node) {
          anchor.insertBefore(node, false);
        }
      }
      return;
    }

    const lastUnit = remainingUnits.at(-1);
    let anchor = lastUnit ? $getNodeByKey(lastUnit.nodeKeys.at(-1) ?? lastUnit.key) : null;

    if (!anchor) {
      return;
    }

    for (const key of movingNodeKeys) {
      const node = $getNodeByKey(key);

      if (node) {
        anchor.insertAfter(node, false);
        anchor = node;
      }
    }
  });
}

function getBlockMovePlan(
  unitKeys: NodeKey[],
  requestedDraggedKeys: NodeKey[],
  target: DropTarget
): { draggedKeys: NodeKey[]; remainingKeys: NodeKey[]; insertAt: number } | undefined {
  const draggedKeySet = new Set(requestedDraggedKeys);
  const draggedKeys = unitKeys.filter((key) => draggedKeySet.has(key));
  const targetIndex = unitKeys.indexOf(target.key);

  if (draggedKeys.length === 0 || targetIndex < 0) {
    return undefined;
  }

  const boundary = targetIndex + (target.placement === "after" ? 1 : 0);
  const remainingKeys = unitKeys.filter((key) => !draggedKeySet.has(key));
  const insertAt = unitKeys
    .slice(0, boundary)
    .filter((key) => !draggedKeySet.has(key)).length;
  const proposedKeys = [
    ...remainingKeys.slice(0, insertAt),
    ...draggedKeys,
    ...remainingKeys.slice(insertAt)
  ];

  return areNodeKeyListsEqual(unitKeys, proposedKeys)
    ? undefined
    : { draggedKeys, remainingKeys, insertAt };
}

function getBlockUnitRect(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  unit: BlockUnit
): DOMRect | undefined {
  const rects = unit.nodeKeys.flatMap((key): DOMRect[] => {
    const element = editor.getElementByKey(key);
    return element ? [element.getBoundingClientRect()] : [];
  });

  if (rects.length === 0) {
    return undefined;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

function getVisualBlockRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();

  if (element.tagName !== "LI") {
    return rect;
  }

  const nestedList = Array.from(element.children).find(
    (child): child is HTMLElement => child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL")
  );

  if (!nestedList) {
    return rect;
  }

  const nestedRect = nestedList.getBoundingClientRect();
  return new DOMRect(rect.left, rect.top, rect.width, Math.max(1, nestedRect.top - rect.top));
}

function distanceFromYToRect(y: number, rect: DOMRect): number {
  if (y < rect.top) {
    return rect.top - y;
  }

  if (y > rect.bottom) {
    return y - rect.bottom;
  }

  return 0;
}
