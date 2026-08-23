import { useEffect, useMemo, useRef, useState } from "react";

import type {
  DesktopEntryMutationResult,
  DesktopFileTarget,
  DesktopFolderEntry,
  DesktopFolderRoot,
  MarkflowDesktopApi
} from "./contracts";
import {
  deleteDesktopTabsWithinEntry,
  desktopTabId,
  relocateDesktopTabs,
  reorderDesktopTabs,
  upsertDesktopTab
} from "./tabModel";
import { createDesktopTabScrollController } from "./tabScrollController";
import type { DesktopSaveController } from "./useDesktopSaveController";
import { useDesktopShortcuts } from "./useDesktopShortcuts";
import type { DesktopEditorPort, DesktopView } from "./workspaceTypes";

export interface DesktopTabNavigationSession {
  readonly activeTabId?: string;
  readonly activeTarget?: DesktopFileTarget;
  readonly navigationPending: boolean;
  readonly resourcePath?: string;
  readonly tabs: readonly DesktopFileTarget[];
  readonly view?: DesktopView;
  activateTab(target: DesktopFileTarget): void;
  changeFolder(root: DesktopFolderRoot): void;
  closeTab(tabId: string): void;
  deleteEntry(rootId: string, entry: DesktopFolderEntry): void;
  discardAndReload(): Promise<void>;
  openTarget(target: DesktopFileTarget): Promise<void>;
  relocateEntry(rootId: string, result: DesktopEntryMutationResult): Promise<void>;
  reorderTab(sourceTabId: string, insertionIndex: number): void;
}

export interface UseDesktopTabNavigationOptions {
  readonly api: MarkflowDesktopApi | undefined;
  readonly editor: DesktopEditorPort;
  readonly save: DesktopSaveController;
}

