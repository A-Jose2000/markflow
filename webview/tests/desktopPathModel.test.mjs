import assert from "node:assert/strict";
import test from "node:test";

import {
  getDesktopParentPath,
  isDesktopPathWithinOrEqual,
  relocateDesktopPath,
  relocateDesktopTarget
} from "../src/desktop/pathModel.ts";

test("gets the parent of top-level and nested desktop paths", () => {
  assert.equal(getDesktopParentPath("note.md"), "");
  assert.equal(getDesktopParentPath("projects/note.md"), "projects");
  assert.equal(getDesktopParentPath("projects/research/note.md"), "projects/research");
});

test("matches path containment only at segment boundaries", () => {
  assert.equal(isDesktopPathWithinOrEqual("", "projects/note.md"), true);
  assert.equal(isDesktopPathWithinOrEqual("projects", "projects"), true);
  assert.equal(isDesktopPathWithinOrEqual("projects", "projects/note.md"), true);
  assert.equal(isDesktopPathWithinOrEqual("projects", "projects-archive/note.md"), false);
  assert.equal(isDesktopPathWithinOrEqual("projects", "other/projects/note.md"), false);
});

test("relocates an entry and each path beneath it", () => {
  const result = {
    previousRelativePath: "projects/drafts",
    entry: {
      kind: "directory",
      name: "published",
      relativePath: "archive/published"
    }
  };

  assert.equal(relocateDesktopPath("projects/drafts", result), "archive/published");
  assert.equal(
    relocateDesktopPath("projects/drafts/notes/launch.md", result),
    "archive/published/notes/launch.md"
  );
});

test("uses relocated file metadata when the target itself changes", () => {
  const target = {
    rootId: "root-1",
    name: "draft.md",
    relativePath: "draft.md",
    kind: "markdown",
    mimeType: "text/markdown"
  };
  const result = {
    previousRelativePath: "draft.md",
    entry: {
      kind: "markdown",
      name: "published.md",
      relativePath: "published.md",
      mimeType: "text/markdown; charset=utf-8"
    }
  };

  assert.deepEqual(relocateDesktopTarget(target, result), {
    rootId: "root-1",
    ...result.entry
  });
});

test("preserves target metadata when an ancestor directory moves", () => {
  const target = {
    rootId: "root-1",
    name: "launch.md",
    relativePath: "projects/drafts/launch.md",
    kind: "markdown",
    mimeType: "text/markdown"
  };
  const result = {
    previousRelativePath: "projects/drafts",
    entry: {
      kind: "directory",
      name: "published",
      relativePath: "archive/published"
    }
  };

  assert.deepEqual(relocateDesktopTarget(target, result), {
    ...target,
    name: "launch.md",
    relativePath: "archive/published/launch.md"
  });
});
