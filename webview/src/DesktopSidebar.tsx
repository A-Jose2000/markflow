import type { JSX } from "react";

import { getDesktopApi } from "./desktopApi";
import { DesktopExplorerTree } from "./desktop/DesktopExplorerTree";
import { DesktopCreateForm, DesktopRenameForm } from "./desktop/DesktopSidebarForms";
import {
  DesktopEntryContextMenu,
  DesktopExplorerDragPreview
} from "./desktop/DesktopSidebarOverlays";
import type { DesktopSidebarProps } from "./desktop/sidebarTypes";
import { useDesktopSidebarController } from "./desktop/useDesktopSidebarController";

export type { DesktopSidebarProps } from "./desktop/sidebarTypes";

export function DesktopSidebar(props: DesktopSidebarProps): JSX.Element {
  const api = props.api ?? getDesktopApi();
  const controller = useDesktopSidebarController({ ...props, api });

  if (!api) {
    return (
      <aside aria-label="Folder explorer" className="desktop-sidebar desktop-sidebar--unavailable">
        <p role="status">Folder navigation is available in the Windows desktop app.</p>
      </aside>
    );
  }

  const {
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
    pointerDrag
  } = controller;

  return (
    <aside aria-label="Folder explorer" className="desktop-sidebar">
      <header className="desktop-sidebar__header">
        <div className="desktop-sidebar__title-block">
          <strong>Explorer</strong>
          {root ? (
            <button
              className="desktop-sidebar__root-button"
              data-selected={selectedDirectoryPath === ""}
              onClick={controller.selectRootDirectory}
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
            onClick={() => void controller.handleChooseFolder()}
            type="button"
          >
            {root ? "Open another folder" : "Open folder"}
          </button>
          {root ? (
            <button
              aria-label={`Refresh ${root.name}`}
              className="desktop-sidebar__refresh-button"
              disabled={isBusy || rootDirectory?.status === "loading"}
              onClick={controller.handleRefreshRoot}
              title="Refresh folder"
              type="button"
            >
              ↻
            </button>
          ) : null}
        </div>
        {root ? (
          <div className="desktop-sidebar__create-actions" role="group" aria-label="Create explorer item">
            <button
              disabled={isBusy}
              onClick={() => controller.startCreate("file")}
              title="New Markdown file"
              type="button"
            >
              + File
            </button>
            <button
              disabled={isBusy}
              onClick={() => controller.startCreate("folder")}
              title="New folder"
              type="button"
            >
              + Folder
            </button>
          </div>
        ) : null}
      </header>

      {root && createMode ? (
        <DesktopCreateForm
          mode={createMode}
          name={createName}
          onCancel={controller.cancelCreate}
          onNameChange={controller.setCreateName}
          onSubmit={(event) => void controller.handleCreateSubmit(event)}
          selectedDirectoryLabel={selectedDirectoryLabel}
          selectedDirectoryPath={selectedDirectoryPath}
          submitting={isCreating}
        />
      ) : null}

      {root && renameTarget ? (
        <DesktopRenameForm
          name={renameName}
          onCancel={controller.cancelRename}
          onNameChange={controller.setRenameName}
          onSubmit={(event) => void controller.handleRenameSubmit(event)}
          submitting={isMutating}
          target={renameTarget}
        />
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
          onDragLeave={controller.handleExplorerDragLeave}
          onDragOverCapture={controller.handleExplorerDragOver}
          onDropCapture={controller.handleExplorerDrop}
        >
          {rootDirectory?.status === "loading" && rootDirectory.entries.length === 0 ? (
            <p className="desktop-sidebar__status" role="status">
              Loading folder…
            </p>
          ) : null}
          {rootDirectory?.status === "loaded" && rootDirectory.entries.length === 0 ? (
            <p className="desktop-sidebar__status">No supported Markdown or media files found.</p>
          ) : null}
          <DesktopExplorerTree
            activeTarget={props.activeTarget}
            busy={isBusy}
            directories={directories}
            dropTargetPath={dropTargetPath}
            onEntryClickCapture={controller.handleEntryClickCapture}
            onEntryContextMenu={controller.handleEntryContextMenu}
            onEntryPointerDown={controller.handleEntryPointerDown}
            onOpenFile={(entry) => void controller.handleOpenFile(entry)}
            onRetryDirectory={(entry) => void controller.loadDirectory(root.id, entry.relativePath)}
            onToggleDirectory={controller.handleToggleDirectory}
            openingPath={openingPath}
            rootId={root.id}
            selectedDirectoryPath={selectedDirectoryPath}
          />
        </nav>
      )}

      <DesktopEntryContextMenu
        menu={contextMenu}
        moveDestinationLabel={selectedDirectoryLabel}
        moveDestinationPath={selectedDirectoryPath}
        moveEnabled={Boolean(
          contextMenu && controller.canMoveEntryTo(contextMenu.entry, selectedDirectoryPath)
        )}
        onMove={(entry) => void controller.handleMoveEntry(entry, selectedDirectoryPath)}
        onRename={controller.startRename}
        onTrash={(entry) => void controller.handleTrashEntry(entry)}
      />

      <DesktopExplorerDragPreview pointerDrag={pointerDrag} />
    </aside>
  );
}
