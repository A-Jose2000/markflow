import type { NodeKey } from "lexical";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from "react";

import type { BlockHandle } from "./blockOverlayProjection";

const BLOCK_HANDLE_HIDE_DELAY_MS = 350;

interface BlockHandleVisibilityOptions {
  handles: readonly BlockHandle[];
  handlesRef: RefObject<BlockHandle[]>;
  isEditable: boolean;
  rootElement: HTMLElement | undefined;
}

interface BlockHandleVisibility {
  focusedHandleKey: NodeKey | undefined;
  hoveredHandleKey: NodeKey | undefined;
  scheduleHandleHide: () => void;
  setFocusedHandleKey: Dispatch<SetStateAction<NodeKey | undefined>>;
  setHoveredHandleKey: Dispatch<SetStateAction<NodeKey | undefined>>;
  showHandle: (key: NodeKey) => void;
}

export function useBlockHandleVisibility({
  handles,
  handlesRef,
  isEditable,
  rootElement
}: BlockHandleVisibilityOptions): BlockHandleVisibility {
  const hideTimeoutRef = useRef<number | undefined>(undefined);
  const [hoveredHandleKey, setHoveredHandleKey] = useState<NodeKey | undefined>();
  const [focusedHandleKey, setFocusedHandleKey] = useState<NodeKey | undefined>();

  const cancelHandleHide = useCallback(() => {
    if (hideTimeoutRef.current !== undefined) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = undefined;
    }
  }, []);

  const showHandle = useCallback(
    (key: NodeKey) => {
      cancelHandleHide();
      setHoveredHandleKey(key);
    },
    [cancelHandleHide]
  );

  const scheduleHandleHide = useCallback(() => {
    if (hideTimeoutRef.current !== undefined) {
      return;
    }

    hideTimeoutRef.current = window.setTimeout(() => {
      hideTimeoutRef.current = undefined;
      setHoveredHandleKey(undefined);
    }, BLOCK_HANDLE_HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    setHoveredHandleKey((current) =>
      current && handles.some((handle) => handle.key === current) ? current : undefined
    );
  }, [handles]);

  useEffect(() => {
    if (isEditable) {
      return;
    }

    cancelHandleHide();
    setHoveredHandleKey(undefined);
    setFocusedHandleKey(undefined);
  }, [cancelHandleHide, isEditable]);

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

      if (match) {
        showHandle(match.key);
      } else {
        scheduleHandleHide();
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;

      if (hoverFrame === undefined) {
        hoverFrame = window.requestAnimationFrame(updateHoveredHandle);
      }
    };

    const handlePointerLeave = () => {
      if (hoverFrame !== undefined) {
        window.cancelAnimationFrame(hoverFrame);
        hoverFrame = undefined;
      }

      scheduleHandleHide();
    };

    scroller.addEventListener("pointermove", handlePointerMove, { passive: true });
    scroller.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      scroller.removeEventListener("pointermove", handlePointerMove);
      scroller.removeEventListener("pointerleave", handlePointerLeave);

      if (hoverFrame !== undefined) {
        window.cancelAnimationFrame(hoverFrame);
      }

      cancelHandleHide();
    };
  }, [cancelHandleHide, handlesRef, isEditable, rootElement, scheduleHandleHide, showHandle]);

  return {
    focusedHandleKey,
    hoveredHandleKey,
    scheduleHandleHide,
    setFocusedHandleKey,
    setHoveredHandleKey,
    showHandle
  };
}
