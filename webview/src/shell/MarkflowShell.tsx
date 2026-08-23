import type { ReactNode, RefObject } from "react";

import { DesktopSidebar } from "../DesktopSidebar";
import { DesktopTabs } from "../DesktopTabs";
import type { DesktopWorkspaceSession } from "../desktop/useDesktopWorkspace";
import type { MarkflowDesktopApi } from "../desktopApi";
import { EditorModeSwitcher, type EditorMode } from "../editor/EditorSurface";
import { DesktopMediaPreview } from "./DesktopMediaPreview";

const MARKFLOW_ICON_URL = new URL("../assets/markflow-icon.png", import.meta.url).href;

interface MarkflowShellProps {
  appShellRef: RefObject<HTMLElement | null>;
  desktopApi?: MarkflowDesktopApi;
  editorMode: EditorMode;
  editorSurface: ReactNode;
  markdownLength: number;
  onCompositionEnd: () => void;
  onCompositionStart: () => void;
  onContextMenuCapture: () => void;
  onEditorModeChange: (mode: EditorMode) => void;
  resourcePath?: string;
  richEditorAvailable: boolean;
  richEditorLoadError?: string;
  vscodeContext: string;
  workspace: DesktopWorkspaceSession;
}

export function MarkflowShell({
  appShellRef,
  desktopApi,
  editorMode,
  editorSurface,
  markdownLength,
  onCompositionEnd,
  onCompositionStart,
  onContextMenuCapture,
  onEditorModeChange,
  resourcePath,
  richEditorAvailable,
  richEditorLoadError,
  vscodeContext,
  workspace
}: MarkflowShellProps) {
  return (
    <main
      ref={appShellRef}
      className={`app-shell${desktopApi ? " app-shell--desktop" : ""}`}
      data-vscode-context={vscodeContext}
      onContextMenuCapture={onContextMenuCapture}
      onCompositionEnd={onCompositionEnd}
      onCompositionStart={onCompositionStart}
    >
      {desktopApi ? (
        <DesktopSidebar
          activeTarget={workspace.activeTarget}
          api={desktopApi}
          onBeforeChooseFolder={workspace.flushChanges}
          onBeforeCreate={workspace.flushChanges}
          onBeforeMutate={workspace.flushChanges}
          onEntryDeleted={workspace.deleteEntry}
          onEntryRelocated={workspace.relocateEntry}
          onError={workspace.reportError}
          onFolderChanged={workspace.changeFolder}
          onOpenMarkdown={workspace.openTarget}
          onOpenMedia={workspace.openTarget}
        />
      ) : null}

      <section className="app-workspace">
        {desktopApi ? (
          <DesktopTabs
            activeTabId={workspace.activeTabId}
            disabled={workspace.navigationPending}
            onActivate={workspace.activateTab}
            onClose={workspace.closeTab}
            onReorder={workspace.reorderTab}
            tabs={workspace.tabs}
          />
        ) : null}

        <header className="app-topbar">
          <div className="topbar-actions">
            {!desktopApi || workspace.view?.type === "markdown" ? (
              <EditorModeSwitcher
                editorMode={editorMode}
                loadError={richEditorLoadError}
                onChange={onEditorModeChange}
                richAvailable={richEditorAvailable}
              />
            ) : null}
          </div>

          <div className="document-status" aria-live="polite" title={resourcePath}>
            {desktopApi
              ? workspace.statusLabel
              : markdownLength === 0
                ? "0 characters loaded"
                : `${markdownLength} characters loaded`}
          </div>
        </header>

        {workspace.error ? (
          <div className="desktop-workspace-error" role="alert">
            <span>{workspace.error}</span>
            <div className="desktop-workspace-error__actions">
              {workspace.saveState === "error" && workspace.view?.type === "markdown" ? (
                <button
                  className="desktop-workspace-error__reload"
                  onClick={() => void workspace.discardAndReload()}
                  type="button"
                >
                  Discard &amp; reload
                </button>
              ) : null}
              <button aria-label="Dismiss error" onClick={workspace.dismissError} type="button">
                ×
              </button>
            </div>
          </div>
        ) : null}

        <section className="editor-stage">
          {desktopApi && !workspace.view ? (
            <section className="desktop-welcome" aria-label="Markflow desktop welcome">
              <img alt="" aria-hidden="true" className="desktop-welcome__icon" src={MARKFLOW_ICON_URL} />
              <h1>Open a folder to start</h1>
              <p>Choose a Markdown or media file from the Explorer. Markdown changes are saved automatically.</p>
            </section>
          ) : workspace.view?.type === "media" ? (
            <DesktopMediaPreview document={workspace.view.document} />
          ) : (
            editorSurface
          )}
        </section>
      </section>
    </main>
  );
}
