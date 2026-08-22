import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListType
} from "@lexical/list";
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

import {
  getUnitKeyInScope,
  resolveHierarchicalBlockSelection,
  type HierarchySelectionModel
} from "./blockSelectionModel";

type MdxEditorModule = typeof import("@mdxeditor/editor");
type DropPlacement = "before" | "after";

interface BlockHandle {
  key: NodeKey;
  depth: number;
  hotBottom: number;
  hotLeft: number;
  hotRight: number;
  hotTop: number;
  isListItem: boolean;
  left: number;
  rowKey: NodeKey;
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

interface LogicalBlockUnit extends BlockUnit {
  depth: number;
  hasOwnRow: boolean;
  kind: "block" | "container" | "list-item";
  listStart?: number;
  listType?: ListType;
  physicalParentKey: NodeKey;
  rowKey: NodeKey;
  scopeKey: NodeKey;
}

interface LogicalBlockScope {
  hostKey?: NodeKey;
  key: NodeKey;
  parentUnitKey?: NodeKey;
  structuralListRun?: {
    outerListKey: NodeKey;
    wrapperKeys: NodeKey[];
  };
  unitKeys: NodeKey[];
  units: LogicalBlockUnit[];
}

interface LogicalBlockTree extends HierarchySelectionModel {
  rootScopeKey: NodeKey;
  scopes: Map<NodeKey, LogicalBlockScope>;
  units: Map<NodeKey, LogicalBlockUnit>;
}

interface BlockSelectionHighlight {
  height: number;
  key: NodeKey;
  left: number;
  top: number;
  width: number;
}

interface DraggedBlocks {
  keys: NodeKey[];
  scopeKey: NodeKey;
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
const BLOCK_HANDLE_HEIGHT = 20;
const BLOCK_HANDLE_PAIR_WIDTH = 42;
const BLOCK_HANDLE_GAP = 6;
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
  const handlesRef = useRef<BlockHandle[]>([]);
  const selectedBlockKeysRef = useRef<NodeKey[]>([]);
  const selectedBlockScopeKeyRef = useRef<NodeKey | undefined>(undefined);
  const [rootElement, setRootElement] = useState<HTMLElement | undefined>();
  const [isEditable, setIsEditable] = useState(editor.isEditable());
  const [handles, setHandles] = useState<BlockHandle[]>([]);
  const [hoveredHandleKey, setHoveredHandleKey] = useState<NodeKey | undefined>();
  const [focusedHandleKey, setFocusedHandleKey] = useState<NodeKey | undefined>();
  const [selectedBlockKeys, setSelectedBlockKeys] = useState<NodeKey[]>([]);
  const [selectedBlockScopeKey, setSelectedBlockScopeKey] = useState<NodeKey | undefined>();
  const [selectionHighlights, setSelectionHighlights] = useState<BlockSelectionHighlight[]>([]);
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

  const commitBlockSelection = useCallback((scopeKey: NodeKey | undefined, nextKeys: NodeKey[]) => {
    const uniqueKeys = Array.from(new Set(nextKeys));
    const nextScopeKey = uniqueKeys.length > 0 ? scopeKey : undefined;

    if (
      selectedBlockScopeKeyRef.current === nextScopeKey &&
      areNodeKeyListsEqual(selectedBlockKeysRef.current, uniqueKeys)
    ) {
      return;
    }

    selectedBlockScopeKeyRef.current = nextScopeKey;
    selectedBlockKeysRef.current = uniqueKeys;
    setSelectedBlockScopeKey(nextScopeKey);
    setSelectedBlockKeys(uniqueKeys);
  }, []);

