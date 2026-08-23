"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { PublicError } = require("../publicErrors.cjs");
const {
  apiParentPath,
  assertContained,
  isPathWithinOrEqual,
  joinApiPath,
  toApiRelativePath
} = require("../workspacePaths.cjs");

test("API path helpers preserve normalized explorer paths", () => {
  assert.equal(joinApiPath("folder", "note.md"), "folder/note.md");
  assert.equal(joinApiPath("", "note.md"), "note.md");
  assert.equal(apiParentPath("folder/note.md"), "folder");
  assert.equal(apiParentPath("note.md"), "");
  assert.equal(toApiRelativePath(path.join("folder", "note.md")), "folder/note.md");
});

test("filesystem containment accepts descendants and rejects escapes", () => {
  const root = path.resolve("workspace");
  const child = path.join(root, "folder", "note.md");
  assert.doesNotThrow(() => assertContained(root, child));
  assert.equal(isPathWithinOrEqual(root, child), true);
  assert.equal(isPathWithinOrEqual(root, path.resolve(root, "..", "outside")), false);
  assert.throws(
    () => assertContained(root, path.resolve(root, "..", "outside")),
    (error) => error instanceof PublicError && error.code === "OUTSIDE_FOLDER"
  );
});
