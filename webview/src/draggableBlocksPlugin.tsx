import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import type { RealmPlugin } from "@mdxeditor/editor";
import type { Realm } from "@mdxeditor/gurx";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
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
  type MouseEvent as ReactMouseEvent
} from "react";
import { createPortal } from "react-dom";

type MdxEditorModule = typeof import("@mdxeditor/editor");
type DropPlacement = "before" | "after";

interface BlockHandle {
  key: NodeKey;
  left: number;
  top: number;
}

interface SlashMarker {
  textNodeKey: NodeKey;
  offset: number;
}

interface CommandMenuState {
  targetKey: NodeKey;
  left: number;
  top: number;
  source: "plus" | "slash";
  slashMarker?: SlashMarker;
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
  const draggedBlockKeyRef = useRef<NodeKey | undefined>(undefined);
  const commandMenuRef = useRef<CommandMenuState | undefined>(undefined);
  const ignoredSlashMarkerRef = useRef<SlashMarker | undefined>(undefined);
  const [rootElement, setRootElement] = useState<HTMLElement | undefined>();
  const [isEditable, setIsEditable] = useState(editor.isEditable());
  const [handles, setHandles] = useState<BlockHandle[]>([]);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | undefined>();
  const [commandMenu, setCommandMenu] = useState<CommandMenuState | undefined>();
  const [commandQuery, setCommandQuery] = useState("");
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = commandQuery.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return BLOCK_COMMANDS;
    }

    return BLOCK_COMMANDS.filter((command) =>
      `${command.label} ${command.description} ${command.keywords}`.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [commandQuery]);

  const measureHandles = useCallback(() => {
    const root = rootElementRef.current;
    const layer = layerRef.current;

    if (!root || !layer) {
      setHandles([]);
      return;
    }

    let blockKeys: NodeKey[] = [];
    editor.getEditorState().read(() => {
      blockKeys = $getRoot().getChildrenKeys();
    });

    const overlayRect = layer.getBoundingClientRect();
    const nextHandles = blockKeys.flatMap((key): BlockHandle[] => {
      const element = editor.getElementByKey(key);

      if (!element) {
        return [];
      }

      const rect = element.getBoundingClientRect();

      if (rect.height <= 0 || rect.width <= 0) {
        return [];
      }

      return [
        {
          key,
          left: Math.max(6, rect.left - overlayRect.left - 58),
          top: rect.top - overlayRect.top + 2
        }
      ];
    });

    setHandles(nextHandles);
  }, [editor]);

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
    draggedBlockKeyRef.current = undefined;
    setCommandMenu(undefined);
    setCommandQuery("");
    setActiveCommandIndex(0);
    setDropIndicator(undefined);
  }, [isEditable]);

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

  const closeCommandMenu = useCallback(
    (options: { insertSpace?: boolean; restoreFocus?: boolean } = {}) => {
      const menu = commandMenu;
      commandMenuRef.current = undefined;

      if (menu?.slashMarker) {
        ignoredSlashMarkerRef.current = menu.slashMarker;
      }

      setCommandMenu(undefined);
      setCommandQuery("");
      setActiveCommandIndex(0);

      if (!menu || (!options.insertSpace && !options.restoreFocus)) {
        return;
      }

      editor.update(
        () => {
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
      editor.getEditorState().read(() => {
        blockExists = $getNodeByKey(blockKey) !== null;
      });

      const blockElement = editor.getElementByKey(blockKey);

      if (!blockExists || !blockElement) {
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

      editor.update(
        () => {
          if (menu.slashMarker) {
            const slashTextNode = $getNodeByKey(menu.slashMarker.textNodeKey);

            if (!$isTextNode(slashTextNode) || slashTextNode.getTextContent()[menu.slashMarker.offset] !== "/") {
              return;
            }

            slashTextNode.spliceText(menu.slashMarker.offset, 1, "");
          }

          const menuTargetNode = $getNodeByKey(menu.targetKey);

          if (!menuTargetNode) {
            return;
          }

          const targetNode =
            menu.source === "plus"
              ? (() => {
                  const paragraph = $createParagraphNode();
                  menuTargetNode.insertAfter(paragraph);
                  return paragraph;
                })()
              : menuTargetNode;

          commandTargetKey = targetNode.getKey();
          selectNodeStart(targetNode);
        },
        {
          onUpdate: () => {
            const targetKey = commandTargetKey;

            if (!targetKey) {
              return;
            }

            if (!editor.isEditable()) {
              removeEmptyParagraph(editor, targetKey);
              return;
            }

            editor.focus(() => {
              publishBlockCommand(editor, editorModule, realm, command.id, targetKey);
            });
          }
        }
      );
    },
    [commandMenu, editor, editorModule, realm]
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

    const handleNativeDragOver = (event: globalThis.DragEvent) => {
      if (!editor.isEditable() || !draggedBlockKeyRef.current) {
        return;
      }

      const target = getDropTarget(editor, event.clientY);

      if (!target) {
        setDropIndicator(undefined);
        return;
      }

      event.preventDefault();
      setDropIndicator(getDropIndicator(editor, target, layerRef.current));
    };

    const handleNativeDrop = (event: globalThis.DragEvent) => {
      if (!editor.isEditable()) {
        draggedBlockKeyRef.current = undefined;
        setDropIndicator(undefined);
        return;
      }

      const draggedBlockKey =
        event.dataTransfer?.getData(BLOCK_DRAG_DATA_FORMAT) || draggedBlockKeyRef.current || undefined;
      const target = getDropTarget(editor, event.clientY);

      if (!draggedBlockKey || !target) {
        return;
      }

      event.preventDefault();
      moveBlock(editor, draggedBlockKey, target);
      draggedBlockKeyRef.current = undefined;
      setDropIndicator(undefined);
      requestMeasureHandles();
    };

    scroller.addEventListener("dragover", handleNativeDragOver, true);
    scroller.addEventListener("drop", handleNativeDrop, true);

    return () => {
      scroller.removeEventListener("dragover", handleNativeDragOver, true);
      scroller.removeEventListener("drop", handleNativeDrop, true);
    };
  }, [editor, requestMeasureHandles, rootElement]);

  if (!rootElement) {
    return null;
  }

  return (
    <div ref={layerRef} className="markflow-block-handle-layer" contentEditable={false}>
      {isEditable ? handles.map((handle) => (
        <div
          key={handle.key}
          className="markflow-block-controls"
          style={{ left: `${handle.left}px`, top: `${handle.top}px` }}
        >
          <button
            aria-label="Add block below"
            className="markflow-block-add-button"
            onClick={() => openMenuAfterBlock(handle.key)}
            title="Add block below"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
          <button
            aria-label="Drag block"
            className="markflow-block-drag-handle"
            draggable
            onDragEnd={() => {
              draggedBlockKeyRef.current = undefined;
              setDropIndicator(undefined);
            }}
            onDragStart={(event: DragEvent<HTMLButtonElement>) => {
              if (!editor.isEditable()) {
                event.preventDefault();
                return;
              }

              draggedBlockKeyRef.current = handle.key;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(BLOCK_DRAG_DATA_FORMAT, handle.key);
            }}
            title="Drag block"
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
          aria-label="Block menu"
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
              placeholder="Search blocks..."
              role="combobox"
              spellCheck={false}
              value={commandQuery}
            />
          </label>
          <div className="markflow-block-command-caption">Basic blocks</div>
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
            <p className="markflow-block-command-hint">Press Space to close</p>
          ) : null}
        </section>,
        document.body
      ) : null}
    </div>
  );
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
  targetKey: NodeKey
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
        const targetNode = $getNodeByKey(targetKey);

        if (!targetNode) {
          return;
        }

        const codeBlock = editorModule.$createCodeBlockNode({
          code: targetNode.getTextContent(),
          language: "txt"
        });
        targetNode.replace(codeBlock);
        codeBlock.select();
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

function getTopLevelBlockKeys(editor: ReturnType<typeof useLexicalComposerContext>[0]): NodeKey[] {
  let blockKeys: NodeKey[] = [];

  editor.getEditorState().read(() => {
    blockKeys = $getRoot().getChildrenKeys();
  });

  return blockKeys;
}

function getDropTarget(editor: ReturnType<typeof useLexicalComposerContext>[0], clientY: number): DropTarget | undefined {
  const blockKeys = getTopLevelBlockKeys(editor);
  let lastVisibleKey: NodeKey | undefined;

  for (const key of blockKeys) {
    const element = editor.getElementByKey(key);

    if (!element) {
      continue;
    }

    const rect = element.getBoundingClientRect();

    if (rect.height <= 0 || rect.width <= 0) {
      continue;
    }

    lastVisibleKey = key;

    if (clientY < rect.top + rect.height / 2) {
      return { key, placement: "before" };
    }
  }

  return lastVisibleKey ? { key: lastVisibleKey, placement: "after" } : undefined;
}

function getDropIndicator(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  target: DropTarget,
  layer: HTMLDivElement | null
): DropIndicator | undefined {
  const targetElement = editor.getElementByKey(target.key);
  const root = editor.getRootElement();

  if (!targetElement || !root || !layer) {
    return undefined;
  }

  const targetRect = targetElement.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const overlayRect = layer.getBoundingClientRect();
  const top = target.placement === "before" ? targetRect.top : targetRect.bottom;

  return {
    left: rootRect.left - overlayRect.left + 28,
    top: top - overlayRect.top - 2,
    width: Math.max(0, rootRect.width - 56)
  };
}

function moveBlock(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  draggedBlockKey: NodeKey,
  target: DropTarget
): void {
  if (draggedBlockKey === target.key) {
    return;
  }

  editor.update(() => {
    const draggedNode = $getNodeByKey(draggedBlockKey);
    const targetNode = $getNodeByKey(target.key);

    if (!draggedNode || !targetNode || draggedNode === targetNode) {
      return;
    }

    if (target.placement === "before") {
      targetNode.insertBefore(draggedNode);
      return;
    }

    targetNode.insertAfter(draggedNode);
  });
}