  const measureHandles = useCallback(() => {
    const root = rootElementRef.current;
    const layer = layerRef.current;
    const scroller = root?.parentElement;

    if (!root || !layer || !scroller) {
      handlesRef.current = [];
      setHandles([]);
      setSelectionHighlights([]);
      setSelectionGutter(undefined);
      return;
    }

    const tree = getLogicalBlockTree(editor);
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

    const selectedScope = selectedBlockScopeKeyRef.current
      ? tree.scopes.get(selectedBlockScopeKeyRef.current)
      : undefined;
    const validSelectedKeys = selectedScope
      ? selectedScope.units
          .map((unit) => unit.key)
          .filter((key) => selectedBlockKeysRef.current.includes(key))
      : [];

    if (
      selectedBlockScopeKeyRef.current !== selectedScope?.key ||
      !areNodeKeyListsEqual(selectedBlockKeysRef.current, validSelectedKeys)
    ) {
      commitBlockSelection(selectedScope?.key, validSelectedKeys);
    }

    const handleUnits = Array.from(tree.units.values()).filter((unit) => unit.hasOwnRow);

    const measuredHandles = handleUnits.flatMap((unit): BlockHandle[] => {
      const rowKey = unit.rowKey;

      const element = editor.getElementByKey(rowKey);

      if (!element) {
        return [];
      }

      const rect = getVisualBlockRect(element);

      if (rect.height <= 0 || rect.width <= 0) {
        return [];
      }

      const firstLineRect = getFirstLineRect(element, rect);
      const handleViewportTop = firstLineRect.top + Math.max(0, (firstLineRect.height - BLOCK_HANDLE_HEIGHT) / 2);
      const isDragSource = draggedBlocksRef.current?.sourceKey === unit.key;

      if (
        !isDragSource &&
        (handleViewportTop < scrollerRect.top ||
          handleViewportTop + BLOCK_HANDLE_HEIGHT > scrollerRect.bottom)
      ) {
        return [];
      }

      const anchorLeft = getBlockControlAnchorLeft(element, rect);
      const controlLeft = anchorLeft - BLOCK_HANDLE_GAP - BLOCK_HANDLE_PAIR_WIDTH;

      return [
        {
          key: unit.key,
          depth: unit.depth,
          hotBottom: rect.bottom + 3,
          hotLeft: controlLeft - 6,
          hotRight: Math.max(rect.right, anchorLeft),
          hotTop: rect.top - 3,
          isListItem: unit.kind === "list-item",
          left: Math.max(6, controlLeft - overlayRect.left),
          rowKey,
          top: handleViewportTop - overlayRect.top
        }
      ];
    });
    const nextHandles = measuredHandles.sort((left, right) => left.top - right.top || left.left - right.left);

    handlesRef.current = nextHandles;
    setHandles(nextHandles);
    setSelectionHighlights(
      validSelectedKeys.flatMap((key): BlockSelectionHighlight[] => {
        const unit = tree.units.get(key);
        const rect = unit ? getLogicalBlockUnitRect(editor, tree, unit) : undefined;

        if (!rect) {
          return [];
        }

        return [
          {
            key,
            height: rect.height,
            left: rect.left - overlayRect.left,
            top: rect.top - overlayRect.top,
            width: rect.width
          }
        ];
      })
    );
    setHoveredHandleKey((current) =>
      current && nextHandles.some((handle) => handle.key === current) ? current : undefined
    );
  }, [commitBlockSelection, editor]);

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
    setHoveredHandleKey(undefined);
    setFocusedHandleKey(undefined);
    commitBlockSelection(undefined, []);
  }, [commitBlockSelection, finishBlockDrag, isEditable]);

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

  useEffect(() => {
    requestMeasureHandles();
  }, [requestMeasureHandles, selectedBlockKeys, selectedBlockScopeKey]);

  useEffect(() => {
    const scroller = rootElement?.parentElement;

    if (!scroller || !isEditable) {
      return;
    }

    let hoverFrame: number | undefined;
    let pointerX = 0;
    let pointerY = 0;

    const updateHoveredHandle = () => {
      hoverFrame = undefined;
      const match = handlesRef.current
        .filter(
          (handle) =>
            pointerX >= handle.hotLeft &&
            pointerX <= handle.hotRight &&
            pointerY >= handle.hotTop &&
            pointerY <= handle.hotBottom
        )
        .sort(
          (left, right) =>
            right.depth - left.depth ||
            right.hotLeft - left.hotLeft ||
            left.hotBottom - left.hotTop - (right.hotBottom - right.hotTop)
        )[0];
      setHoveredHandleKey(match?.key);
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;

      if (hoverFrame === undefined) {
        hoverFrame = window.requestAnimationFrame(updateHoveredHandle);
      }
    };

    const handlePointerLeave = () => setHoveredHandleKey(undefined);

    scroller.addEventListener("pointermove", handlePointerMove, { passive: true });
    scroller.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      scroller.removeEventListener("pointermove", handlePointerMove);
      scroller.removeEventListener("pointerleave", handlePointerLeave);

      if (hoverFrame !== undefined) {
        window.cancelAnimationFrame(hoverFrame);
      }
    };
  }, [isEditable, rootElement]);

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
      let anchorBlockKey: NodeKey | undefined;

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
          commitBlockSelection(undefined, []);
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

        const tree = getLogicalBlockTree(editor);
        const intersectingBlocks = Array.from(tree.units.values()).flatMap(
          (unit): Array<{ depth: number; key: NodeKey; rect: DOMRect }> => {
            if (!unit.hasOwnRow) {
              return [];
            }

            const element = editor.getElementByKey(unit.rowKey);

            if (!element) {
              return [];
            }

            const rect = getVisualBlockRect(element);
            return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom
              ? [{ depth: unit.depth, key: unit.key, rect }]
              : [];
          }
        );

        if (!anchorBlockKey && intersectingBlocks.length > 0) {
          const anchorBlock = intersectingBlocks.reduce((closest, candidate) => {
            const closestDistance = distanceFromYToRect(startY, closest.rect);
            const candidateDistance = distanceFromYToRect(startY, candidate.rect);
            return candidateDistance < closestDistance ||
              (candidateDistance === closestDistance && candidate.depth > closest.depth)
              ? candidate
              : closest;
          });
          anchorBlockKey = anchorBlock.key;
        }

        const selection = anchorBlockKey
          ? resolveHierarchicalBlockSelection(
              tree,
              anchorBlockKey,
              intersectingBlocks.map((block) => block.key)
            )
          : undefined;
        commitBlockSelection(selection?.scopeKey, selection?.keys ?? []);
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
    [commitBlockSelection, editor]
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

      commitBlockSelection(undefined, []);
    };

    scroller.addEventListener("pointerdown", clearBlockSelection, true);
    return () => scroller.removeEventListener("pointerdown", clearBlockSelection, true);
  }, [commitBlockSelection, rootElement]);

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

      const logicalScopeKey = getLogicalBlockTree(editor).units.get(blockKey)?.scopeKey;
      commitBlockSelection(logicalScopeKey, orderedKeys);
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
    [commitBlockSelection, editor]
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
              commitBlockSelection(undefined, []);
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
    [commandMenu, commitBlockSelection, editor, editorModule, realm]
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

      moveLogicalBlocks(editor, draggedBlocks, target);
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
      {selectionHighlights.map((highlight) => (
        <div
          aria-hidden="true"
          className="markflow-block-selection-highlight"
          data-block-key={highlight.key}
          key={highlight.key}
          style={{
            height: `${highlight.height}px`,
            left: `${highlight.left}px`,
            top: `${highlight.top}px`,
            width: `${highlight.width}px`
          }}
        />
      ))}
      {isEditable ? handles.map((handle) => (
        <div
          key={handle.key}
          className="markflow-block-controls"
          data-block-key={handle.key}
          data-depth={handle.depth}
          data-dragging={draggedBlocksRef.current?.sourceKey === handle.key || undefined}
          data-selected={selectedBlockKeys.includes(handle.key)}
          data-visible={
            hoveredHandleKey === handle.key ||
            focusedHandleKey === handle.key ||
            selectedBlockKeys.includes(handle.key) ||
            draggedBlocksRef.current?.sourceKey === handle.key ||
            commandMenu?.targetKey === handle.key ||
            undefined
          }
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setFocusedHandleKey((current) => (current === handle.key ? undefined : current));
            }
          }}
          onFocusCapture={() => setFocusedHandleKey(handle.key)}
          style={{ left: `${handle.left}px`, top: `${handle.top}px` }}
        >
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
          <button
            aria-label="Drag block"
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

              const tree = getLogicalBlockTree(editor);
              const unit = tree.units.get(handle.key);

              if (!unit) {
                event.preventDefault();
                return;
              }

              const currentScopeKey = selectedBlockScopeKeyRef.current;
              const selectedUnitKey = currentScopeKey
                ? getUnitKeyInScope(tree, handle.key, currentScopeKey)
                : undefined;
              const useCurrentSelection = Boolean(
                currentScopeKey &&
                selectedUnitKey &&
                selectedBlockKeysRef.current.includes(selectedUnitKey)
              );
              const scopeKey = useCurrentSelection ? currentScopeKey : unit.scopeKey;
              const scope = scopeKey ? tree.scopes.get(scopeKey) : undefined;
              const selectedKeys = useCurrentSelection ? selectedBlockKeysRef.current : [unit.key];

              if (!scope) {
                event.preventDefault();
                return;
              }

              const orderedKeys = scope.units
                .map((unit) => unit.key)
                .filter((key) => selectedKeys.includes(key));

              if (orderedKeys.length === 0) {
                event.preventDefault();
                return;
              }

              const draggedBlocks = { keys: orderedKeys, scopeKey: scope.key, sourceKey: handle.key };
              draggedBlocksRef.current = draggedBlocks;
              commitBlockSelection(scope.key, orderedKeys);
              const sourceElement = event.currentTarget;
              const handleNativeDragEnd = () => finishBlockDrag();
              nativeDragEndCleanupRef.current?.();
              sourceElement.addEventListener("dragend", handleNativeDragEnd, { once: true });
              nativeDragEndCleanupRef.current = () => sourceElement.removeEventListener("dragend", handleNativeDragEnd);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(BLOCK_DRAG_DATA_FORMAT, JSON.stringify(draggedBlocks));
            }}
            onContextMenu={handle.isListItem ? undefined : (event) => openTurnIntoMenu(event, handle.key)}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }

              const tree = getLogicalBlockTree(editor);
              const unit = tree.units.get(handle.key);

              if (!unit) {
                return;
              }

              const currentKeys = selectedBlockKeysRef.current;
              const currentScopeKey = selectedBlockScopeKeyRef.current;
              const scope = tree.scopes.get(unit.scopeKey);

              if (!scope) {
                return;
              }

              const siblingKeys = scope.units.map((unit) => unit.key);
              const siblingKeySet = new Set(siblingKeys);

              if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const selectedSiblingKeys = currentScopeKey === scope.key
                  ? currentKeys.filter((key) => siblingKeySet.has(key))
                  : [];
                commitBlockSelection(
                  scope.key,
                  selectedSiblingKeys.includes(handle.key)
                    ? selectedSiblingKeys.filter((key) => key !== handle.key)
                    : siblingKeys.filter((key) => [...selectedSiblingKeys, handle.key].includes(key))
                );
                return;
              }

              const selectedUnitKey = currentScopeKey
                ? getUnitKeyInScope(tree, handle.key, currentScopeKey)
                : undefined;

              if (!selectedUnitKey || !currentKeys.includes(selectedUnitKey)) {
                commitBlockSelection(scope.key, [handle.key]);
              }
            }}
            title={handle.isListItem ? "Drag list item" : "Drag block · Right-click to change type"}
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

