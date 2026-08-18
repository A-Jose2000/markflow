import { useCallback, useRef, useState, type JSX } from "react";
import {
  getDesktopApi,
  type DesktopFileTarget,
  type DesktopFolderEntry,
  type DesktopFolderRoot,
  type MarkflowDesktopApi
} from "./desktopApi";

type DirectoryLoadStatus = "idle" | "loading" | "loaded" | "error";

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
  readonly onFolderChanged?: (root: DesktopFolderRoot) => void;
  readonly onOpenMarkdown: (target: DesktopFileTarget) => void | Promise<void>;
  readonly onOpenMedia: (target: DesktopFileTarget) => void | Promise<void>;
  readonly onError?: (error: Error) => void;
}

export function DesktopSidebar({
  api: providedApi,
  activeTarget,
  onBeforeChooseFolder,
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
  const [openingPath, setOpeningPath] = useState<string | undefined>();
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
    if (!api || isChoosingFolder || openingPath) {
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
    if (!root || openingPath) {
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
    void loadDirectory(root.id, "");
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
                className="desktop-sidebar__tree-item desktop-sidebar__tree-item--directory"
                key={entry.relativePath}
                role="treeitem"
              >
                <button
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} folder ${entry.name}`}
                  className="desktop-sidebar__entry-button"
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
                disabled={isChoosingFolder || Boolean(openingPath)}
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

  return (
    <aside aria-label="Folder explorer" className="desktop-sidebar">
      <header className="desktop-sidebar__header">
        <div className="desktop-sidebar__title-block">
          <strong>Explorer</strong>
          {root ? <span title={root.displayPath}>{root.name}</span> : null}
        </div>
        <div className="desktop-sidebar__actions">
          <button
            aria-busy={isChoosingFolder}
            className="desktop-sidebar__choose-button"
            disabled={isChoosingFolder || Boolean(openingPath)}
            onClick={() => void handleChooseFolder()}
            type="button"
          >
            {root ? "Open another folder" : "Open folder"}
          </button>
          {root ? (
            <button
              aria-label={`Refresh ${root.name}`}
              className="desktop-sidebar__refresh-button"
              disabled={isChoosingFolder || Boolean(openingPath) || rootDirectory?.status === "loading"}
              onClick={handleRefreshRoot}
              title="Refresh folder"
              type="button"
            >
              ↻
            </button>
          ) : null}
        </div>
      </header>

      {sidebarError ? (
        <div className="desktop-sidebar__error" role="alert">
          {sidebarError}
        </div>
      ) : null}

      {!root ? (
        <div className="desktop-sidebar__empty">
          <p>Select a folder to browse Markdown and media files.</p>
        </div>
      ) : (
        <nav aria-busy={rootDirectory?.status === "loading"} aria-label={`${root.name} contents`}>
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
