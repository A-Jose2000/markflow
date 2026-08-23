"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { BUNDLED_CONTENT_TYPES, classifyFile } = require("../fileCatalog.cjs");

test("classifyFile recognizes editable and previewable file types case-insensitively", () => {
  assert.deepEqual(classifyFile("NOTES.MD"), {
    kind: "markdown",
    mimeType: "text/markdown; charset=utf-8"
  });
  assert.deepEqual(classifyFile("clip.MP4"), { kind: "video", mimeType: "video/mp4" });
  assert.equal(classifyFile("archive.zip"), undefined);
});

test("bundled renderer assets use explicit content types", () => {
  assert.equal(BUNDLED_CONTENT_TYPES.get(".js"), "text/javascript; charset=utf-8");
  assert.equal(BUNDLED_CONTENT_TYPES.get(".woff2"), "font/woff2");
});