function getLogicalBlockTree(editor: ReturnType<typeof useLexicalComposerContext>[0]): LogicalBlockTree {
  let tree: LogicalBlockTree | undefined;

  editor.getEditorState().read(() => {
    tree = $buildLogicalBlockTree();
  });

  if (!tree) {
    throw new Error("The logical block tree could not be read.");
  }

  return tree;
}

function $buildLogicalBlockTree(): LogicalBlockTree {
  const root = $getRoot();
  const scopes = new Map<NodeKey, LogicalBlockScope>();
  const units = new Map<NodeKey, LogicalBlockUnit>();

  $buildLogicalScope(root, root.getKey(), undefined, 0, scopes, units);
  return { rootScopeKey: root.getKey(), scopes, units };
}

function $buildLogicalScope(
  host: LexicalNode,
  scopeKey: NodeKey,
  parentUnitKey: NodeKey | undefined,
  depth: number,
  scopes: Map<NodeKey, LogicalBlockScope>,
  units: Map<NodeKey, LogicalBlockUnit>
): LogicalBlockScope {
  const scope: LogicalBlockScope = {
    hostKey: host.getKey(),
    key: scopeKey,
    parentUnitKey,
    unitKeys: [],
    units: []
  };
  scopes.set(scopeKey, scope);

  if (!$isElementNode(host)) {
    return scope;
  }

  for (const node of host.getChildren()) {
    if ($isListNode(node)) {
      $appendLogicalListUnits(node, scope, depth, scopes, units);
      continue;
    }

    $appendLogicalNodeUnit(node, scope, depth, scopes, units);
  }

  scope.unitKeys = scope.units.map((unit) => unit.key);
  return scope;
}

