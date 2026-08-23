import type {
  JSX,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import type { DesktopFileTarget, DesktopFolderEntry } from "../desktopApi";
import { getDesktopParentPath } from "./pathModel";
import type { DesktopExplorerDirectoryState } from "./useDesktopDirectoryCache";

export type DesktopExplorerDirectoryEntry = Extract<DesktopFolderEntry, { kind: "directory" }>;
export type DesktopExplorerFileEntry = Exclude<DesktopFolderEntry, { kind: "directory" }>;

export interface DesktopExplorerTreeProps {
  readonly activeTarget?: DesktopFileTarget;
  readonly busy: boolean;
  readonly directories: Readonly<Record<string, DesktopExplorerDirectoryState>>;
  readonly dropTargetPath?: string;
  readonly openingPath?: string;
  readonly rootId: string;
  readonly selectedDirectoryPath: string;
  readonly onEntryClickCapture: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly onEntryContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    entry: DesktopFolderEntry
  ) => void;
  readonly onEntryPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    entry: DesktopFolderEntry
  ) => void;
  readonly onOpenFile: (entry: DesktopExplorerFileEntry) => void;
  readonly onRetryDirectory: (entry: DesktopExplorerDirectoryEntry) => void;
  readonly onToggleDirectory: (entry: DesktopExplorerDirectoryEntry) => void;
}

interface DesktopExplorerDirectoryProps extends DesktopExplorerTreeProps {
  readonly level: number;
  readonly relativePath: string;
}

export function DesktopExplorerTree(props: DesktopExplorerTreeProps): JSX.Element | null {
  return <DesktopExplorerDirectory {...props} level={1} relativePath="" />;
}

function DesktopExplorerDirectory({
  activeTarget,
  busy,
  directories,
  dropTargetPath,
  level,
  openingPath,
  relativePath,
  rootId,
  selectedDirectoryPath,
  onEntryClickCapture,
  onEntryContextMenu,
  onEntryPointerDown,
  onOpenFile,
  onRetryDirectory,
  onToggleDirectory
}: DesktopExplorerDirectoryProps): JSX.Element | null {
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
              className={
                "desktop-sidebar__tree-item desktop-sidebar__tree-item--directory" +
                (dropTargetPath === entry.relativePath ? " desktop-sidebar__tree-item--drop-target" : "")
              }
              data-explorer-drop-path={entry.relativePath}
              key={entry.relativePath}
              role="treeitem"
            >
              <div
                className="desktop-sidebar__entry-row"
                data-move-enabled={!busy}
                onPointerDown={(event) => onEntryPointerDown(event, entry)}
              >
                <button
                  aria-label={(isExpanded ? "Collapse" : "Expand") + " folder " + entry.name}
                  className="desktop-sidebar__entry-button"
                  data-selected={selectedDirectoryPath === entry.relativePath}
                  onClickCapture={onEntryClickCapture}
                  onClick={() => onToggleDirectory(entry)}
                  onContextMenu={(event) => onEntryContextMenu(event, entry)}
                  type="button"
                >
                  <span aria-hidden="true" className="desktop-sidebar__disclosure">
                    {isExpanded ? "▾" : "▸"}
                  </span>
                  <DesktopExplorerEntryIcon ariaHidden kind={entry.kind} />
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
                  <button onClick={() => onRetryDirectory(entry)} type="button">
                    Retry
                  </button>
                </div>
              ) : null}

              <DesktopExplorerDirectory
                activeTarget={activeTarget}
                busy={busy}
                directories={directories}
                dropTargetPath={dropTargetPath}
                level={level + 1}
                onEntryClickCapture={onEntryClickCapture}
                onEntryContextMenu={onEntryContextMenu}
                onEntryPointerDown={onEntryPointerDown}
                onOpenFile={onOpenFile}
                onRetryDirectory={onRetryDirectory}
                onToggleDirectory={onToggleDirectory}
                openingPath={openingPath}
                relativePath={entry.relativePath}
                rootId={rootId}
                selectedDirectoryPath={selectedDirectoryPath}
              />
            </li>
          );
        }

        const isActive = activeTarget?.rootId === rootId && activeTarget.relativePath === entry.relativePath;
        const isOpening = openingPath === entry.relativePath;

        return (
          <li
            aria-level={level}
            aria-selected={isActive}
            className={"desktop-sidebar__tree-item desktop-sidebar__tree-item--" + entry.kind}
            data-explorer-drop-path={getDesktopParentPath(entry.relativePath)}
            key={entry.relativePath}
            role="treeitem"
          >
            <div
              className="desktop-sidebar__entry-row"
              data-move-enabled={!busy}
              onPointerDown={(event) => onEntryPointerDown(event, entry)}
            >
              <button
                aria-busy={isOpening}
                aria-current={isActive ? "page" : undefined}
                className="desktop-sidebar__entry-button"
                disabled={busy}
                onClickCapture={onEntryClickCapture}
                onClick={() => onOpenFile(entry)}
                onContextMenu={(event) => onEntryContextMenu(event, entry)}
                title={entry.relativePath}
                type="button"
              >
                <DesktopExplorerEntryIcon ariaHidden kind={entry.kind} />
                <span className="desktop-sidebar__entry-name">{entry.name}</span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function DesktopExplorerEntryIcon({
  ariaHidden = false,
  kind
}: {
  readonly ariaHidden?: boolean;
  readonly kind: DesktopFolderEntry["kind"];
}): JSX.Element {
  return (
    <span aria-hidden={ariaHidden || undefined} className="desktop-sidebar__entry-icon">
      {kind === "directory" ? <FolderIcon /> : iconForKind(kind)}
    </span>
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
