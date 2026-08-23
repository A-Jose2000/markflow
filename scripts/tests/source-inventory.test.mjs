import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { listAuthoredSourceFiles, toPosixFileKey } from "../source-inventory.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("file keys are normalized to POSIX separators", () => {
  assert.equal(toPosixFileKey("webview\\src\\App.tsx"), "webview/src/App.tsx");
});

test("the authored inventory includes source, tests, scripts, and configuration", () => {
  const files = listAuthoredSourceFiles(repositoryRoot);

  assert.ok(files.includes("scripts/check-dependencies.mjs"));
  assert.ok(files.includes("webview/tests/blockSelectionModel.test.mjs"));
  assert.ok(files.includes("webview/vite.config.ts"));
  assert.ok(files.includes("mobile/App.tsx"));
  assert.ok(files.every((fileKey) => !fileKey.includes("\\")));
  assert.ok(files.every((fileKey) => !fileKey.includes("/node_modules/")));
  assert.ok(files.every((fileKey) => !fileKey.startsWith("mobile/android/")));
});
