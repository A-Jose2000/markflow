import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

import type { DesktopFolderEntry } from "../desktopApi";

const POINTER_DRAG_THRESHOLD = 5;

export interface DesktopExplorerPointerDrag {
  readonly entry: DesktopFolderEntry;
  readonly clientX: number;
  readonly clientY: number;
}

export interface UseDesktopExplorerDragOptions {
  readonly importsEnabled: boolean;
  readonly movesEnabled: boolean;
  readonly canMoveEntryTo: (entry: DesktopFolderEntry, destinationParentRelativePath: string) => boolean;
  readonly onImportFiles: (
    destinationParentRelativePath: string,
    files: File[]
  ) => void | Promise<void>;
  readonly onMoveEntry: (
    entry: DesktopFolderEntry,
    destinationParentRelativePath: string
  ) => void | Promise<void>;
  readonly onMoveStatusChange: (status: string | undefined) => void;
  readonly onPointerDragStart: () => void;
}

export interface UseDesktopExplorerDragResult {
  readonly dropTargetPath?: string;
  readonly pointerDrag?: DesktopExplorerPointerDrag;
  readonly handleEntryClickCapture: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly handleEntryPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    entry: DesktopFolderEntry
  ) => void;
  readonly handleExplorerDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  readonly handleExplorerDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  readonly handleExplorerDrop: (event: ReactDragEvent<HTMLElement>) => void;
}

export function useDesktopExplorerDrag({
  importsEnabled,
  movesEnabled,
  canMoveEntryTo,
  onImportFiles,
  onMoveEntry,
  onMoveStatusChange,
  onPointerDragStart
}: UseDesktopExplorerDragOptions): UseDesktopExplorerDragResult {
  const [dropTargetPath, setDropTargetPath] = useState<string | undefined>();
  const [pointerDrag, setPointerDrag] = useState<DesktopExplorerPointerDrag | undefined>();
  const suppressClickRef = useRef(false);
  const activePointerCleanupRef = useRef<(() => void) | undefined>(undefined);

  useEffect(
    () => () => {
      activePointerCleanupRef.current?.();
      activePointerCleanupRef.current = undefined;
    },
    []
  );

  function handleEntryPointerDown(event: ReactPointerEvent<HTMLElement>, entry: DesktopFolderEntry): void {
    if (!movesEnabled || event.button !== 0 || !event.isPrimary) {
      return;
    }

    const pointerId = event.pointerId;
    const sourceElement = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    let destinationRelativePath: string | undefined;

    const removeListeners = () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("blur", handleWindowBlur);
    };

    const cleanupPointerDom = () => {
      removeListeners();
      document.body.classList.remove("desktop-explorer-is-dragging");
      sourceElement.removeAttribute("data-dragging");

      if (activePointerCleanupRef.current === cleanupPointerDom) {
        activePointerCleanupRef.current = undefined;
      }
    };

    const finishPointerDrag = (cancelled: boolean) => {
      removeListeners();

      if (activePointerCleanupRef.current === cleanupPointerDom) {
        activePointerCleanupRef.current = undefined;
      }

      if (!started) {
        return;
      }

      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      document.body.classList.remove("desktop-explorer-is-dragging");
      sourceElement.removeAttribute("data-dragging");
      setPointerDrag(undefined);
      setDropTargetPath(undefined);
      onMoveStatusChange(undefined);

      if (!cancelled && destinationRelativePath !== undefined) {
        void onMoveEntry(entry, destinationRelativePath);
      }
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      if (!started) {
        const distance = Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY);

        if (distance < POINTER_DRAG_THRESHOLD) {
          return;
        }

        started = true;
        onPointerDragStart();
        sourceElement.setAttribute("data-dragging", "true");
        document.body.classList.add("desktop-explorer-is-dragging");
        onMoveStatusChange(`Move ${entry.name} into a folder`);
      }

      pointerEvent.preventDefault();
      const hoveredElement = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
      const hoveredRelativePath = readDropDestination(hoveredElement);
      destinationRelativePath =
        hoveredRelativePath !== undefined && canMoveEntryTo(entry, hoveredRelativePath)
          ? hoveredRelativePath
          : undefined;
      setDropTargetPath(destinationRelativePath);
      setPointerDrag({ entry, clientX: pointerEvent.clientX, clientY: pointerEvent.clientY });
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      if (started) {
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
      }

      finishPointerDrag(false);
    };

    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === pointerId) {
        finishPointerDrag(true);
      }
    };

    const handleWindowBlur = () => finishPointerDrag(true);

    activePointerCleanupRef.current = cleanupPointerDom;
    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("blur", handleWindowBlur);
  }

  function handleExplorerDragOver(event: ReactDragEvent<HTMLElement>): void {
    const relativePath = readDropDestination(event.target);

    if (relativePath === undefined || !canAcceptExternalFileDrop(event, importsEnabled)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropTargetPath(relativePath);
  }

  function handleExplorerDragLeave(event: ReactDragEvent<HTMLElement>): void {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setDropTargetPath(undefined);
  }

  function handleExplorerDrop(event: ReactDragEvent<HTMLElement>): void {
    const relativePath = readDropDestination(event.target);

    if (relativePath === undefined || !canAcceptExternalFileDrop(event, importsEnabled)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);

    if (files.length === 0) {
      setDropTargetPath(undefined);
      return;
    }

    setDropTargetPath(undefined);
    void onImportFiles(relativePath, files);
  }

  function handleEntryClickCapture(event: ReactMouseEvent<HTMLButtonElement>): void {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return {
    dropTargetPath,
    pointerDrag,
    handleEntryClickCapture,
    handleEntryPointerDown,
    handleExplorerDragLeave,
    handleExplorerDragOver,
    handleExplorerDrop
  };
}

function canAcceptExternalFileDrop(event: ReactDragEvent<HTMLElement>, importsEnabled: boolean): boolean {
  return importsEnabled && Array.from(event.dataTransfer.types).includes("Files");
}

function readDropDestination(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }

  const dropTarget = target.closest<HTMLElement>("[data-explorer-drop-path]");
  return dropTarget?.dataset.explorerDropPath;
}
