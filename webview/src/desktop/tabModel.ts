import type {
  DesktopEntryMutationResult,
  DesktopFileTarget,
  DesktopFolderEntry
} from "./contracts";
import { isDesktopPathWithinOrEqual, relocateDesktopTarget } from "./pathModel";

export function desktopTabId(target: Pick<DesktopFileTarget, "rootId" | "relativePath">): string {
  return `${target.rootId}:${target.relativePath}`;
}

export function upsertDesktopTab(
  tabs: DesktopFileTarget[],
  target: DesktopFileTarget
): DesktopFileTarget[] {
  const tabId = desktopTabId(target);
  const existingIndex = tabs.findIndex((tab) => desktopTabId(tab) === tabId);

  if (existingIndex < 0) {
    return [...tabs, target];
  }

  return tabs.map((tab, index) => (index === existingIndex ? target : tab));
}

export function reorderDesktopTabs(
  tabs: DesktopFileTarget[],
  sourceTabId: string,
  insertionIndex: number
): DesktopFileTarget[] {
  const sourceIndex = tabs.findIndex((tab) => desktopTabId(tab) === sourceTabId);

  if (sourceIndex < 0) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [sourceTab] = nextTabs.splice(sourceIndex, 1);
  nextTabs.splice(Math.max(0, Math.min(insertionIndex, nextTabs.length)), 0, sourceTab);
  return nextTabs;
}

export interface DesktopTabRelocation {
  readonly tabs: DesktopFileTarget[];
  readonly activeTabId?: string;
  readonly relocatedIds: readonly {
    readonly previousTabId: string;
    readonly nextTabId: string;
  }[];
}

export function relocateDesktopTabs(
  tabs: DesktopFileTarget[],
  activeTabId: string | undefined,
  rootId: string,
  result: DesktopEntryMutationResult
): DesktopTabRelocation {
  let nextActiveTabId = activeTabId;
  const relocatedIds: Array<{ previousTabId: string; nextTabId: string }> = [];
  const nextTabs = tabs.map((target) => {
    if (target.rootId !== rootId || !isDesktopPathWithinOrEqual(result.previousRelativePath, target.relativePath)) {
      return target;
    }

    const previousTabId = desktopTabId(target);
    const relocatedTarget = relocateDesktopTarget(target, result);
    const nextTabId = desktopTabId(relocatedTarget);
    relocatedIds.push({ previousTabId, nextTabId });

    if (previousTabId === activeTabId) {
      nextActiveTabId = nextTabId;
    }

    return relocatedTarget;
  });

  return {
    tabs: nextTabs,
    activeTabId: nextActiveTabId,
    relocatedIds
  };
}

export interface DesktopTabDeletion {
  readonly tabs: DesktopFileTarget[];
  readonly removedTabIds: readonly string[];
  readonly activeWasDeleted: boolean;
  readonly nextTarget?: DesktopFileTarget;
}

export function deleteDesktopTabsWithinEntry(
  tabs: DesktopFileTarget[],
  activeTabId: string | undefined,
  rootId: string,
  entry: Pick<DesktopFolderEntry, "relativePath">
): DesktopTabDeletion {
  const activeIndex = tabs.findIndex((tab) => desktopTabId(tab) === activeTabId);
  const removedTabs = tabs.filter(
    (target) =>
      target.rootId === rootId &&
      isDesktopPathWithinOrEqual(entry.relativePath, target.relativePath)
  );
  const remainingTabs = tabs.filter((target) => !removedTabs.includes(target));
  const activeWasDeleted = removedTabs.some((target) => desktopTabId(target) === activeTabId);
  const nextTarget = activeWasDeleted
    ? remainingTabs[Math.min(Math.max(activeIndex, 0), remainingTabs.length - 1)]
    : undefined;

  return {
    tabs: remainingTabs,
    removedTabIds: removedTabs.map(desktopTabId),
    activeWasDeleted,
    nextTarget
  };
}