export function useDesktopTabNavigation({
  api,
  editor,
  save
}: UseDesktopTabNavigationOptions): DesktopTabNavigationSession {
  const navigationGenerationRef = useRef(0);
  const navigationPendingRef = useRef(false);
  const tabsRef = useRef<DesktopFileTarget[]>([]);
  const activeTabIdRef = useRef<string | undefined>(undefined);
  const tabScrollController = useMemo(() => createDesktopTabScrollController(editor), [editor]);
  const [view, setView] = useState<DesktopView | undefined>();
  const [resourcePath, setResourcePath] = useState<string | undefined>();
  const [activeTarget, setActiveTarget] = useState<DesktopFileTarget | undefined>();
  const [tabs, setTabs] = useState<DesktopFileTarget[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | undefined>();
  const [navigationPending, setNavigationPending] = useState(false);

  useEffect(() => () => tabScrollController.dispose(), [tabScrollController]);

  useDesktopShortcuts({
    enabled: Boolean(api),
    onCloseActiveTab: closeActiveTabFromShortcut,
    onCycleTab: cycleTabFromShortcut,
    onSave: () => void save.saveNow()
  });

  function closeActiveTabFromShortcut(): boolean {
    const currentActiveTabId = activeTabIdRef.current;

    if (!currentActiveTabId) {
      return false;
    }

    closeTab(currentActiveTabId);
    return true;
  }

  function cycleTabFromShortcut(direction: -1 | 1): boolean {
    const currentTabs = tabsRef.current;

    if (currentTabs.length <= 1) {
      return false;
    }

    const activeIndex = currentTabs.findIndex(
      (tab) => desktopTabId(tab) === activeTabIdRef.current
    );
    const nextIndex = (Math.max(activeIndex, 0) + direction + currentTabs.length) % currentTabs.length;
    const nextTarget = currentTabs[nextIndex];

    if (!nextTarget) {
      return false;
    }

    activateTab(nextTarget);
    return true;
  }

  function commitTabs(
    update: DesktopFileTarget[] | ((current: DesktopFileTarget[]) => DesktopFileTarget[])
  ): DesktopFileTarget[] {
    const nextTabs = typeof update === "function" ? update(tabsRef.current) : update;
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    return nextTabs;
  }

  function commitActiveTab(tabId: string | undefined): void {
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
  }

  function registerTab(target: DesktopFileTarget): void {
    commitTabs((current) => upsertDesktopTab(current, target));
    commitActiveTab(desktopTabId(target));
  }

  function clearView(nextResourcePath?: string): void {
    save.disposeDocument();
    setView(undefined);
    setActiveTarget(undefined);
    save.setIdle();
    save.clearError();
    setResourcePath(nextResourcePath);
    editor.clearMarkdown();
  }

  async function loadTarget(
    target: DesktopFileTarget,
    navigationGeneration: number,
    shouldRegisterTab: boolean
  ): Promise<boolean> {
    if (!api) {
      return false;
    }

    if (target.kind === "markdown") {
      save.setLoading();
      const document = await api.openMarkdown({
        rootId: target.rootId,
        relativePath: target.relativePath
      });

      if (navigationGeneration !== navigationGenerationRef.current) {
        return false;
      }

      save.trackDocument(document);
      setActiveTarget(target);
      setView({ type: "markdown", document });
      setResourcePath(document.displayPath);
      editor.presentMarkdown(document.markdown);
    } else {
      const document = await api.openMedia({
        rootId: target.rootId,
        relativePath: target.relativePath
      });

      if (navigationGeneration !== navigationGenerationRef.current) {
        return false;
      }

      save.disposeDocument();
      save.clearError();
      save.setIdle();
      setActiveTarget(target);
      setView({ type: "media", document });
      setResourcePath(document.displayPath);
    }

    if (shouldRegisterTab) {
      registerTab(target);
    } else {
      commitActiveTab(desktopTabId(target));
    }

    const tabId = desktopTabId(target);
    tabScrollController.restore(tabId, () => activeTabIdRef.current === tabId);
    return true;
  }

  async function navigateTarget(
    target: DesktopFileTarget,
    options: { readonly flush?: boolean; readonly registerTab?: boolean } = {}
  ): Promise<void> {
    if (!api || navigationPendingRef.current) {
      return;
    }

    tabScrollController.remember(activeTabIdRef.current);
    navigationPendingRef.current = true;
    setNavigationPending(true);
    const navigationGeneration = ++navigationGenerationRef.current;

    try {
      if (options.flush !== false) {
        await save.flushChanges();
      }

      if (navigationGeneration !== navigationGenerationRef.current) {
        return;
      }

      await loadTarget(target, navigationGeneration, options.registerTab !== false);
    } finally {
      if (navigationGeneration === navigationGenerationRef.current) {
        navigationPendingRef.current = false;
        setNavigationPending(false);
      }
    }
  }

  async function openTarget(target: DesktopFileTarget): Promise<void> {
    await navigateTarget(target);
  }

  function activateTab(target: DesktopFileTarget): void {
    if (desktopTabId(target) === activeTabIdRef.current || navigationPendingRef.current) {
      return;
    }

    void navigateTarget(target, { registerTab: false }).catch((navigationError: unknown) => {
      save.fail(navigationError, "The tab could not open.");
    });
  }

  function reorderTab(sourceTabId: string, insertionIndex: number): void {
    commitTabs((current) => reorderDesktopTabs(current, sourceTabId, insertionIndex));
  }

  function closeTab(tabId: string): void {
    if (navigationPendingRef.current) {
      return;
    }

    const currentTabs = tabsRef.current;
    const closeIndex = currentTabs.findIndex((tab) => desktopTabId(tab) === tabId);

    if (closeIndex < 0) {
      return;
    }

    if (tabId !== activeTabIdRef.current) {
      tabScrollController.forget(tabId);
      commitTabs(currentTabs.filter((tab) => desktopTabId(tab) !== tabId));
      return;
    }

    tabScrollController.remember(tabId);
    void (async () => {
      navigationPendingRef.current = true;
      setNavigationPending(true);
      const navigationGeneration = ++navigationGenerationRef.current;

      try {
        await save.flushChanges();
        const nextTabs = tabsRef.current.filter((tab) => desktopTabId(tab) !== tabId);
        const nextTarget = nextTabs[Math.min(closeIndex, nextTabs.length - 1)];

        if (nextTarget) {
          await loadTarget(nextTarget, navigationGeneration, false);
          commitTabs(nextTabs);
          tabScrollController.forget(tabId);
        } else {
          tabScrollController.forget(tabId);
          commitTabs([]);
          commitActiveTab(undefined);
          clearView();
        }
      } catch (closeError) {
        save.fail(closeError, "The tab could not close safely.");
      } finally {
        if (navigationGeneration === navigationGenerationRef.current) {
          navigationPendingRef.current = false;
          setNavigationPending(false);
        }
      }
    })();
  }

  function changeFolder(root: DesktopFolderRoot): void {
    navigationGenerationRef.current += 1;
    navigationPendingRef.current = false;
    setNavigationPending(false);
    tabScrollController.clear();
    commitTabs([]);
    commitActiveTab(undefined);
    clearView(root.displayPath);
  }

  async function relocateEntry(rootId: string, result: DesktopEntryMutationResult): Promise<void> {
    const previousActiveTabId = activeTabIdRef.current;
    const relocation = relocateDesktopTabs(tabsRef.current, previousActiveTabId, rootId, result);

    for (const { previousTabId, nextTabId } of relocation.relocatedIds) {
      tabScrollController.relocate(previousTabId, nextTabId);
    }

    commitTabs(relocation.tabs);

    if (relocation.tabs.length > 0) {
      commitActiveTab(relocation.activeTabId);
    }

    const activeWasRelocated = relocation.relocatedIds.some(
      ({ previousTabId }) => previousTabId === previousActiveTabId
    );

    if (!activeWasRelocated || !relocation.activeTabId) {
      return;
    }

    const relocatedActiveTarget = relocation.tabs.find(
      (target) => desktopTabId(target) === relocation.activeTabId
    );

    if (relocatedActiveTarget) {
      await navigateTarget(relocatedActiveTarget, { flush: false, registerTab: false });
    }
  }

  function deleteEntry(rootId: string, entry: DesktopFolderEntry): void {
    const deletion = deleteDesktopTabsWithinEntry(
      tabsRef.current,
      activeTabIdRef.current,
      rootId,
      entry
    );

    for (const removedTabId of deletion.removedTabIds) {
      tabScrollController.forget(removedTabId);
    }

    commitTabs(deletion.tabs);

    if (!deletion.activeWasDeleted) {
      return;
    }

    navigationGenerationRef.current += 1;
    save.disposeDocument();

    if (!deletion.nextTarget) {
      commitActiveTab(undefined);
      clearView();
      return;
    }

    commitActiveTab(desktopTabId(deletion.nextTarget));
    clearView();
    void navigateTarget(deletion.nextTarget, { flush: false, registerTab: false }).catch(
      (navigationError: unknown) => {
        save.reportError(
          navigationError instanceof Error
            ? navigationError
            : new Error("The next tab could not open.")
        );
      }
    );
  }

  async function discardAndReload(): Promise<void> {
    if (!api || view?.type !== "markdown") {
      return;
    }

    const shouldReload = window.confirm(
      "Discard Markflow's unsaved changes and reload the latest version from disk?"
    );

    if (!shouldReload) {
      return;
    }

    const navigationGeneration = ++navigationGenerationRef.current;
    const currentDocument = view.document;
    save.setLoading();

    try {
      const document = await api.openMarkdown({
        rootId: currentDocument.rootId,
        relativePath: currentDocument.relativePath
      });

      if (navigationGeneration !== navigationGenerationRef.current) {
        return;
      }

      save.trackDocument(document);
      setView({ type: "markdown", document });
      setResourcePath(document.displayPath);
      editor.presentMarkdown(document.markdown);
    } catch (reloadError) {
      save.fail(reloadError, "The file could not be reloaded.");
    }
  }

  return {
    activeTabId,
    activeTarget,
    navigationPending,
    resourcePath,
    tabs,
    view,
    activateTab,
    changeFolder,
    closeTab,
    deleteEntry,
    discardAndReload,
    openTarget,
    relocateEntry,
    reorderTab
  };
}
