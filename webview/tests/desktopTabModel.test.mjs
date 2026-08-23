import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./pathModel" && context.parentURL?.endsWith("/desktop/tabModel.ts")) {
      return nextResolve("./pathModel.ts", context);
    }

    return nextResolve(specifier, context);
  }
});

const {
  deleteDesktopTabsWithinEntry,
  desktopTabId,
  relocateDesktopTabs,
  reorderDesktopTabs,
  upsertDesktopTab
} = await import("../src/desktop/tabModel.ts");

function createTarget(relativePath, overrides = {}) {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  return {
    rootId: "root-1",
    name,
    relativePath,
    kind: "markdown",
    mimeType: "text/markdown",
    ...overrides
  };
}

test("identifies tabs by root and relative path", () => {
  assert.equal(desktopTabId(createTarget("notes/example.md")), "root-1:notes/example.md");
  assert.notEqual(
    desktopTabId(createTarget("notes/example.md")),
    desktopTabId(createTarget("notes/example.md", { rootId: "root-2" }))
  );
});

test("registers new tabs and refreshes an existing target in place", () => {
  const first = createTarget("first.md");
  const second = createTarget("second.md");
  const registered = upsertDesktopTab([first], second);
  assert.deepEqual(registered, [first, second]);

  const refreshed = { ...first, name: "First", mimeType: "text/markdown; charset=utf-8" };
  assert.deepEqual(upsertDesktopTab(registered, refreshed), [refreshed, second]);
});

test("reorders tabs with the same clamped insertion behavior as the tab strip", () => {
  const first = createTarget("first.md");
  const second = createTarget("second.md");
  const third = createTarget("third.md");
  const tabs = [first, second, third];

  assert.deepEqual(reorderDesktopTabs(tabs, desktopTabId(first), 9), [second, third, first]);
  assert.deepEqual(reorderDesktopTabs(tabs, desktopTabId(third), -2), [third, first, second]);
  assert.equal(reorderDesktopTabs(tabs, "missing:tab.md", 1), tabs);
});

test("relocates matching descendants and updates the active tab id", () => {
  const active = createTarget("projects/drafts/active.md");
  const sibling = createTarget("projects/drafts/sibling.md");
  const prefixLookalike = createTarget("projects/drafts-old/keep.md");
  const otherRoot = createTarget("projects/drafts/other.md", { rootId: "root-2" });
  const result = {
    changed: true,
    previousRelativePath: "projects/drafts",
    entry: {
      kind: "directory",
      name: "published",
      relativePath: "archive/published"
    }
  };

  const relocation = relocateDesktopTabs(
    [active, sibling, prefixLookalike, otherRoot],
    desktopTabId(active),
    "root-1",
    result
  );

  assert.deepEqual(
    relocation.tabs.map((tab) => tab.relativePath),
    [
      "archive/published/active.md",
      "archive/published/sibling.md",
      "projects/drafts-old/keep.md",
      "projects/drafts/other.md"
    ]
  );
  assert.equal(relocation.activeTabId, "root-1:archive/published/active.md");
  assert.deepEqual(relocation.relocatedIds, [
    {
      previousTabId: "root-1:projects/drafts/active.md",
      nextTabId: "root-1:archive/published/active.md"
    },
    {
      previousTabId: "root-1:projects/drafts/sibling.md",
      nextTabId: "root-1:archive/published/sibling.md"
    }
  ]);
});

test("uses replacement file metadata when the relocated entry is an open tab", () => {
  const target = createTarget("draft.md");
  const result = {
    changed: true,
    previousRelativePath: "draft.md",
    entry: {
      kind: "markdown",
      name: "published.md",
      relativePath: "published.md",
      mimeType: "text/markdown; charset=utf-8"
    }
  };
  const relocation = relocateDesktopTabs([target], desktopTabId(target), "root-1", result);

  assert.deepEqual(relocation.tabs, [{ rootId: "root-1", ...result.entry }]);
  assert.equal(relocation.activeTabId, "root-1:published.md");
});

test("deleting an active subtree selects the tab at the previous active index", () => {
  const before = createTarget("before.md");
  const active = createTarget("folder/active.md");
  const descendant = createTarget("folder/nested/second.md");
  const after = createTarget("after.md");
  const prefixLookalike = createTarget("folder-old/keep.md");
  const deletion = deleteDesktopTabsWithinEntry(
    [before, active, descendant, after, prefixLookalike],
    desktopTabId(active),
    "root-1",
    { relativePath: "folder" }
  );

  assert.deepEqual(deletion.tabs, [before, after, prefixLookalike]);
  assert.deepEqual(deletion.removedTabIds, [desktopTabId(active), desktopTabId(descendant)]);
  assert.equal(deletion.activeWasDeleted, true);
  assert.equal(deletion.nextTarget, after);
});

test("deleting an inactive entry preserves the current active tab", () => {
  const active = createTarget("active.md");
  const removed = createTarget("folder/removed.md");
  const deletion = deleteDesktopTabsWithinEntry(
    [active, removed],
    desktopTabId(active),
    "root-1",
    { relativePath: "folder" }
  );

  assert.deepEqual(deletion.tabs, [active]);
  assert.equal(deletion.activeWasDeleted, false);
  assert.equal(deletion.nextTarget, undefined);
});
