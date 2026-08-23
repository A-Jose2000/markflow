import { useDesktopSaveController } from "./useDesktopSaveController";
import { useDesktopTabNavigation } from "./useDesktopTabNavigation";
import type {
  DesktopSaveState,
  DesktopView,
  DesktopWorkspaceSession,
  UseDesktopWorkspaceOptions
} from "./workspaceTypes";

export type {
  DesktopEditorPort,
  DesktopSaveState,
  DesktopView,
  DesktopWorkspaceSession,
  UseDesktopWorkspaceOptions
} from "./workspaceTypes";

export function useDesktopWorkspace({
  api,
  editor
}: UseDesktopWorkspaceOptions): DesktopWorkspaceSession {
  const save = useDesktopSaveController(api);
  const navigation = useDesktopTabNavigation({ api, editor, save });

  return {
    ...navigation,
    saveState: save.saveState,
    statusLabel: getDesktopStatusLabel(navigation.view, save.saveState),
    error: save.error,
    scheduleMarkdown: save.scheduleMarkdown,
    flushChanges: save.flushChanges,
    reportError: save.reportError,
    dismissError: save.clearError
  };
}

function getDesktopStatusLabel(view: DesktopView | undefined, saveState: DesktopSaveState): string {
  if (!view) {
    return "No file open";
  }

  if (view.type === "media") {
    return view.document.name;
  }

  switch (saveState) {
    case "loading":
      return `${view.document.name} · Reloading…`;
    case "saving":
      return `${view.document.name} · Saving…`;
    case "error":
      return `${view.document.name} · Save failed`;
    case "saved":
      return `${view.document.name} · Saved`;
    default:
      return view.document.name;
  }
}
