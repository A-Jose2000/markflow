import assert from "node:assert/strict";
import test from "node:test";

import { parseWebviewMessage } from "../../src/markdownMessageParser.ts";

test("parses every supported webview message", () => {
  assert.deepEqual(parseWebviewMessage({ type: "ready" }), { type: "ready" });
  assert.deepEqual(parseWebviewMessage({ type: "requestOpenSource" }), {
    type: "requestOpenSource"
  });
  assert.deepEqual(parseWebviewMessage({ type: "edit", markdown: "# Draft" }), {
    type: "edit",
    markdown: "# Draft"
  });
  assert.deepEqual(parseWebviewMessage({ type: "copyText", text: "value" }), {
    type: "copyText",
    text: "value"
  });
  assert.deepEqual(
    parseWebviewMessage({
      type: "codexSelection",
      text: "selection",
      source: "rich",
      startIndex: 4,
      endIndex: 13
    }),
    {
      type: "codexSelection",
      text: "selection",
      source: "rich",
      startIndex: 4,
      endIndex: 13
    }
  );
});

test("rejects malformed and unknown messages without throwing", () => {
  for (const value of [
    null,
    [],
    "ready",
    {},
    { type: "unknown" },
    { type: "edit", markdown: 42 },
    { type: "copyText" },
    { type: "codexSelection", text: "selection", source: "visual" },
    { type: "codexSelection", text: "selection", source: "raw", startIndex: 0 },
    {
      type: "codexSelection",
      text: "selection",
      source: "raw",
      startIndex: 0.5,
      endIndex: 9
    },
    {
      type: "codexSelection",
      text: "selection",
      source: "raw",
      startIndex: 9,
      endIndex: 4
    }
  ]) {
    assert.equal(parseWebviewMessage(value), undefined);
  }
});

test("keeps an empty selection message so the host can clear selection state", () => {
  assert.deepEqual(
    parseWebviewMessage({ type: "codexSelection", text: "", source: "raw" }),
    { type: "codexSelection", text: "", source: "raw" }
  );
});
