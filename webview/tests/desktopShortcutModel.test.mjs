import assert from "node:assert/strict";
import test from "node:test";

import { resolveDesktopShortcut } from "../src/desktop/shortcutModel.ts";

const input = (overrides = {}) => ({
  altKey: false,
  ctrlKey: true,
  key: "",
  metaKey: false,
  shiftKey: false,
  ...overrides
});

test("maps desktop save and close shortcuts", () => {
  assert.deepEqual(resolveDesktopShortcut(input({ key: "s" })), { type: "save" });
  assert.deepEqual(resolveDesktopShortcut(input({ key: "W" })), { type: "close-active-tab" });
  assert.deepEqual(
    resolveDesktopShortcut(input({ ctrlKey: false, key: "s", metaKey: true })),
    { type: "save" }
  );
});

test("maps tab cycling only for the control-key desktop gesture", () => {
  assert.deepEqual(resolveDesktopShortcut(input({ key: "Tab" })), {
    type: "cycle-tab",
    direction: 1
  });
  assert.deepEqual(resolveDesktopShortcut(input({ key: "Tab", shiftKey: true })), {
    type: "cycle-tab",
    direction: -1
  });
  assert.equal(
    resolveDesktopShortcut(input({ ctrlKey: false, key: "Tab", metaKey: true })),
    undefined
  );
});

test("ignores unrelated and alternate-modifier shortcuts", () => {
  assert.equal(resolveDesktopShortcut(input({ key: "p" })), undefined);
  assert.equal(resolveDesktopShortcut(input({ altKey: true, key: "s" })), undefined);
  assert.equal(resolveDesktopShortcut(input({ ctrlKey: false, key: "s" })), undefined);
});
