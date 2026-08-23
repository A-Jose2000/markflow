import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent
} from "react";

import type {
  DesktopEntryMutationResult,
  DesktopFileTarget,
  DesktopFolderEntry
} from "./contracts";
import type { DesktopCreateMode } from "./DesktopSidebarForms";
import type { DesktopEntryContextMenuState } from "./DesktopSidebarOverlays";
import {
  getDesktopParentPath,
  isDesktopPathWithinOrEqual,
  relocateDesktopPath
} from "./pathModel";
import type { DesktopSidebarControllerOptions } from "./sidebarTypes";
import { useDesktopDirectoryCache } from "./useDesktopDirectoryCache";
import { useDesktopExplorerDrag } from "./useDesktopExplorerDrag";

export function useDesktopSidebarController({
  api,
  onBeforeChooseFolder,
  onBeforeCreate,
  onBeforeMutate,
  onEntryDeleted,
  onEntryRelocated,
  onFolderChanged,
  onOpenMarkdown,
  onOpenMedia,
  onError
}: DesktopSidebarControllerOptions) {
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | undefined>();
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState("");
  const [createMode, setCreateMode] = useState<DesktopCreateMode | undefined>();
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<DesktopFolderEntry | undefined>();
  const [renameName, setRenameName] = useState("");
  const [contextMenu, setContextMenu] = useState<DesktopEntryContextMenuState | undefined>();
  const [operationStatus, setOperationStatus] = useState<string | undefined>();
  const [sidebarError, setSidebarError] = useState<string | undefined>();

  const reportError = useCallback(
    (error: unknown) => {
      const normalizedError =
        error instanceof Error ? error : new Error("Markflow could not complete that action.");
      setSidebarError(normalizedError.message);
      onError?.(normalizedError);
    },
    [onError]
  );

  const {
    root,
    directories,
    activateRoot,
    loadDirectory,
    primeEmptyDirectory,
    refreshAfterMutation,
    refreshRoot: refreshDirectoryCache,
    removeCachedDirectorySubtree,
    toggleDirectory
  } = useDesktopDirectoryCache({
    api,
    onLoadStart: () => setSidebarError(undefined),
    onError: reportError
  });

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

      activateRoot(selectedRoot);
      setSelectedDirectoryPath("");
      resetForms();
      setContextMenu(undefined);
      setOperationStatus(undefined);
      onFolderChanged?.(selectedRoot);
      await loadDirectory(selectedRoot.id, "");
    } catch (error) {
      reportError(error);
    } finally {
      setIsChoosingFolder(false);
    }
  }

  function handleToggleDirectory(
    entry: Extract<DesktopFolderEntry, { kind: "directory" }>
  ): void {
    if (!root) {
      return;
    }

    setSelectedDirectoryPath(entry.relativePath);
    resetForms();
    setContextMenu(undefined);
    toggleDirectory(entry.relativePath);
  }

  async function handleOpenFile(
    entry: Exclude<DesktopFolderEntry, { kind: "directory" }>
  ): Promise<void> {
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

    refreshDirectoryCache();
    setSelectedDirectoryPath("");
    resetForms();
    setContextMenu(undefined);
    setOperationStatus(undefined);
  }

  function selectRootDirectory(): void {
    setSelectedDirectoryPath("");
    cancelCreate();
    cancelRename();
  }

  function startCreate(mode: DesktopCreateMode): void {
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
        const entry = await api.createMarkdownFile({ rootId, parentRelativePath, name: createName });
        await loadDirectory(rootId, parentRelativePath);
        setCreateMode(undefined);
        setCreateName("");
        setOperationStatus(`Created ${entry.name}`);
        await onOpenMarkdown({ rootId, ...entry });
      } else {
        const entry = await api.createFolder({ rootId, parentRelativePath, name: createName });
        await loadDirectory(rootId, parentRelativePath);
        primeEmptyDirectory(entry.relativePath);
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
      setOperationStatus(
        result.changed ? `Renamed to ${result.entry.name}` : `${result.entry.name} was unchanged`
      );
      await onEntryRelocated?.(root.id, result);
    } catch (error) {
      setOperationStatus(undefined);
      reportError(error);
    } finally {
      setIsMutating(false);
    }
  }

  async function handleMoveEntry(
    entry: DesktopFolderEntry,
    destinationParentRelativePath: string
  ): Promise<void> {
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
      setOperationStatus(
        result.changed ? `Moved ${result.entry.name}` : `${result.entry.name} is already there`
      );
      await onEntryRelocated?.(root.id, result);
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
      `Move ${entry.name} to the Windows Recycle Bin?${
        entry.kind === "directory" ? " Its contents will be moved too." : ""
      }`
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
      const parentRelativePath = getDesktopParentPath(entry.relativePath);
      await loadDirectory(root.id, parentRelativePath);

      if (isDesktopPathWithinOrEqual(entry.relativePath, selectedDirectoryPath)) {
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

  function handleEntryContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    entry: DesktopFolderEntry
  ): void {
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

  function canMoveEntryTo(
    entry: DesktopFolderEntry,
    destinationParentRelativePath: string
  ): boolean {
    if (getDesktopParentPath(entry.relativePath) === destinationParentRelativePath) {
      return false;
    }

    return (
      entry.kind !== "directory" ||
      !isDesktopPathWithinOrEqual(entry.relativePath, destinationParentRelativePath)
    );
  }

  function relocateSelectedDirectory(result: DesktopEntryMutationResult): void {
    if (
      !result.changed ||
      !isDesktopPathWithinOrEqual(result.previousRelativePath, selectedDirectoryPath)
    ) {
      return;
    }

    setSelectedDirectoryPath(relocateDesktopPath(selectedDirectoryPath, result));
  }

  async function handleImportFiles(relativePath: string, files: File[]): Promise<void> {
    if (!api || !root || isCreating || isImporting || isMutating) {
      return;
    }

    const rootId = root.id;
    setIsImporting(true);
    setSidebarError(undefined);
    setOperationStatus(`Importing ${files.length} ${files.length === 1 ? "file" : "files"}…`);

    try {
      const result = await api.importDroppedFiles(
        { rootId, parentRelativePath: relativePath },
        files
      );
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

  const {
    dropTargetPath,
    pointerDrag,
    handleEntryClickCapture,
    handleEntryPointerDown,
    handleExplorerDragLeave,
    handleExplorerDragOver,
    handleExplorerDrop
  } = useDesktopExplorerDrag({
    importsEnabled: Boolean(api && root && !isCreating && !isImporting && !isMutating),
    movesEnabled: Boolean(
      root && !isChoosingFolder && !isCreating && !isImporting && !isMutating && !openingPath
    ),
    canMoveEntryTo,
    onImportFiles: handleImportFiles,
    onMoveEntry: handleMoveEntry,
    onMoveStatusChange: setOperationStatus,
    onPointerDragStart: () => setContextMenu(undefined)
  });

  const rootDirectory = directories[""];
  const isBusy =
    isChoosingFolder || isCreating || isImporting || isMutating || Boolean(openingPath);
  const selectedDirectoryLabel = selectedDirectoryPath || root?.name || "selected folder";

  function resetForms(): void {
    setCreateMode(undefined);
    setCreateName("");
    setRenameTarget(undefined);
    setRenameName("");
  }

  return {
    root,
    directories,
    rootDirectory,
    isBusy,
    isChoosingFolder,
    isCreating,
    isImporting,
    isMutating,
    openingPath,
    selectedDirectoryPath,
    selectedDirectoryLabel,
    createMode,
    createName,
    renameTarget,
    renameName,
    contextMenu,
    operationStatus,
    sidebarError,
    dropTargetPath,
    pointerDrag,
    setCreateName,
    setRenameName,
    selectRootDirectory,
    handleChooseFolder,
    handleToggleDirectory,
    handleOpenFile,
    handleRefreshRoot,
    startCreate,
    cancelCreate,
    handleCreateSubmit,
    startRename,
    cancelRename,
    handleRenameSubmit,
    handleMoveEntry,
    handleTrashEntry,
    handleEntryContextMenu,
    canMoveEntryTo,
    loadDirectory,
    handleEntryClickCapture,
    handleEntryPointerDown,
    handleExplorerDragLeave,
    handleExplorerDragOver,
    handleExplorerDrop
  };
}
