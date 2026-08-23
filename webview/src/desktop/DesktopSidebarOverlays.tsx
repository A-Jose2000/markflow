import type { JSX } from "react";
import { createPortal } from "react-dom";

import { DesktopExplorerEntryIcon } from "./DesktopExplorerTree";
import type { DesktopExplorerPointerDrag } from "./useDesktopExplorerDrag";
import type { DesktopFolderEntry } from "./contracts";

export interface DesktopEntryContextMenuState {
  readonly entry: DesktopFolderEntry;
  readonly left: number;
  readonly top: number;
}

export interface DesktopEntryContextMenuProps {
  readonly menu: DesktopEntryContextMenuState | undefined;
  readonly moveDestinationLabel: string;
  readonly moveDestinationPath: string;
  readonly moveEnabled: boolean;
  readonly onMove: (entry: DesktopFolderEntry) => void;
  readonly onRename: (entry: DesktopFolderEntry) => void;
  readonly onTrash: (entry: DesktopFolderEntry) => void;
}

export function DesktopEntryContextMenu({
  menu,
  moveDestinationLabel,
  moveDestinationPath,
  moveEnabled,
  onMove,
  onRename,
  onTrash
}: DesktopEntryContextMenuProps): JSX.Element | null {
  if (!menu) {
    return null;
  }

  return createPortal(
    <div
      aria-label={`Actions for ${menu.entry.name}`}
      className="desktop-sidebar__context-menu"
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{ left: menu.left, top: menu.top }}
    >
      <button onClick={() => onRename(menu.entry)} role="menuitem" type="button">
        Rename
      </button>
      {moveEnabled ? (
        <button
          onClick={() => onMove(menu.entry)}
          role="menuitem"
          title={moveDestinationPath}
          type="button"
        >
          Move to {moveDestinationLabel}
        </button>
      ) : null}
      <button
        className="desktop-sidebar__context-menu-delete"
        onClick={() => onTrash(menu.entry)}
        role="menuitem"
        type="button"
      >
        Move to Recycle Bin
      </button>
    </div>,
    document.body
  );
}

export function DesktopExplorerDragPreview({
  pointerDrag
}: {
  readonly pointerDrag: DesktopExplorerPointerDrag | undefined;
}): JSX.Element | null {
  if (!pointerDrag) {
    return null;
  }

  return createPortal(
    <div
      aria-hidden="true"
      className="desktop-sidebar__drag-preview"
      style={{ left: pointerDrag.clientX + 14, top: pointerDrag.clientY + 14 }}
    >
      <DesktopExplorerEntryIcon kind={pointerDrag.entry.kind} />
      <span>{pointerDrag.entry.name}</span>
    </div>,
    document.body
  );
}
