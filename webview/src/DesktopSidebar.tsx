import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import {
  getDesktopApi,
  type DesktopEntryMutationResult,
  type DesktopFileTarget,
  type DesktopFolderEntry,
  type DesktopFolderRoot,
  type MarkflowDesktopApi
} from "./desktopApi";
type DirectoryLoadStatus = "idle" | "loading" | "loaded" | "error";
type CreateMode = "file" | "folder";
const POINTER_DRAG_THRESHOLD = 5;

interface EntryContextMenu {
  readonly entry: DesktopFolderEntry;
  readonly left: number;
  readonly top: number;
}

interface ExplorerPointerDrag {
  readonly entry: DesktopFolderEntry;
  readonly clientX: number;
  readonly clientY: number;
}

interface DirectoryState {
  readonly expanded: boolean;
  readonly status: DirectoryLoadStatus;
  readonly entries: DesktopFolderEntry[];
  readonly error?: string;
}

export interface DesktopSidebarProps {
  readonly api?: MarkflowDesktopApi;
  readonly activeTarget?: DesktopFileTarget;
  readonly onBeforeChooseFolder?: () => void | Promise<void>;
  readonly onBeforeCreate?: () => void | Promise<void>;
  readonly onBeforeMutate?: () => void | Promise<void>;
  readonly onEntryDeleted?: (rootId: string, entry: DesktopFolderEntry) => void;
  readonly onEntryRelocated?: (rootId: string, result: DesktopEntryMutationResult) => void;
  readonly onFolderChanged?: (root: DesktopFolderRoot) => void;
  readonly onOpenMarkdown: (target: DesktopFileTarget) => void | Promise<void>;
  readonly onOpenMedia: (target: DesktopFileTarget) => void | Promise<void>;
  readonly onError?: (error: Error) => void;
}