function $appendLogicalNodeUnit(
  node: LexicalNode,
  scope: LogicalBlockScope,
  depth: number,
  scopes: Map<NodeKey, LogicalBlockScope>,
  units: Map<NodeKey, LogicalBlockUnit>
): void {
  const childBlocks = $isQuoteNode(node)
    ? node.getChildren().filter((child) => !child.isInline())
    : [];
  const isContainer = childBlocks.length > 0;
  const unit: LogicalBlockUnit = {
    depth,
    hasOwnRow: !isContainer,
    key: node.getKey(),
    kind: isContainer ? "container" : "block",
    nodeKeys: [node.getKey()],
    physicalParentKey: scope.hostKey ?? scope.key,
    rowKey: node.getKey(),
    scopeKey: scope.key
  };
  scope.units.push(unit);
  units.set(unit.key, unit);

  if (isContainer) {
    $buildLogicalScope(node, unit.key, unit.key, depth + 1, scopes, units);
  }
}

function $appendLogicalListUnits(
  list: LexicalNode,
  scope: LogicalBlockScope,
  depth: number,
  scopes: Map<NodeKey, LogicalBlockScope>,
  units: Map<NodeKey, LogicalBlockUnit>
): void {
  if (!$isListNode(list)) {
    return;
  }

  const listUnits = $getSiblingBlockUnits(list);

  if (listUnits.length === 0) {
    $appendLogicalNodeUnit(list, scope, depth, scopes, units);
    return;
  }

  for (const blockUnit of listUnits) {
    const listItem = $getNodeByKey(blockUnit.key);

    if (!$isListItemNode(listItem)) {
      continue;
    }

    const unit: LogicalBlockUnit = {
      ...blockUnit,
      depth,
      hasOwnRow: true,
      kind: "list-item",
      listStart: list.getStart(),
      listType: list.getListType(),
      physicalParentKey: list.getKey(),
      rowKey: listItem.getKey(),
      scopeKey: scope.key
    };
    scope.units.push(unit);
    units.set(unit.key, unit);

    const nestedLists = blockUnit.nodeKeys.flatMap((nodeKey): LexicalNode[] => {
      const unitNode = $getNodeByKey(nodeKey);

      if (!$isElementNode(unitNode)) {
        return [];
      }

      return unitNode.getChildren().filter($isListNode);
    });

    if (nestedLists.length === 0) {
      continue;
    }

    const childScope: LogicalBlockScope = {
      hostKey: nestedLists.length === 1 ? nestedLists[0].getKey() : undefined,
      key: unit.key,
      parentUnitKey: unit.key,
      structuralListRun: nestedLists.length > 1
        ? $getStructuralListRun(nestedLists, blockUnit.nodeKeys)
        : undefined,
      unitKeys: [],
      units: []
    };
    scopes.set(childScope.key, childScope);

    for (const nestedList of nestedLists) {
      $appendLogicalListUnits(nestedList, childScope, depth + 1, scopes, units);
    }

    childScope.unitKeys = childScope.units.map((childUnit) => childUnit.key);
  }
}

