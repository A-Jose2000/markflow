"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { PublicError } = require("../publicErrors.cjs");
const {
  decodeMediaPath,
  normalizeApiRelativePath,
  normalizeNewEntryName,
  normalizeNewMarkdownName,
  readCloseResult,
  readMoveEntryRequest
} = require("../requestValidation.cjs");

function assertPublicError(callback, code) {
  assert.throws(callback, (error) => error instanceof PublicError && error.code === code);
}

test("relative paths normalize separators and reject traversal or absolute paths", () => {
  assert.equal(normalizeApiRelativePath("folder\\note.md"), "folder/note.md");
  assert.equal(normalizeApiRelativePath(""), "");
  assertPublicError(() => normalizeApiRelativePath("folder/../note.md"), "OUTSIDE_FOLDER");
  assertPublicError(() => normalizeApiRelativePath("C:\\notes\\note.md"), "OUTSIDE_FOLDER");
});

test("entry and Markdown names enforce the desktop filesystem contract", () => {
  assert.equal(normalizeNewEntryName(" Notes "), "Notes");
  assert.equal(normalizeNewMarkdownName("Notes"), "Notes.md");
  assert.equal(normalizeNewMarkdownName("Notes.MARKDOWN"), "Notes.MARKDOWN");
  assertPublicError(() => normalizeNewEntryName("CON"), "INVALID_NAME");
  assertPublicError(() => normalizeNewMarkdownName("Notes.txt"), "UNSUPPORTED_FILE");
});

test("move and media requests cannot escape the selected root", () => {
  assert.deepEqual(
    readMoveEntryRequest({
      rootId: "root-1",
      sourceRelativePath: "old/note.md",
      destinationParentRelativePath: "new"
    }),
    {
      rootId: "root-1",
      sourceRelativePath: "old/note.md",
      destinationParentRelativePath: "new"
    }
  );
  assert.equal(decodeMediaPath("/images/My%20Logo.png"), "images/My Logo.png");
  assertPublicError(() => decodeMediaPath("/images/%2Fsecret.png"), "OUTSIDE_FOLDER");
});

test("close responses require a valid request id and bounded failure message", () => {
  const requestId = "123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(readCloseResult({ requestId, ok: true }), { requestId, ok: true });
  assert.deepEqual(
    readCloseResult({ requestId, ok: false, message: " Save failed " }),
    { requestId, ok: false, message: "Save failed" }
  );
  assertPublicError(() => readCloseResult({ requestId: "bad", ok: true }), "INVALID_CLOSE_REQUEST");
});
