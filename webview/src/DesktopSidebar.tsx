import {
  useCallback,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type JSX
} from "react";
import {
  getDesktopApi,
  type DesktopFileTarget,
  type DesktopFolderEntry,
  type DesktopFolderRoot,
  type MarkflowDesktopApi
} from "./desktopApi";

type DirectoryLoadStatus = "idle" | "loading" | "loaded" | "error";
type CreateMode = "file" | "folder";

interface DirectoryState {
  readonly expanded: boolean;
  readonly status: DirectoryLoadStatus;
  readonly entries: DesktopFolderEntry[];
  readonly error?: string;
}

export interface DesktopSidebarProps {
  readonly api?: MarkflowDesktopApi;
  readonly activeTarget?: Pick<DesktopFileTarget, "rootId" | "relativePath">;
  readonly onBeforeChooseFolder?: () => void | Promise<void>;
  readonly onBeforeCreate?: () => void | Promise<void>;
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
  const [openingPath, setOpeningPath] = useState<string | undefined>();
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState("");
  const [createMode, setCreateMode] = useState<CreateMode | undefined>();
  const [createName, setCreateName] = useState("");
  const [dropTargetPath, setDropTargetPath] = useState<string | undefined>();
  const [operationStatus, setOperationStatus] = useState<string | undefined>();
  const [sidebarError, setSidebarError] = useState<string | undefined>();

  const reportError = useCallback(
    (error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error("Markflow could not complete that action.");
      setSidebarError(normalizedError.message);
      onError?.(normalizedError);
    },
    [onError]
  );

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
    if (!api || isChoosingFolder || openingPath || isCreating || isImporting) {
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
    if (!root || openingPath || isCreating || isImporting) {
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
    setOperationStatus(undefined);
    void loadDirectory(root.id, "");
  }

  function startCreate(mode: CreateMode): void {
    if (!root || isCreating || isImporting || isChoosingFolder || openingPath) {
      return;
    }

    setCreateMode(mode);
    setCreateName("");
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

  function canAcceptFileDrop(event: ReactDragEvent<HTMLElement>): boolean {
    return Boolean(root && !isCreating && !isImporting && Array.from(event.dataTransfer.types).includes("Files"));
  }

  function handleFileDragOver(event: ReactDragEvent<HTMLElement>, relativePath: string): void {
    if (!canAcceptFileDrop(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropTargetPath(relativePath);
  }

  function handleFileDragLeave(event: ReactDragEvent<HTMLElement>, relativePath: string): void {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setDropTargetPath((current) => (current === relativePath ? undefined : current));
  }

  async function handleFileDrop(event: ReactDragEvent<HTMLElement>, relativePath: string): Promise<void> {
    if (!api || !root || !canAcceptFileDrop(event)) {
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
                key={entry.relativePath}
                onDragLeave={(event) => handleFileDragLeave(event, entry.relativePath)}
                onDragOver={(event) => handleFileDragOver(event, entry.relativePath)}
                onDrop={(event) => void handleFileDrop(event, entry.relativePath)}
                role="treeitem"
              >
                <button
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} folder ${entry.name}`}
                  className="desktop-sidebar__entry-button"
                  data-selected={selectedDirectoryPath === entry.relativePath}
                  onClick={() => handleToggleDirectory(entry)}
                  type="button"
                >
                  <span aria-hidden="true" className="desktop-sidebar__disclosure">
                    {isExpanded ? "▾" : "▸"}
                  </span>
                  <span aria-hidden="true" className="desktop-sidebar__entry-icon">
                    📁
                  </span>
                  <span className="desktop-sidebar__entry-name">{entry.name}</span>
                </button>

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
              key={entry.relativePath}
              role="treeitem"
            >
              <button
                aria-busy={isOpening}
                aria-current={isActive ? "page" : undefined}
                className="desktop-sidebar__entry-button"
                disabled={isChoosingFolder || isCreating || isImporting || Boolean(openingPath)}
                onClick={() => void handleOpenFile(entry)}
                title={entry.relativePath}
                type="button"
              >
                <span aria-hidden="true" className="desktop-sidebar__entry-icon">
                  {iconForKind(entry.kind)}
                </span>
                <span className="desktop-sidebar__entry-name">{entry.name}</span>
              </button>
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
  const isBusy = isChoosingFolder || isCreating || isImporting || Boolean(openingPath);
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
          onDragLeave={(event) => handleFileDragLeave(event, "")}
          onDragOver={(event) => handleFileDragOver(event, "")}
          onDrop={(event) => void handleFileDrop(event, "")}
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
