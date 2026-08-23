import type { DraggedBlocks } from "./blockDragDrop";
import {
  BLOCK_HANDLE_HEIGHT,
  BLOCK_NESTING_INDENT_WIDTH,
  getBlockControlAnchorLeft,
  getFirstLineRect,
  getLogicalBlockUnitRect,
  getOuterBlockFirstLineRect,
  getVisualBlockRect
} from "./blockGeometry";
import { collectCollapsedOutlineKeys } from "./blockIndentationModel";
import {
  getLogicalBlockTree,
  getNearestOutlineUnit,
  getUnifiedOutlineNumberMarkers,
  getUnifiedOutlineRows,
  type LogicalBlockUnit
} from "./blockLogicalTree";
import type { MarkflowToggleState } from "./blockMetadataCodec";
import { areBlockKeyListsEqual } from "./blockSelectionModel";
import type { LexicalEditor, NodeKey } from "lexical";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject
} from "react";

const BLOCK_HANDLE_PAIR_WIDTH = 42;
const BLOCK_HANDLE_GAP = 6;

export interface BlockHandle {
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

interface BlockSelectionHighlight {
  height: number;
  key: NodeKey;
  left: number;
  top: number;
  width: number;
}

interface BlockToggleControl {
  key: NodeKey;
  left: number;
  state: Exclude<MarkflowToggleState, "none">;
  top: number;
}

interface SelectionGutter {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BlockOverlayProjectionOptions {
  commitBlockSelection: (scopeKey: NodeKey | undefined, keys: NodeKey[]) => void;
  draggedBlocksRef: RefObject<DraggedBlocks | undefined>;
  editor: LexicalEditor;
  isEditable: boolean;
  layerRef: RefObject<HTMLDivElement | null>;
  readonlyToggleOverrides: ReadonlyMap<NodeKey, Exclude<MarkflowToggleState, "none">>;
  rootElement: HTMLElement | undefined;
  selectedBlockKeys: readonly NodeKey[];
  selectedBlockKeysRef: RefObject<NodeKey[]>;
  selectedBlockScopeKey: NodeKey | undefined;
  selectedBlockScopeKeyRef: RefObject<NodeKey | undefined>;
}

interface BlockOverlayProjection {
  handles: BlockHandle[];
  handlesRef: RefObject<BlockHandle[]>;
  requestMeasureHandles: () => void;
  selectionGutter: SelectionGutter | undefined;
  selectionHighlights: BlockSelectionHighlight[];
  toggleControls: BlockToggleControl[];
}

export function useBlockOverlayProjection({
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
}: BlockOverlayProjectionOptions): BlockOverlayProjection {
  const frameRef = useRef<number | undefined>(undefined);
  const handlesRef = useRef<BlockHandle[]>([]);
  const styledOutlineElementsRef = useRef(new Set<HTMLElement>());
  const collapsedOutlineElementsRef = useRef(new Set<HTMLElement>());
  const [handles, setHandles] = useState<BlockHandle[]>([]);
  const [toggleControls, setToggleControls] = useState<BlockToggleControl[]>([]);
  const [selectionHighlights, setSelectionHighlights] = useState<BlockSelectionHighlight[]>([]);
  const [selectionGutter, setSelectionGutter] = useState<SelectionGutter | undefined>();

  const measureHandles = useCallback(() => {
    const root = rootElement;
    const layer = layerRef.current;
    const scroller = root?.parentElement;

    clearProjectedOutlineStyles(styledOutlineElementsRef.current, collapsedOutlineElementsRef.current);

    if (!root || !layer || !scroller) {
      handlesRef.current = [];
      setHandles([]);
      setToggleControls([]);
      setSelectionHighlights([]);
      setSelectionGutter(undefined);
      return;
    }

    const tree = getLogicalBlockTree(editor);
    const outlineRows = getUnifiedOutlineRows(tree);
    const listMarkers = getUnifiedOutlineNumberMarkers(tree);
    const getEffectiveToggleState = (unit: LogicalBlockUnit): MarkflowToggleState =>
      !isEditable && unit.toggle !== "none"
        ? readonlyToggleOverrides.get(unit.key) ?? unit.toggle
        : unit.toggle;
    const closedToggleKeys = new Set(
      Array.from(tree.units.values())
        .filter((unit) => getEffectiveToggleState(unit) === "closed")
        .map((unit) => unit.key)
    );
    const collapsedKeys = collectCollapsedOutlineKeys(outlineRows, closedToggleKeys);
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
      !areBlockKeyListsEqual(selectedBlockKeysRef.current, validSelectedKeys)
    ) {
      commitBlockSelection(selectedScope?.key, validSelectedKeys);
    }

    projectOutlineStyles(
      editor,
      tree.units.values(),
      collapsedKeys,
      listMarkers,
      getEffectiveToggleState,
      styledOutlineElementsRef.current,
      collapsedOutlineElementsRef.current
    );

    const seenHandleUnitKeys = new Set<NodeKey>();
    const handleRows = Array.from(tree.units.values()).flatMap((rowUnit) => {
      const unit = getNearestOutlineUnit(tree, rowUnit) ?? rowUnit;

      if (seenHandleUnitKeys.has(unit.key)) {
        return [];
      }

      seenHandleUnitKeys.add(unit.key);
      return [{ rowKey: rowUnit.rowKey, unit }];
    });

    const measuredHandles = handleRows.flatMap(({ rowKey, unit }): BlockHandle[] => {
      const element = editor.getElementByKey(rowKey);

      if (!element) {
        return [];
      }

      const rect = getVisualBlockRect(element);
      const logicalRect = getLogicalBlockUnitRect(editor, tree, unit) ?? rect;

      if (rect.height <= 0 || rect.width <= 0) {
        return [];
      }

      const firstLineRect = getFirstLineRect(element, rect);
      const outlinePadding = Number.parseFloat(window.getComputedStyle(element).paddingInlineStart) || 0;
      const isOutlinedDecorator = unit.outlineDepth !== undefined && !unit.outlineUsesElementIndent;
      const controlLineRect = isOutlinedDecorator
        ? getOuterBlockFirstLineRect(element, rect)
        : firstLineRect;
      const handleViewportTop = controlLineRect.top + Math.max(0, (controlLineRect.height - BLOCK_HANDLE_HEIGHT) / 2);
      const isDragSource = draggedBlocksRef.current?.sourceKey === unit.key;

      if (
        !isDragSource &&
        (handleViewportTop < scrollerRect.top ||
          handleViewportTop + BLOCK_HANDLE_HEIGHT > scrollerRect.bottom)
      ) {
        return [];
      }

      const structuralAnchorLeft = getBlockControlAnchorLeft(element, rect);
      const anchorLeft = (unit.outlineDepth ?? 0) > 0
        ? unit.outlineUsesElementIndent
          ? Math.max(structuralAnchorLeft, rect.left + outlinePadding)
          : structuralAnchorLeft
        : structuralAnchorLeft;
      const controlLeft = anchorLeft - BLOCK_HANDLE_GAP - BLOCK_HANDLE_PAIR_WIDTH;

      return [{
        key: unit.key,
        depth: unit.depth,
        hotBottom: logicalRect.bottom + 3,
        hotLeft: controlLeft - 6,
        hotRight: Math.max(logicalRect.right, anchorLeft),
        hotTop: logicalRect.top - 3,
        isListItem: unit.kind === "list-item",
        left: Math.max(6, controlLeft - overlayRect.left),
        rowKey,
        top: handleViewportTop - overlayRect.top
      }];
    });
    const nextHandles = measuredHandles.sort((left, right) => left.top - right.top || left.left - right.left);
    const nextToggleControls = Array.from(tree.units.values()).flatMap((unit): BlockToggleControl[] => {
      const toggleState = getEffectiveToggleState(unit);

      if (toggleState === "none" || collapsedKeys.has(unit.key)) {
        return [];
      }

      const element = editor.getElementByKey(unit.rowKey);

      if (!element || element.hidden) {
        return [];
      }

      const rect = getVisualBlockRect(element);

      if (rect.height <= 0 || rect.width <= 0) {
        return [];
      }

      const firstLineRect = getFirstLineRect(element, rect);
      const buttonSize = 20;
      return [{
        key: unit.key,
        left: Math.max(4, firstLineRect.left - overlayRect.left - buttonSize - 2),
        state: toggleState,
        top: firstLineRect.top - overlayRect.top + Math.max(0, (firstLineRect.height - buttonSize) / 2)
      }];
    });

    handlesRef.current = nextHandles;
    setHandles(nextHandles);
    setToggleControls(nextToggleControls);
    setSelectionHighlights(
      validSelectedKeys.flatMap((key): BlockSelectionHighlight[] => {
        const unit = tree.units.get(key);
        const rect = unit ? getLogicalBlockUnitRect(editor, tree, unit) : undefined;

        if (!rect) {
          return [];
        }

        return [{
          key,
          height: rect.height,
          left: rect.left - overlayRect.left,
          top: rect.top - overlayRect.top,
          width: rect.width
        }];
      })
    );
  }, [
    commitBlockSelection,
    draggedBlocksRef,
    editor,
    isEditable,
    layerRef,
    readonlyToggleOverrides,
    rootElement,
    selectedBlockKeysRef,
    selectedBlockScopeKeyRef
  ]);

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
    const scroller = rootElement?.parentElement;

