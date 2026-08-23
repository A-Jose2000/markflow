import type { LexicalEditor, NodeKey } from "lexical";
import {
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";

import { distanceFromYToRect, getVisualBlockRect } from "./blockGeometry";
import { getLogicalBlockTree } from "./blockLogicalTree";
import {
  getMarqueeBounds,
  hasMarqueeMoved,
  type MarqueePoint
} from "./blockMarqueeModel";
import { resolveHierarchicalBlockSelection } from "./blockSelectionModel";

export interface SelectionMarquee {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BlockMarqueeSelectionOptions {
  commitBlockSelection: (scopeKey: NodeKey | undefined, keys: NodeKey[]) => void;
  editor: LexicalEditor;
  layerRef: RefObject<HTMLDivElement | null>;
  rootElement: HTMLElement | undefined;
}

interface BlockMarqueeSelection {
  resetMarqueeSelection: () => void;
  selectionMarquee: SelectionMarquee | undefined;
  startMarqueeSelection: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useBlockMarqueeSelection({
  commitBlockSelection,
  editor,
  layerRef,
  rootElement
}: BlockMarqueeSelectionOptions): BlockMarqueeSelection {
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee | undefined>();
  const resetMarqueeSelection = useCallback(() => setSelectionMarquee(undefined), []);

  const startMarqueeSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootElement;
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
      const start: MarqueePoint = {
        x: Math.min(scrollerRect.right, Math.max(scrollerRect.left, event.clientX)),
        y: Math.min(scrollerRect.bottom, Math.max(scrollerRect.top, event.clientY))
      };
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
        resetMarqueeSelection();

        if (!moved) {
          commitBlockSelection(undefined, []);
        }
      };

      const updateSelection = (clientX: number, clientY: number) => {
        const bounds = getMarqueeBounds(start, { x: clientX, y: clientY }, scrollerRect);
        moved ||= hasMarqueeMoved(start, { x: bounds.currentX, y: bounds.currentY });
        setSelectionMarquee({
          left: bounds.left - overlayRect.left,
          top: bounds.top - overlayRect.top,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top
        });

        if (!moved) {
          return;
        }

        const tree = getLogicalBlockTree(editor);
        const intersectingBlocks = Array.from(tree.units.values()).flatMap(
          (unit): Array<{ depth: number; key: NodeKey; rect: DOMRect }> => {
            const element = editor.getElementByKey(unit.rowKey);

            if (!element) {
              return [];
            }

            const rect = getVisualBlockRect(element);
            return rect.right >= bounds.left &&
              rect.left <= bounds.right &&
              rect.bottom >= bounds.top &&
              rect.top <= bounds.bottom
              ? [{ depth: unit.depth, key: unit.key, rect }]
              : [];
          }
        );

        if (!anchorBlockKey && intersectingBlocks.length > 0) {
          const anchorBlock = intersectingBlocks.reduce((closest, candidate) => {
            const closestDistance = distanceFromYToRect(start.y, closest.rect);
            const candidateDistance = distanceFromYToRect(start.y, candidate.rect);
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
        left: start.x - overlayRect.left,
        top: start.y - overlayRect.top,
        width: 0,
        height: 0
      });
      document.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
      document.addEventListener("pointerup", handlePointerUp, true);
      document.addEventListener("pointercancel", handlePointerCancel, true);
      window.addEventListener("blur", handleWindowBlur);
    },
    [commitBlockSelection, editor, layerRef, resetMarqueeSelection, rootElement]
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

  return {
    resetMarqueeSelection,
    selectionMarquee,
    startMarqueeSelection
  };
}