export function DesktopSidebar({
  api: providedApi,
  activeTarget,
  onBeforeChooseFolder,
  onBeforeCreate,
  onBeforeMutate,
  onEntryDeleted,
  onEntryRelocated,
  onFolderChanged,
  onOpenMarkdown,
  onOpenMedia,
  onError
}: DesktopSidebarProps): JSX.Element {
  const api = providedApi ?? getDesktopApi();
  const activeRootIdRef = useRef<string | undefined>(undefined);
  const [root, setRoot] = useState<DesktopFolderRoot | undefined>();
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | undefined>();
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState("");
  const [createMode, setCreateMode] = useState<CreateMode | undefined>();
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<DesktopFolderEntry | undefined>();
  const [renameName, setRenameName] = useState("");
  const [contextMenu, setContextMenu] = useState<EntryContextMenu | undefined>();
  const [dropTargetPath, setDropTargetPath] = useState<string | undefined>();
  const [operationStatus, setOperationStatus] = useState<string | undefined>();
  const [sidebarError, setSidebarError] = useState<string | undefined>();
  const [pointerDrag, setPointerDrag] = useState<ExplorerPointerDrag | undefined>();
  const suppressClickRef = useRef(false);

  const reportError = useCallback(
    (error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error("Markflow could not complete that action.");
      setSidebarError(normalizedError.message);
      onError?.(normalizedError);
    },
    [onError]
  );

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeMenu = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Element && target.closest(".desktop-sidebar__context-menu")) {
        return;
      }

      setContextMenu(undefined);
    };
    const closeMenuFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(undefined);
      }
    };

    document.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("keydown", closeMenuFromKeyboard);

    return () => {
      document.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("keydown", closeMenuFromKeyboard);
    };
  }, [contextMenu]);

  const loadDirectory = useCallback(
    async (rootId: string, relativePath: string) => {
      if (!api) {
        return;
      }

      setSidebarError(undefined);
      setDirectories((current) => ({
        ...current,
        [relativePath]: {
          expanded: true,
          status: "loading",
          entries: current[relativePath]?.entries ?? []
        }
      }));

      try {
        const entries = await api.listDirectory({ rootId, relativePath });

        if (activeRootIdRef.current !== rootId) {
          return;
        }

        setDirectories((current) => ({
          ...current,
          [relativePath]: {
            expanded: current[relativePath]?.expanded ?? true,
            status: "loaded",
            entries
          }
        }));
      } catch (error) {
        if (activeRootIdRef.current !== rootId) {
          return;
        }

        const message = error instanceof Error ? error.message : "This folder could not be read.";
        setDirectories((current) => ({
          ...current,
          [relativePath]: {
            expanded: true,
            status: "error",
            entries: current[relativePath]?.entries ?? [],
            error: message
          }
        }));
        reportError(error);
      }
    },
    [api, reportError]
  );

  async function handleChooseFolder(): Promise<void> {
    if (!api || isChoosingFolder || openingPath || isCreating || isImporting || isMutating) {
      return;
    }

    setIsChoosingFolder(true);
    setSidebarError(undefined);

    try {
      await onBeforeChooseFolder?.();
      const selectedRoot = await api.chooseFolder();

      if (!selectedRoot) {
        return;
      }

      activeRootIdRef.current = selectedRoot.id;
      setRoot(selectedRoot);
      setSelectedDirectoryPath("");
      setCreateMode(undefined);
      setCreateName("");
      setRenameTarget(undefined);
      setRenameName("");
      setContextMenu(undefined);
      setOperationStatus(undefined);
      setDirectories({
        "": {
          expanded: true,
          status: "loading",
          entries: []
        }
      });
      onFolderChanged?.(selectedRoot);
      await loadDirectory(selectedRoot.id, "");
    } catch (error) {
      reportError(error);
    } finally {
      setIsChoosingFolder(false);
    }
  }

  function handleToggleDirectory(entry: Extract<DesktopFolderEntry, { kind: "directory" }>): void {
    if (!root) {
      return;
    }

    setSelectedDirectoryPath(entry.relativePath);
    setCreateMode(undefined);
    setCreateName("");
    setRenameTarget(undefined);
    setRenameName("");
    setContextMenu(undefined);
    const state = directories[entry.relativePath];

    if (state?.expanded) {
      setDirectories((current) => ({
        ...current,
        [entry.relativePath]: {
          ...state,
          expanded: false
        }
      }));
      return;
    }

    if (state?.status === "loaded") {
      setDirectories((current) => ({
        ...current,
        [entry.relativePath]: {
          ...state,
          expanded: true
        }
      }));
      return;
    }

    void loadDirectory(root.id, entry.relativePath);
  }

  async function handleOpenFile(entry: Exclude<DesktopFolderEntry, { kind: "directory" }>): Promise<void> {
    if (!root || openingPath || isCreating || isImporting || isMutating) {
      return;
    }

    const target: DesktopFileTarget = {
      rootId: root.id,
      name: entry.name,
      relativePath: entry.relativePath,
      kind: entry.kind,
      mimeType: entry.mimeType
    };

    setOpeningPath(entry.relativePath);
    setSidebarError(undefined);

    try {
      if (entry.kind === "markdown") {
        await onOpenMarkdown(target);
      } else {
        await onOpenMedia(target);
      }
    } catch (error) {
      reportError(error);
    } finally {
      setOpeningPath((current) => (current === entry.relativePath ? undefined : current));
    }
  }

  function handleRefreshRoot(): void {
    if (!root) {
      return;
    }

    setDirectories({
      "": {
        expanded: true,
        status: "loading",
        entries: []
      }
    });
    setSelectedDirectoryPath("");
    setCreateMode(undefined);
    setCreateName("");
    setRenameTarget(undefined);
    setRenameName("");
    setContextMenu(undefined);
    setOperationStatus(undefined);
    void loadDirectory(root.id, "");
  }

  function startCreate(mode: CreateMode): void {
    if (!root || isCreating || isImporting || isMutating || isChoosingFolder || openingPath) {
      return;
    }

    setCreateMode(mode);
    setCreateName("");
    setRenameTarget(undefined);
    setRenameName("");
    setContextMenu(undefined);
    setSidebarError(undefined);
    setOperationStatus(undefined);
  }

  function cancelCreate(): void {
    if (isCreating) {
      return;
    }

    setCreateMode(undefined);
    setCreateName("");
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!api || !root || !createMode || isCreating || createName.trim().length === 0) {
      return;
    }

    const rootId = root.id;
    const parentRelativePath = selectedDirectoryPath;
    setIsCreating(true);
    setSidebarError(undefined);
    setOperationStatus(undefined);

    try {
      await onBeforeCreate?.();

      if (createMode === "file") {
        const entry = await api.createMarkdownFile({
          rootId,
          parentRelativePath,
          name: createName
        });
        await loadDirectory(rootId, parentRelativePath);
        setCreateMode(undefined);
        setCreateName("");
        setOperationStatus(`Created ${entry.name}`);
        await onOpenMarkdown({ rootId, ...entry });
      } else {
        const entry = await api.createFolder({
          rootId,
          parentRelativePath,
          name: createName
        });
        await loadDirectory(rootId, parentRelativePath);
        setDirectories((current) => ({
          ...current,
          [entry.relativePath]: {
            expanded: true,
            status: "loaded",
            entries: []
          }
        }));
        setSelectedDirectoryPath(entry.relativePath);
        setCreateMode(undefined);
        setCreateName("");
        setOperationStatus(`Created folder ${entry.name}`);
      }
    } catch (error) {
      reportError(error);
    } finally {
      setIsCreating(false);
    }
  }

  function startRename(entry: DesktopFolderEntry): void {
    if (isCreating || isImporting || isMutating || isChoosingFolder || openingPath) {
      return;
    }

    setContextMenu(undefined);
    setCreateMode(undefined);
    setCreateName("");
    setRenameTarget(entry);
    setRenameName(entry.name);
    setSidebarError(undefined);
    setOperationStatus(undefined);
  }

  function cancelRename(): void {
    if (isMutating) {
      return;
    }

    setRenameTarget(undefined);
    setRenameName("");
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!api || !root || !renameTarget || isMutating || renameName.trim().length === 0) {
      return;
    }

    const target = renameTarget;
    setIsMutating(true);
    setSidebarError(undefined);
    setOperationStatus(`Renaming ${target.name}…`);

    try {
      await onBeforeMutate?.();
      const result = await api.renameEntry({
        rootId: root.id,
        relativePath: target.relativePath,
        name: renameName
      });
      await refreshAfterMutation(result);
      relocateSelectedDirectory(result);
      setRenameTarget(undefined);
      setRenameName("");
      setOperationStatus(result.changed ? `Renamed to ${result.entry.name}` : `${result.entry.name} was unchanged`);
      onEntryRelocated?.(root.id, result);
      await reopenRelocatedActiveTarget(result);
    } catch (error) {
      setOperationStatus(undefined);
      reportError(error);
    } finally {
      setIsMutating(false);
    }
  }

  async function handleMoveEntry(entry: DesktopFolderEntry, destinationParentRelativePath: string): Promise<void> {
    if (!api || !root || isMutating || !canMoveEntryTo(entry, destinationParentRelativePath)) {
      return;
    }

    setContextMenu(undefined);
    setIsMutating(true);
    setSidebarError(undefined);
    setOperationStatus(`Moving ${entry.name}…`);

    try {
      await onBeforeMutate?.();
      const result = await api.moveEntry({
        rootId: root.id,
        sourceRelativePath: entry.relativePath,
        destinationParentRelativePath
      });
      await refreshAfterMutation(result);
      relocateSelectedDirectory(result);
      setOperationStatus(result.changed ? `Moved ${result.entry.name}` : `${result.entry.name} is already there`);
      onEntryRelocated?.(root.id, result);
      await reopenRelocatedActiveTarget(result);
    } catch (error) {
      setOperationStatus(undefined);
      reportError(error);
    } finally {
      setIsMutating(false);
    }
  }

  async function handleTrashEntry(entry: DesktopFolderEntry): Promise<void> {
    if (!api || !root || isMutating) {
      return;
    }

    setContextMenu(undefined);
    const approved = window.confirm(
      `Move ${entry.name} to the Windows Recycle Bin?${entry.kind === "directory" ? " Its contents will be moved too." : ""}`
    );

    if (!approved) {
      return;
    }

    setIsMutating(true);
    setSidebarError(undefined);
    setOperationStatus(`Moving ${entry.name} to the Recycle Bin…`);

    try {
      await onBeforeMutate?.();
      await api.trashEntry({ rootId: root.id, relativePath: entry.relativePath });
      removeCachedDirectorySubtree(entry.relativePath);
      const parentRelativePath = apiParentPath(entry.relativePath);
      await loadDirectory(root.id, parentRelativePath);

      if (pathIsWithinOrEqual(entry.relativePath, selectedDirectoryPath)) {
        setSelectedDirectoryPath(parentRelativePath);
      }

      onEntryDeleted?.(root.id, entry);

      setRenameTarget(undefined);
      setRenameName("");
      setOperationStatus(`Moved ${entry.name} to the Recycle Bin`);
    } catch (error) {
      setOperationStatus(undefined);
      reportError(error);
    } finally {
      setIsMutating(false);
    }
  }

  function handleEntryContextMenu(event: ReactMouseEvent<HTMLElement>, entry: DesktopFolderEntry): void {
    if (isChoosingFolder || isCreating || isImporting || isMutating || openingPath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 210;
    const menuHeight = 132;
    setContextMenu({
      entry,
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    });
  }

  function canMoveEntryTo(entry: DesktopFolderEntry, destinationParentRelativePath: string): boolean {
    if (apiParentPath(entry.relativePath) === destinationParentRelativePath) {
      return false;
    }

    return entry.kind !== "directory" || !pathIsWithinOrEqual(entry.relativePath, destinationParentRelativePath);
  }

  function removeCachedDirectorySubtree(relativePath: string): void {
    setDirectories((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([cachedPath]) => !pathIsWithinOrEqual(relativePath, cachedPath))
      )
    );
  }

  async function refreshAfterMutation(result: DesktopEntryMutationResult): Promise<void> {
    if (!root || !result.changed) {
      return;
    }

    removeCachedDirectorySubtree(result.previousRelativePath);
    const parentPaths = new Set([
      apiParentPath(result.previousRelativePath),
      apiParentPath(result.entry.relativePath)
    ]);
    await Promise.all(Array.from(parentPaths, (relativePath) => loadDirectory(root.id, relativePath)));
  }

  function relocateSelectedDirectory(result: DesktopEntryMutationResult): void {
    if (!result.changed || !pathIsWithinOrEqual(result.previousRelativePath, selectedDirectoryPath)) {
      return;
    }

    setSelectedDirectoryPath(relocateRelativePath(selectedDirectoryPath, result));
  }

  async function reopenRelocatedActiveTarget(result: DesktopEntryMutationResult): Promise<void> {
    if (
      !root ||
      !result.changed ||
      !activeTarget ||
      activeTarget.rootId !== root.id ||
      !pathIsWithinOrEqual(result.previousRelativePath, activeTarget.relativePath)
    ) {
      return;
    }

    const relativePath = relocateRelativePath(activeTarget.relativePath, result);
    const relocatedTarget: DesktopFileTarget =
      activeTarget.relativePath === result.previousRelativePath && result.entry.kind !== "directory"
        ? { rootId: root.id, ...result.entry }
        : { ...activeTarget, relativePath };

    if (relocatedTarget.kind === "markdown") {
      await onOpenMarkdown(relocatedTarget);
    } else {
      await onOpenMedia(relocatedTarget);
    }
  }

  function canAcceptExternalFileDrop(event: ReactDragEvent<HTMLElement>): boolean {
    return Boolean(
      root &&
      !isCreating &&
      !isImporting &&
      !isMutating &&
      Array.from(event.dataTransfer.types).includes("Files")
    );
  }

  function handleEntryPointerDown(event: ReactPointerEvent<HTMLElement>, entry: DesktopFolderEntry): void {
    if (
      !root ||
      event.button !== 0 ||
      !event.isPrimary ||
      isChoosingFolder ||
      isCreating ||
      isImporting ||
      isMutating ||
      openingPath
    ) {
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

    const finishPointerDrag = (cancelled: boolean) => {
      removeListeners();

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
      setOperationStatus(undefined);

      if (!cancelled && destinationRelativePath !== undefined) {
        void handleMoveEntry(entry, destinationRelativePath);
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
        setContextMenu(undefined);
        sourceElement.setAttribute("data-dragging", "true");
        document.body.classList.add("desktop-explorer-is-dragging");
        setOperationStatus(`Move ${entry.name} into a folder`);
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

    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("blur", handleWindowBlur);
  }

  function handleExplorerDragOver(event: ReactDragEvent<HTMLElement>): void {
    const relativePath = readDropDestination(event.target);

    if (relativePath === undefined) {
      return;
    }

    if (!canAcceptExternalFileDrop(event)) {
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

  async function handleExplorerDrop(event: ReactDragEvent<HTMLElement>): Promise<void> {
    if (!api || !root) {
      return;
    }

    const relativePath = readDropDestination(event.target);

    if (relativePath === undefined) {
      return;
    }

    if (!canAcceptExternalFileDrop(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);

    if (files.length === 0) {
      setDropTargetPath(undefined);
      return;
    }

    const rootId = root.id;
    setDropTargetPath(undefined);
    setIsImporting(true);
    setSidebarError(undefined);
    setOperationStatus(`Importing ${files.length} ${files.length === 1 ? "file" : "files"}…`);

    try {
      const result = await api.importDroppedFiles({ rootId, parentRelativePath: relativePath }, files);
      await loadDirectory(rootId, relativePath);
      setSelectedDirectoryPath(relativePath);
      setOperationStatus(
        `Imported ${result.imported.length} ${result.imported.length === 1 ? "file" : "files"}`
      );

      if (result.rejected.length > 0) {
        setSidebarError(`Skipped unsupported items: ${result.rejected.join(", ")}`);
      }
    } catch (error) {
      setOperationStatus(undefined);
      reportError(error);
    } finally {
      setIsImporting(false);
    }
  }

  function renderDirectory(relativePath: string, level: number): JSX.Element | null {
    const state = directories[relativePath];

    if (!state?.expanded) {
      return null;
    }

    return (
      <ul className="desktop-sidebar__tree-group" role={relativePath === "" ? "tree" : "group"}>
        {state.entries.map((entry) => {
          if (entry.kind === "directory") {
            const childState = directories[entry.relativePath];
            const isExpanded = childState?.expanded ?? false;

            return (
              <li
                aria-expanded={isExpanded}
                aria-level={level}
                className={`desktop-sidebar__tree-item desktop-sidebar__tree-item--directory${
                  dropTargetPath === entry.relativePath ? " desktop-sidebar__tree-item--drop-target" : ""
                }`}
                data-explorer-drop-path={entry.relativePath}
                key={entry.relativePath}
                role="treeitem"
              >
                <div
                  className="desktop-sidebar__entry-row"
                  data-move-enabled={!isChoosingFolder && !isCreating && !isImporting && !isMutating && !openingPath}
                  onPointerDown={(event) => handleEntryPointerDown(event, entry)}
                >
                  <button
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} folder ${entry.name}`}
                    className="desktop-sidebar__entry-button"
                    data-selected={selectedDirectoryPath === entry.relativePath}
                    onClickCapture={(event) => {
                      if (suppressClickRef.current) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                    onClick={() => handleToggleDirectory(entry)}
                    onContextMenu={(event) => handleEntryContextMenu(event, entry)}
                    type="button"
                  >
                    <span aria-hidden="true" className="desktop-sidebar__disclosure">
                      {isExpanded ? "▾" : "▸"}
                    </span>
                    <span aria-hidden="true" className="desktop-sidebar__entry-icon">
                      <FolderIcon />
                    </span>
                    <span className="desktop-sidebar__entry-name">{entry.name}</span>
                  </button>
                </div>

                {childState?.status === "loading" ? (
                  <span className="desktop-sidebar__inline-status" role="status">
                    Loading {entry.name}…
                  </span>
                ) : null}

                {childState?.status === "error" ? (
                  <div className="desktop-sidebar__inline-error" role="alert">
                    <span>{childState.error ?? "Folder unavailable"}</span>
                    <button onClick={() => root && void loadDirectory(root.id, entry.relativePath)} type="button">
                      Retry
                    </button>
                  </div>
                ) : null}

                {renderDirectory(entry.relativePath, level + 1)}
              </li>
            );
          }

          const isActive =
            activeTarget?.rootId === root?.id && activeTarget?.relativePath === entry.relativePath;
          const isOpening = openingPath === entry.relativePath;

          return (
            <li
              aria-level={level}
              aria-selected={isActive}
              className={`desktop-sidebar__tree-item desktop-sidebar__tree-item--${entry.kind}`}
              data-explorer-drop-path={apiParentPath(entry.relativePath)}
              key={entry.relativePath}
              role="treeitem"
            >
              <div
                className="desktop-sidebar__entry-row"
                data-move-enabled={!isChoosingFolder && !isCreating && !isImporting && !isMutating && !openingPath}
                onPointerDown={(event) => handleEntryPointerDown(event, entry)}
              >
                <button
                  aria-busy={isOpening}
                  aria-current={isActive ? "page" : undefined}
                  className="desktop-sidebar__entry-button"
                  disabled={isChoosingFolder || isCreating || isImporting || isMutating || Boolean(openingPath)}
                  onClickCapture={(event) => {
                    if (suppressClickRef.current) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                  onClick={() => void handleOpenFile(entry)}
                  onContextMenu={(event) => handleEntryContextMenu(event, entry)}
                  title={entry.relativePath}
                  type="button"
                >
                  <span aria-hidden="true" className="desktop-sidebar__entry-icon">
                    {iconForKind(entry.kind)}
                  </span>
                  <span className="desktop-sidebar__entry-name">{entry.name}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  if (!api) {
    return (
      <aside aria-label="Folder explorer" className="desktop-sidebar desktop-sidebar--unavailable">
        <p role="status">Folder navigation is available in the Windows desktop app.</p>
      </aside>
    );
  }

  const rootDirectory = directories[""];
  const isBusy = isChoosingFolder || isCreating || isImporting || isMutating || Boolean(openingPath);
  const selectedDirectoryLabel = selectedDirectoryPath || root?.name || "selected folder";

  return (
    <aside aria-label="Folder explorer" className="desktop-sidebar">
      <header className="desktop-sidebar__header">
        <div className="desktop-sidebar__title-block">
          <strong>Explorer</strong>
          {root ? (
            <button
              className="desktop-sidebar__root-button"
              data-selected={selectedDirectoryPath === ""}
              onClick={() => {
                setSelectedDirectoryPath("");
                cancelCreate();
                cancelRename();
              }}
              title={`${root.displayPath} · Select as create/drop target`}
              type="button"
            >
              {root.name}
            </button>
          ) : null}
        </div>
        <div className="desktop-sidebar__actions">
          <button
            aria-busy={isChoosingFolder}
            className="desktop-sidebar__choose-button"
            disabled={isBusy}
            onClick={() => void handleChooseFolder()}
            type="button"
          >
            {root ? "Open another folder" : "Open folder"}
          </button>
          {root ? (
            <button
              aria-label={`Refresh ${root.name}`}
              className="desktop-sidebar__refresh-button"
              disabled={isBusy || rootDirectory?.status === "loading"}
              onClick={handleRefreshRoot}
              title="Refresh folder"
              type="button"
            >
              ↻
            </button>
          ) : null}
        </div>
        {root ? (
          <div className="desktop-sidebar__create-actions" role="group" aria-label="Create explorer item">
            <button disabled={isBusy} onClick={() => startCreate("file")} title="New Markdown file" type="button">
              + File
            </button>
            <button disabled={isBusy} onClick={() => startCreate("folder")} title="New folder" type="button">
              + Folder
            </button>
          </div>
        ) : null}
      </header>

      {root && createMode ? (
        <form className="desktop-sidebar__create-form" onSubmit={(event) => void handleCreateSubmit(event)}>
          <label htmlFor="desktop-sidebar-create-name">
            <strong>{createMode === "file" ? "New Markdown file" : "New folder"}</strong>
            <span title={selectedDirectoryPath}>in {selectedDirectoryLabel}</span>
          </label>
          <input
            id="desktop-sidebar-create-name"
            autoFocus
            disabled={isCreating}
            onChange={(event) => setCreateName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelCreate();
              }
            }}
            placeholder={createMode === "file" ? "notes.md" : "Folder name"}
            spellCheck={false}
            value={createName}
          />
          <div>
            <button disabled={isCreating || createName.trim().length === 0} type="submit">
              {isCreating ? "Creating…" : "Create"}
            </button>
            <button disabled={isCreating} onClick={cancelCreate} type="button">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {root && renameTarget ? (
        <form className="desktop-sidebar__create-form" onSubmit={(event) => void handleRenameSubmit(event)}>
          <label htmlFor="desktop-sidebar-rename-name">
            <strong>Rename {renameTarget.kind === "directory" ? "folder" : "file"}</strong>
            <span title={renameTarget.relativePath}>{renameTarget.relativePath}</span>
          </label>
          <input
            id="desktop-sidebar-rename-name"
            autoFocus
            disabled={isMutating}
            onChange={(event) => setRenameName(event.currentTarget.value)}
            onFocus={(event) => {
              const extensionIndex = renameTarget.kind === "directory" ? -1 : renameTarget.name.lastIndexOf(".");
              event.currentTarget.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : renameTarget.name.length);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
            spellCheck={false}
            value={renameName}
          />
          <div>
            <button disabled={isMutating || renameName.trim().length === 0} type="submit">
              {isMutating ? "Renaming…" : "Rename"}
            </button>
            <button disabled={isMutating} onClick={cancelRename} type="button">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {sidebarError ? (
        <div className="desktop-sidebar__error" role="alert">
          {sidebarError}
        </div>
      ) : null}

      {operationStatus ? (
        <div className="desktop-sidebar__operation-status" role="status">
          {operationStatus}
        </div>
      ) : null}

      {!root ? (
        <div className="desktop-sidebar__empty">
          <p>Select a folder to browse Markdown and media files.</p>
        </div>
      ) : (
        <nav
          aria-busy={rootDirectory?.status === "loading" || isImporting}
          aria-label={`${root.name} contents`}
          className={dropTargetPath === "" ? "desktop-sidebar__root-drop-target" : undefined}
          data-explorer-drop-path=""
          onDragLeave={handleExplorerDragLeave}
          onDragOverCapture={handleExplorerDragOver}
          onDropCapture={(event) => void handleExplorerDrop(event)}
        >
          {rootDirectory?.status === "loading" && rootDirectory.entries.length === 0 ? (
            <p className="desktop-sidebar__status" role="status">
              Loading folder…
            </p>
          ) : null}
          {rootDirectory?.status === "loaded" && rootDirectory.entries.length === 0 ? (
            <p className="desktop-sidebar__status">No supported Markdown or media files found.</p>
          ) : null}
          {renderDirectory("", 1)}
        </nav>
      )}

      {contextMenu
        ? createPortal(
            <div
              aria-label={`Actions for ${contextMenu.entry.name}`}
              className="desktop-sidebar__context-menu"
              onContextMenu={(event) => event.preventDefault()}
              role="menu"
              style={{ left: contextMenu.left, top: contextMenu.top }}
            >
              <button onClick={() => startRename(contextMenu.entry)} role="menuitem" type="button">
                Rename
              </button>
              {canMoveEntryTo(contextMenu.entry, selectedDirectoryPath) ? (
                <button
                  onClick={() => void handleMoveEntry(contextMenu.entry, selectedDirectoryPath)}
                  role="menuitem"
                  title={selectedDirectoryPath}
                  type="button"
                >
                  Move to {selectedDirectoryLabel}
                </button>
              ) : null}
              <button
                className="desktop-sidebar__context-menu-delete"
                onClick={() => void handleTrashEntry(contextMenu.entry)}
                role="menuitem"
                type="button"
              >
                Move to Recycle Bin
              </button>
            </div>,
            document.body
          )
        : null}

      {pointerDrag
        ? createPortal(
            <div
              aria-hidden="true"
              className="desktop-sidebar__drag-preview"
              style={{ left: pointerDrag.clientX + 14, top: pointerDrag.clientY + 14 }}
            >
              <span className="desktop-sidebar__entry-icon">
                {pointerDrag.entry.kind === "directory" ? <FolderIcon /> : iconForKind(pointerDrag.entry.kind)}
              </span>
              <span>{pointerDrag.entry.name}</span>
            </div>,
            document.body
          )
        : null}
    </aside>
  );
}

function iconForKind(kind: DesktopFileTarget["kind"]): string {
  switch (kind) {
    case "markdown":
      return "M↓";
    case "image":
      return "▧";
    case "audio":
      return "♫";
    case "video":
      return "▶";
    case "pdf":
      return "PDF";
  }
}

function FolderIcon(): JSX.Element {
  return (
    <svg className="desktop-sidebar__folder-icon" viewBox="0 0 16 16" focusable="false">
      <path d="M1.75 4.25h4l1.15 1.4h7.35v6.6H1.75z" />
      <path d="M1.75 4.25v-1.5h4.1l1.2 1.5" />
    </svg>
  );
}

function readDropDestination(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }

  const dropTarget = target.closest<HTMLElement>("[data-explorer-drop-path]");
  return dropTarget?.dataset.explorerDropPath;
}

function apiParentPath(relativePath: string): string {
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex < 0 ? "" : relativePath.slice(0, separatorIndex);
}

function pathIsWithinOrEqual(parentPath: string, candidatePath: string): boolean {
  return parentPath === "" || candidatePath === parentPath || candidatePath.startsWith(`${parentPath}/`);
}

function relocateRelativePath(relativePath: string, result: DesktopEntryMutationResult): string {
  if (relativePath === result.previousRelativePath) {
    return result.entry.relativePath;
  }

  return `${result.entry.relativePath}${relativePath.slice(result.previousRelativePath.length)}`;
}