    if (!rootElement || !scroller) {
      return;
    }

    requestMeasureHandles();

    const unregisterUpdateListener = editor.registerUpdateListener(requestMeasureHandles);
    const resizeObserver = new ResizeObserver(requestMeasureHandles);

    resizeObserver.observe(rootElement);
    resizeObserver.observe(scroller);
    scroller.addEventListener("scroll", requestMeasureHandles);
    window.addEventListener("resize", requestMeasureHandles);

    return () => {
      unregisterUpdateListener();
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", requestMeasureHandles);
      window.removeEventListener("resize", requestMeasureHandles);

      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
    };
  }, [editor, requestMeasureHandles, rootElement]);

  useEffect(() => {
    requestMeasureHandles();
  }, [requestMeasureHandles, selectedBlockKeys, selectedBlockScopeKey]);

  return {
    handles,
    handlesRef,
    requestMeasureHandles,
    selectionGutter,
    selectionHighlights,
    toggleControls
  };
}

function clearProjectedOutlineStyles(
  styledElements: Set<HTMLElement>,
  collapsedElements: Set<HTMLElement>
): void {
  for (const element of styledElements) {
    delete element.dataset.markflowOutlineDepth;
    delete element.dataset.markflowOutlineElementIndent;
    delete element.dataset.markflowOutlineOffset;
    delete element.dataset.markflowListMarker;
    delete element.dataset.markflowToggle;
    element.style.removeProperty("--markflow-outline-offset");
  }
  styledElements.clear();

  for (const element of collapsedElements) {
    delete element.dataset.markflowCollapsedDescendant;
    element.hidden = false;
  }
  collapsedElements.clear();
}

