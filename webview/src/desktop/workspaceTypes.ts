import type {
  DesktopEntryMutationResult,
  DesktopFileTarget,
  DesktopFolderEntry,
  DesktopFolderRoot,
  DesktopMarkdownDocument,
  DesktopMediaDocument,
  MarkflowDesktopApi
} from "./contracts";

export type DesktopView =
  | { type: "markdown"; document: DesktopMarkdownDocument }
  | { type: "media"; document: DesktopMediaDocument };

export type DesktopSaveState = "idle" | "loading" | "saving" | "saved" | "error";

export interface DesktopEditorPort {
  clearMarkdown(): void;
  getScrollElement(): HTMLElement | null;
  presentMarkdown(markdown: string): void;
}

export interface UseDesktopWorkspaceOptions {
  readonly api: MarkflowDesktopApi | undefined;
  readonly editor: DesktopEditorPort;
}

export interface DesktopWorkspaceSession {
  readonly view?: DesktopView;
  readonly resourcePath?: string;
  readonly activeTarget?: DesktopFileTarget;
  readonly tabs: readonly DesktopFileTarget[];
  readonly activeTabId?: string;
  readonly navigationPending: boolean;
  readonly saveState: DesktopSaveState;
  readonly statusLabel: string;
  readonly error?: string;
  scheduleMarkdown(markdown: string): void;
  flushChanges(): Promise<void>;
  openTarget(target: DesktopFileTarget): Promise<void>;
  activateTab(target: DesktopFileTarget): void;
  reorderTab(sourceTabId: string, insertionIndex: number): void;
  closeTab(tabId: string): void;
  changeFolder(root: DesktopFolderRoot): void;
  relocateEntry(rootId: string, result: DesktopEntryMutationResult): Promise<void>;
  deleteEntry(rootId: string, entry: DesktopFolderEntry): void;
  reportError(error: Error): void;
  dismissError(): void;
  discardAndReload(): Promise<void>;
}