function $getStructuralListRun(
  nestedLists: LexicalNode[],
  ownerNodeKeys: NodeKey[]
): LogicalBlockScope["structuralListRun"] {
  const ownerNodeKeySet = new Set(ownerNodeKeys);
  const wrappers = nestedLists.flatMap((nestedList): ListItemNode[] => {
    const wrapper = nestedList.getParent();
    return $isListItemNode(wrapper) && isStructuralListItem(wrapper) ? [wrapper] : [];
  });

  if (wrappers.length !== nestedLists.length || wrappers.some((wrapper) => !ownerNodeKeySet.has(wrapper.getKey()))) {
    return undefined;
  }

  const outerList = wrappers[0]?.getParent();

  if (!$isListNode(outerList) || wrappers.some((wrapper) => !wrapper.getParent()?.is(outerList))) {
    return undefined;
  }

  const outerKeys = outerList.getChildrenKeys();
  const firstIndex = outerKeys.indexOf(wrappers[0].getKey());

  if (
    firstIndex < 0 ||
    wrappers.some((wrapper, index) => outerKeys[firstIndex + index] !== wrapper.getKey())
  ) {
    return undefined;
  }

  return {
    outerListKey: outerList.getKey(),
    wrapperKeys: wrappers.map((wrapper) => wrapper.getKey())
  };
}

function getFirstVisibleDescendantRowKey(tree: LogicalBlockTree, unitKey: NodeKey): NodeKey | undefined {
  const unit = tree.units.get(unitKey);

  if (!unit) {
    return undefined;
  }

  if (unit.hasOwnRow) {
    return unit.rowKey;
  }

  const childScope = tree.scopes.get(unit.key);

  for (const child of childScope?.units ?? []) {
    const rowKey = getFirstVisibleDescendantRowKey(tree, child.key);

    if (rowKey) {
      return rowKey;
    }
  }

  return undefined;
}

function getLogicalBlockUnitRect(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  tree: LogicalBlockTree,
  unit: LogicalBlockUnit
): DOMRect | undefined {
  const rects = unit.nodeKeys.flatMap((key): DOMRect[] => {
    const element = editor.getElementByKey(key);
    return element ? [element.getBoundingClientRect()] : [];
  });
  const childScope = tree.scopes.get(unit.key);

  for (const child of childScope?.units ?? []) {
    const childRect = getLogicalBlockUnitRect(editor, tree, child);

    if (childRect) {
      rects.push(childRect);
    }
  }

  const rect = unionClientRects(rects);

  if (!rect || unit.kind !== "list-item") {
    return rect;
  }

  const rowElement = editor.getElementByKey(unit.rowKey);
  const listElement = rowElement?.parentElement;

  if (listElement?.tagName !== "UL" && listElement?.tagName !== "OL") {
    return rect;
  }

  const listRect = listElement.getBoundingClientRect();
  const left = Math.min(rect.left, listRect.left);
  return new DOMRect(left, rect.top, rect.right - left, rect.height);
}

function getFirstLineRect(element: HTMLElement, fallbackRect: DOMRect): DOMRect {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();

  while (textNode) {
    if (textNode.textContent?.trim()) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = Array.from(range.getClientRects()).find(
        (candidate) =>
          candidate.height > 0 &&
          candidate.bottom > fallbackRect.top &&
          candidate.top < fallbackRect.bottom
      );

      if (rect) {
        return rect;
      }
    }

    textNode = walker.nextNode();
  }

  const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight) || fallbackRect.height;
  return new DOMRect(fallbackRect.left, fallbackRect.top, fallbackRect.width, Math.min(fallbackRect.height, lineHeight));
}