function projectOutlineStyles(
  editor: LexicalEditor,
  units: IterableIterator<LogicalBlockUnit>,
  collapsedKeys: ReadonlySet<NodeKey>,
  listMarkers: ReadonlyMap<NodeKey, number>,
  getEffectiveToggleState: (unit: LogicalBlockUnit) => MarkflowToggleState,
  styledElements: Set<HTMLElement>,
  collapsedElements: Set<HTMLElement>
): void {
  for (const unit of units) {
    if (unit.outlineDepth === undefined) {
      continue;
    }

    const element = editor.getElementByKey(unit.rowKey);

    if (!element) {
      continue;
    }

    if (collapsedKeys.has(unit.key)) {
      element.dataset.markflowCollapsedDescendant = "true";
      element.hidden = true;
      collapsedElements.add(element);
    }

    element.dataset.markflowOutlineDepth = String(unit.outlineDepth);
    const toggleState = getEffectiveToggleState(unit);
    if (toggleState !== "none") {
      element.dataset.markflowToggle = toggleState;
    }
    const listMarker = listMarkers.get(unit.key);
    if (listMarker !== undefined) {
      element.dataset.markflowListMarker = String(listMarker);
    }
    styledElements.add(element);
    const visualOffsetDepth = Math.max(0, unit.outlineDepth - (unit.outlinePhysicalDepth ?? 0));
    element.style.setProperty(
      "--markflow-outline-offset",
      `calc(var(--markflow-block-indent-width, ${BLOCK_NESTING_INDENT_WIDTH}px) * ${visualOffsetDepth})`
    );

    if (unit.outlineUsesElementIndent) {
      element.dataset.markflowOutlineElementIndent = "true";
    }

    if (visualOffsetDepth !== 0 && !unit.outlineUsesElementIndent) {
      element.dataset.markflowOutlineOffset = "true";
    }
  }
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
