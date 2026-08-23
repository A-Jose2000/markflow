import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { RealmPlugin } from "@mdxeditor/editor";
import {
  $createParagraphNode,
  $getNodeByKey,
  type LexicalNode,
  type NodeKey
} from "lexical";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type JSX
} from "react";

import { BlockCommandMenu } from "./BlockCommandMenu";
import { useBlockCommandMenuController } from "./blockCommandMenuController";
import { useBlockHandleVisibility } from "./blockHandleVisibility";
import { useBlockMarqueeSelection } from "./blockMarqueeSelection";
import { createBlockMarkdownVisitors } from "./blockMarkdownVisitors";
import {
  $getMarkflowToggleState,
  $setMarkflowToggleState
} from "./blockNodeState";
import type { MarkflowToggleState } from "./blockMetadataCodec";
import { useBlockOverlayProjection } from "./blockOverlayProjection";
import { useBlockOutlineKeyboard } from "./blockOutlineKeyboard";
import {
  getDropIndicator,
  getDropTarget,
  type DraggedBlocks,
  type DropIndicator
} from "./blockDragDrop";
import {
  $getLogicalUnitAtSelection,
  $getOutlineUnitAtSelection,
  $isSelectionAtOutlineUnitStart,
  getLogicalBlockTree,
  recommitLogicalSelection
} from "./blockLogicalTree";
import {
  moveLogicalBlocks
} from "./blockOutlineOperations";
import {
  areBlockKeyListsEqual,
  getUnitKeyInScope,
  resolveHierarchicalBlockSelection
} from "./blockSelectionModel";
import type { MdxEditorModule } from "./editorContract";

interface DragPoint {
  x: number;
  y: number;
}

const BLOCK_DRAG_DATA_FORMAT = "application/x-markflow-block-key";
const BLOCK_DRAG_SCROLL_EDGE = 64;
const BLOCK_DRAG_SCROLL_MAX_SPEED = 900;

export function createDraggableBlocksPlugin(editorModule: MdxEditorModule): RealmPlugin {
  const { exportVisitors, importVisitors } = createBlockMarkdownVisitors();
  return editorModule.realmPlugin({
    init(realm) {
      function MarkflowBlockControls(): JSX.Element {
        return <MarkflowDraggableBlocks editorModule={editorModule} />;
      }

      realm.pubIn({
        [editorModule.addComposerChild$]: MarkflowBlockControls,
        [editorModule.addImportVisitor$]: importVisitors,
        [editorModule.addExportVisitor$]: exportVisitors
      });
    }
  })();
}