function getBlockControlAnchorLeft(element: HTMLElement, fallbackRect: DOMRect): number {
  const quote = element.closest("blockquote");

  if (quote) {
    if (element.tagName !== "LI") {
      return quote.getBoundingClientRect().left;
    }

    const lists: HTMLElement[] = [];
    let ancestor = element.parentElement;

    while (ancestor && ancestor !== quote) {
      if (ancestor.tagName === "UL" || ancestor.tagName === "OL") {
        lists.push(ancestor);
      }

      ancestor = ancestor.parentElement;
    }

    const innerListRect = lists[0]?.getBoundingClientRect();
    const outerListRect = lists.at(-1)?.getBoundingClientRect();

    if (innerListRect && outerListRect) {
      return quote.getBoundingClientRect().left + Math.max(0, innerListRect.left - outerListRect.left);
    }

    return quote.getBoundingClientRect().left;
  }

  if (element.tagName === "LI") {
    const list = element.parentElement;

    if (list?.tagName === "UL" || list?.tagName === "OL") {
      return list.getBoundingClientRect().left;
    }
  }

  return fallbackRect.left;
}

function unionClientRects(rects: DOMRect[]): DOMRect | undefined {
  if (rects.length === 0) {
    return undefined;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
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

function getDropTarget(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  clientY: number,
  draggedBlocks: DraggedBlocks
): DropTarget | undefined {
  const tree = getLogicalBlockTree(editor);
  const scope = tree.scopes.get(draggedBlocks.scopeKey);

  if (
    !scope ||
    (!scope.hostKey && !scope.structuralListRun) ||
    !scope.units.some((unit) => draggedBlocks.keys.includes(unit.key))
  ) {
    return undefined;
  }

  let target: DropTarget | undefined;

  for (const unit of scope.units) {
    const rect = getLogicalBlockUnitRect(editor, tree, unit);

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
  const tree = getLogicalBlockTree(editor);
  const targetUnit = tree.units.get(target.key);
  const rowKey = targetUnit
    ? targetUnit.hasOwnRow
      ? targetUnit.rowKey
      : getFirstVisibleDescendantRowKey(tree, targetUnit.key)
    : undefined;
  const targetElement = rowKey ? editor.getElementByKey(rowKey) : null;
  const root = editor.getRootElement();

  if (!targetElement || !targetUnit || !root || !layer) {
    return undefined;
  }

  const targetRect = getLogicalBlockUnitRect(editor, tree, targetUnit);
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

function moveLogicalBlocks(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  draggedBlocks: DraggedBlocks,
  target: DropTarget
): void {
  editor.update(() => {
    const tree = $buildLogicalBlockTree();
    const scope = tree.scopes.get(draggedBlocks.scopeKey);
    const plan = scope
      ? getBlockMovePlan(scope.units.map((unit) => unit.key), draggedBlocks.keys, target)
      : undefined;

    if (!scope || !plan) {
      return;
    }

    $setSelection(null);

    if (scope.structuralListRun) {
      $moveLogicalUnitsInStructuralListRun(scope, plan, scope.structuralListRun);
      return;
    }

    const withinParentKey = getWithinPhysicalParentMoveKey(scope, plan);

    if (withinParentKey) {
      $moveLogicalUnitsWithinParent(scope, plan, withinParentKey);
      return;
    }

    $moveLogicalUnitsAcrossTransparentLists(scope, plan);
  });
}

function $moveLogicalUnitsInStructuralListRun(
  scope: LogicalBlockScope,
  plan: { draggedKeys: NodeKey[]; remainingKeys: NodeKey[]; insertAt: number },
  host: NonNullable<LogicalBlockScope["structuralListRun"]>
): void {
  const outerList = $getNodeByKey(host.outerListKey);
  const wrappers = host.wrapperKeys.flatMap((key): ListItemNode[] => {
    const wrapper = $getNodeByKey(key);
    return $isListItemNode(wrapper) && isStructuralListItem(wrapper) ? [wrapper] : [];
  });

  if (
    !$isListNode(outerList) ||
    wrappers.length !== host.wrapperKeys.length ||
    wrappers.some((wrapper) => !wrapper.getParent()?.is(outerList))
  ) {
    return;
  }

  const outerKeys = outerList.getChildrenKeys();
  const firstWrapperIndex = outerKeys.indexOf(host.wrapperKeys[0]);

  if (
    firstWrapperIndex < 0 ||
    host.wrapperKeys.some((key, index) => outerKeys[firstWrapperIndex + index] !== key)
  ) {
    return;
  }

  const desiredKeys = [
    ...plan.remainingKeys.slice(0, plan.insertAt),
    ...plan.draggedKeys,
    ...plan.remainingKeys.slice(plan.insertAt)
  ];
  const unitsByKey = new Map(scope.units.map((unit) => [unit.key, unit]));
  const wrapperKeySet = new Set(host.wrapperKeys);
  const records = desiredKeys.flatMap((key) => {
    const unit = unitsByKey.get(key);
    const sourceList = unit ? $getNodeByKey(unit.physicalParentKey) : null;
    const sourceWrapper = sourceList?.getParent();
    const nodes = unit?.nodeKeys.flatMap((nodeKey): LexicalNode[] => {
      const node = $getNodeByKey(nodeKey);
      return node ? [node] : [];
    }) ?? [];

    if (
      !unit ||
      unit.kind !== "list-item" ||
      !unit.listType ||
      !$isListNode(sourceList) ||
      !$isListItemNode(sourceWrapper) ||
      !wrapperKeySet.has(sourceWrapper.getKey()) ||
      nodes.length !== unit.nodeKeys.length
    ) {
      return [];
    }

    return [{ nodes, sourceList, unit }];
  });

  if (records.length !== desiredKeys.length) {
    return;
  }

  const replacementWrappers: ListItemNode[] = [];
  let currentList: ReturnType<typeof $createListNode> | undefined;

  for (const record of records) {
    if (!currentList || currentList.getListType() !== record.unit.listType) {
      currentList = $createListNode(record.unit.listType, record.unit.listStart ?? 1);
      copyListPresentation(record.sourceList, currentList);
      const wrapper = $createListItemNode();
      wrapper.append(currentList);
      replacementWrappers.push(wrapper);
    }

    currentList.append(...record.nodes);
  }

  outerList.splice(firstWrapperIndex, host.wrapperKeys.length, replacementWrappers);
}

function getWithinPhysicalParentMoveKey(
  scope: LogicalBlockScope,
  plan: { draggedKeys: NodeKey[]; remainingKeys: NodeKey[]; insertAt: number }
): NodeKey | undefined {
  const unitsByKey = new Map(scope.units.map((unit) => [unit.key, unit]));
  const movingUnits = plan.draggedKeys.flatMap((key) => {
    const unit = unitsByKey.get(key);
    return unit ? [unit] : [];
  });
  const physicalParentKeys = new Set(movingUnits.map((unit) => unit.physicalParentKey));

  if (movingUnits.length !== plan.draggedKeys.length || physicalParentKeys.size !== 1) {
    return undefined;
  }

  const physicalParentKey = movingUnits[0].physicalParentKey;
  const remainingUnits = plan.remainingKeys.flatMap((key) => {
    const unit = unitsByKey.get(key);
    return unit ? [unit] : [];
  });
  const rightUnit = remainingUnits[plan.insertAt];
  const leftUnit = remainingUnits[plan.insertAt - 1];

  return scope.units.every((unit) => unit.physicalParentKey === physicalParentKey) ||
    rightUnit?.physicalParentKey === physicalParentKey ||
    leftUnit?.physicalParentKey === physicalParentKey
    ? physicalParentKey
    : undefined;
}

function $moveLogicalUnitsWithinParent(
  scope: LogicalBlockScope,
  plan: { draggedKeys: NodeKey[]; remainingKeys: NodeKey[]; insertAt: number },
  physicalParentKey: NodeKey
): void {
  const parent = $getNodeByKey(physicalParentKey);

  if (!$isElementNode(parent)) {
    return;
  }

  const unitsByKey = new Map(scope.units.map((unit) => [unit.key, unit]));
  const movingNodeKeys = plan.draggedKeys.flatMap((key) => unitsByKey.get(key)?.nodeKeys ?? []);
  const remainingUnits = plan.remainingKeys.flatMap((key) => {
    const unit = unitsByKey.get(key);
    return unit ? [unit] : [];
  });
  const rightUnit = remainingUnits[plan.insertAt];
  const leftUnit = remainingUnits[plan.insertAt - 1];

  if (rightUnit?.physicalParentKey === physicalParentKey) {
    const anchor = $getNodeByKey(rightUnit.nodeKeys[0]);

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

  let anchor = leftUnit?.physicalParentKey === physicalParentKey
    ? $getNodeByKey(leftUnit.nodeKeys.at(-1) ?? leftUnit.key)
    : null;

  if (!anchor) {
    if (remainingUnits.some((unit) => unit.physicalParentKey === physicalParentKey)) {
      return;
    }

    for (const key of movingNodeKeys) {
      const node = $getNodeByKey(key);

      if (node) {
        parent.append(node);
      }
    }
    return;
  }

  for (const key of movingNodeKeys) {
    const node = $getNodeByKey(key);

    if (node) {
      anchor.insertAfter(node, false);
      anchor = node;
    }
  }
}

function $moveLogicalUnitsAcrossTransparentLists(
  scope: LogicalBlockScope,
  plan: { draggedKeys: NodeKey[]; remainingKeys: NodeKey[]; insertAt: number }
): void {
  const host = scope.hostKey ? $getNodeByKey(scope.hostKey) : null;
  const unitsByKey = new Map(scope.units.map((unit) => [unit.key, unit]));
  const movingUnits = plan.draggedKeys.flatMap((key) => {
    const unit = unitsByKey.get(key);
    return unit ? [unit] : [];
  });
  const remainingUnits = plan.remainingKeys.flatMap((key) => {
    const unit = unitsByKey.get(key);
    return unit ? [unit] : [];
  });
  const rightUnit = remainingUnits[plan.insertAt];
  const leftUnit = remainingUnits[plan.insertAt - 1];
  const rightNode = rightUnit ? $getNodeByKey(rightUnit.nodeKeys[0]) : null;
  const leftNode = leftUnit
    ? $getNodeByKey(leftUnit.nodeKeys.at(-1) ?? leftUnit.key)
    : null;

  if (
    movingUnits.length !== plan.draggedKeys.length ||
    !$isElementNode(host) ||
    (rightUnit !== undefined && !rightNode) ||
    (leftUnit !== undefined && !leftNode)
  ) {
    return;
  }

  const records = movingUnits.map((unit, index) => {
    const nodes = unit.nodeKeys.flatMap((key): LexicalNode[] => {
      const node = $getNodeByKey(key);
      return node ? [node] : [];
    });
    const sourceList = unit.kind === "list-item" ? $getNodeByKey(unit.physicalParentKey) : null;
    const previousUnit = movingUnits[index - 1];
    const previousLastNode = previousUnit
      ? $getNodeByKey(previousUnit.nodeKeys.at(-1) ?? previousUnit.key)
      : null;
    return {
      joinsPrevious:
        unit.kind === "list-item" &&
        previousUnit?.kind === "list-item" &&
        previousUnit.physicalParentKey === unit.physicalParentKey &&
        previousLastNode?.getNextSibling()?.getKey() === nodes[0]?.getKey(),
      nodes,
      sourceList: $isListNode(sourceList) ? sourceList : undefined,
      unit
    };
  });

  if (records.some((record) => record.nodes.length !== record.unit.nodeKeys.length)) {
    return;
  }

  const sourceLists = new Set(records.flatMap((record) => (record.sourceList ? [record.sourceList] : [])));
  const segments: LexicalNode[] = [];
  let currentListFragment: ReturnType<typeof $createListNode> | undefined;

  for (const record of records) {
    if (record.unit.kind !== "list-item" || !record.sourceList || !record.unit.listType) {
      currentListFragment = undefined;
      const node = record.nodes[0];

      if (node) {
        segments.push(node);
      }
      continue;
    }

    if (!record.joinsPrevious || !currentListFragment || currentListFragment.getListType() !== record.unit.listType) {
      currentListFragment = $createListNode(record.unit.listType, record.unit.listStart ?? 1);
      copyListPresentation(record.sourceList, currentListFragment);
      segments.push(currentListFragment);
    }

    currentListFragment.append(...record.nodes);
  }

  for (const sourceList of sourceLists) {
    if (sourceList.getChildrenSize() === 0) {
      sourceList.remove();
    }
  }

  if (segments.length === 0) {
    return;
  }

  let anchor = segments[0];

  if (rightUnit && rightNode) {
    if (rightUnit.kind === "list-item") {
      const previousNode = rightNode.getPreviousSibling();
      const targetList = rightNode.getParent();

      if ($isListItemNode(previousNode)) {
        previousNode.insertAfter(anchor, false);
      } else if ($isListNode(targetList)) {
        targetList.insertBefore(anchor, false);
      } else {
        return;
      }
    } else {
      rightNode.insertBefore(anchor, false);
    }
  } else if (leftUnit && leftNode) {
    leftNode.insertAfter(anchor, false);
  } else {
    host.append(anchor);
  }

  for (const segment of segments.slice(1)) {
    anchor.insertAfter(segment, false);
    anchor = segment;
  }
}

function copyListPresentation(
  source: ReturnType<typeof $createListNode>,
  target: ReturnType<typeof $createListNode>
): void {
  target.setDirection(source.getDirection());
  target.setFormat(source.getFormatType());
  target.setIndent(source.getIndent());
  target.setTextFormat(source.getTextFormat());
  target.setTextStyle(source.getTextStyle());
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