function MarkflowDraggableBlocks({ editorModule }: { editorModule: MdxEditorModule }): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const draggedBlocksRef = useRef<DraggedBlocks | undefined>(undefined);
  const dragPointRef = useRef<DragPoint | undefined>(undefined);
  const dragScrollFrameRef = useRef<number | undefined>(undefined);
  const dragScrollLastTimeRef = useRef<number | undefined>(undefined);
  const nativeDragEndCleanupRef = useRef<(() => void) | undefined>(undefined);
  const selectedBlockKeysRef = useRef<NodeKey[]>([]);
  const selectedBlockScopeKeyRef = useRef<NodeKey | undefined>(undefined);
  const [rootElement, setRootElement] = useState<HTMLElement | undefined>();
  const [isEditable, setIsEditable] = useState(editor.isEditable());
  const [readonlyToggleOverrides, setReadonlyToggleOverrides] = useState<
    ReadonlyMap<NodeKey, Exclude<MarkflowToggleState, "none">>
  >(new Map());
  const [selectedBlockKeys, setSelectedBlockKeys] = useState<NodeKey[]>([]);
  const [selectedBlockScopeKey, setSelectedBlockScopeKey] = useState<NodeKey | undefined>();
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | undefined>();

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

  const commitBlockSelection = useCallback((scopeKey: NodeKey | undefined, nextKeys: NodeKey[]) => {
    const uniqueKeys = Array.from(new Set(nextKeys));
    const nextScopeKey = uniqueKeys.length > 0 ? scopeKey : undefined;

    if (
      selectedBlockScopeKeyRef.current === nextScopeKey &&
      areBlockKeyListsEqual(selectedBlockKeysRef.current, uniqueKeys)
    ) {
      return;
    }

    selectedBlockScopeKeyRef.current = nextScopeKey;
    selectedBlockKeysRef.current = uniqueKeys;
    setSelectedBlockScopeKey(nextScopeKey);
    setSelectedBlockKeys(uniqueKeys);
  }, []);

  const {
    handles,
    handlesRef,
    requestMeasureHandles,
    selectionGutter,
    selectionHighlights,
    toggleControls
  } = useBlockOverlayProjection({
    commitBlockSelection,
    draggedBlocksRef,
    editor,
    isEditable,
    layerRef,
    readonlyToggleOverrides,
    rootElement,
    selectedBlockKeys,
    selectedBlockKeysRef,
    selectedBlockScopeKey,
    selectedBlockScopeKeyRef
  });

  const {
    focusedHandleKey,
    hoveredHandleKey,
    scheduleHandleHide,
    setFocusedHandleKey,
    setHoveredHandleKey,
    showHandle
  } = useBlockHandleVisibility({
    handles,
    handlesRef,
    isEditable,
    rootElement
  });

  const {
    resetMarqueeSelection,
    selectionMarquee,
    startMarqueeSelection
  } = useBlockMarqueeSelection({
    commitBlockSelection,
    editor,
    layerRef,
    rootElement
  });

  useBlockOutlineKeyboard({
    commitBlockSelection,
    editor,
    isEditable,
    requestMeasureHandles,
    rootElement,
    selectedBlockCount: selectedBlockKeys.length,
    selectedBlockKeysRef,
    selectedBlockScopeKeyRef
  });

  const {
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
  } = useBlockCommandMenuController({
    commitBlockSelection,
    editor,
    editorModule,
    isEditable,
    layerRef,
    selectedBlockKeysRef
  });

  useEffect(() => {
    const updateRoot = (nextRootElement: HTMLElement | null) => {
      setRootElement(nextRootElement ?? undefined);
    };

    updateRoot(editor.getRootElement());

    return editor.registerRootListener(updateRoot);
  }, [editor]);

  useEffect(() => editor.registerEditableListener(setIsEditable), [editor]);

  useEffect(() => {
    if (isEditable) {
      setReadonlyToggleOverrides((current) => current.size === 0 ? current : new Map());
    }
  }, [isEditable]);

  useEffect(() => {
    if (isEditable) {
      return;
    }

    finishBlockDrag();
    resetMarqueeSelection();
    commitBlockSelection(undefined, []);
  }, [commitBlockSelection, finishBlockDrag, isEditable, resetMarqueeSelection]);

  useEffect(() => {
    const root = rootElement;
    const scroller = root?.parentElement;

    if (!root || !scroller) {
      return;
    }

    const updateDropIndicator = (clientX: number, clientY: number) => {
      const draggedBlocks = draggedBlocksRef.current;

      if (!draggedBlocks) {
        setDropIndicator(undefined);
        return;
      }

      const target = getDropTarget(editor, clientX, clientY, draggedBlocks);
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

      updateDropIndicator(point.x, point.y);
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
      updateDropIndicator(event.clientX, event.clientY);
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
      const target = getDropTarget(editor, event.clientX, event.clientY, draggedBlocks);

      if (!target) {
        finishBlockDrag();
        return;
      }

      const movedKeys = [...draggedBlocks.keys];
      moveLogicalBlocks(editor, draggedBlocks, target);
      finishBlockDrag();
      window.requestAnimationFrame(() => {
        recommitLogicalSelection(editor, movedKeys, commitBlockSelection);
        requestMeasureHandles();
      });
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
  }, [commitBlockSelection, editor, finishBlockDrag, requestMeasureHandles, rootElement, stopDragAutoScroll]);

  const toggleBlock = useCallback(
    (blockKey: NodeKey, renderedState: Exclude<MarkflowToggleState, "none">) => {
      if (!editor.isEditable()) {
        setReadonlyToggleOverrides((current) => {
          const next = new Map(current);
          next.set(blockKey, renderedState === "closed" ? "open" : "closed");
          return next;
        });
        return;
      }

      editor.update(
        () => {
          const node = $getNodeByKey(blockKey);

          if (!node) {
            return;
          }

          const current = $getMarkflowToggleState(node);

          if (current === "none") {
            return;
          }

          const next = current === "closed" ? "open" : "closed";

          if (next === "closed") {
            selectNodeStart(node);
          }

          $setMarkflowToggleState(node, next);
        },
        { onUpdate: requestMeasureHandles }
      );
    },
    [editor, requestMeasureHandles]
  );

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
      {toggleControls.map((control) => (
        <button
          key={control.key}
          aria-expanded={control.state === "open"}
          aria-label={control.state === "open" ? "Collapse block" : "Expand block"}
          className="markflow-block-toggle-button"
          data-block-key={control.key}
          data-state={control.state}
          onClick={() => toggleBlock(control.key, control.state)}
          style={{ left: `${control.left}px`, top: `${control.top}px` }}
          title={control.state === "open" ? "Collapse" : "Expand"}
          type="button"
        >
          <span aria-hidden="true">▸</span>
        </button>
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
          onPointerEnter={() => showHandle(handle.key)}
          onPointerLeave={scheduleHandleHide}
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

              const orderedUnits = orderedKeys.flatMap((key) => {
                const orderedUnit = tree.units.get(key);
                return orderedUnit ? [orderedUnit] : [];
              });
              const firstOutlineUnit = orderedUnits[0];
              if (
                !firstOutlineUnit?.outlineHostKey ||
                firstOutlineUnit.outlineDepth === undefined ||
                orderedUnits.length !== orderedKeys.length ||
                orderedUnits.some(
                  (orderedUnit) =>
                    orderedUnit.outlineHostKey !== firstOutlineUnit.outlineHostKey ||
                    orderedUnit.outlineDepth !== firstOutlineUnit.outlineDepth
                )
              ) {
                event.preventDefault();
                return;
              }

              const draggedBlocks: DraggedBlocks = {
                keys: orderedKeys,
                originX: event.clientX,
                outlineDepth: firstOutlineUnit.outlineDepth,
                outlineHostKey: firstOutlineUnit.outlineHostKey,
                sourceKey: handle.key
              };
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
            onContextMenu={(event) => openTurnIntoMenu(event, handle.key)}
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
      {commandMenu && isEditable ? (
        <BlockCommandMenu
          activeCommandIndex={activeCommandIndex}
          commands={filteredCommands}
          inputRef={menuInputRef}
          menu={commandMenu}
          menuRef={menuRef}
          onActiveCommandChange={setActiveCommandIndex}
          onApply={applyBlockCommand}
          onKeyDown={handleMenuKeyDown}
          onQueryChange={updateCommandQuery}
          query={commandQuery}
        />
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
