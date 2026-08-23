import assert from "node:assert/strict";
import test from "node:test";

import {
  createCodexSelectionState,
  resolveCodexSelectionRange
} from "../../src/codexSelectionModel.ts";

test("creates a selection state and keeps only valid source indexes", () => {
  assert.deepEqual(
    createCodexSelectionState({
      text: "selected",
      source: "raw",
      startIndex: 4,
      endIndex: 12
    }),
    {
      text: "selected",
      source: "raw",
      startIndex: 4,
      endIndex: 12
    }
  );

  assert.deepEqual(
    createCodexSelectionState({
      text: "selected",
      source: "unexpected",
      startIndex: 4.5,
      endIndex: 2
    }),
    {
      text: "selected",
      source: "rich"
    }
  );
  assert.equal(createCodexSelectionState({ text: "  ", source: "raw" }), undefined);
});

test("prefers a valid source range", () => {
  assert.deepEqual(
    resolveCodexSelectionRange("before selected after selected", {
      text: "selected",
      source: "raw",
      startIndex: 7,
      endIndex: 15
    }),
    { startIndex: 7, endIndex: 15 }
  );
});

test("falls back from stale indexes only when the text is unique", () => {
  assert.deepEqual(
    resolveCodexSelectionRange("before selected after", {
      text: "selected",
      source: "rich",
      startIndex: 0,
      endIndex: 8
    }),
    { startIndex: 7, endIndex: 15 }
  );

  assert.equal(
    resolveCodexSelectionRange("selected and selected", {
      text: "selected",
      source: "rich"
    }),
    undefined
  );

  assert.equal(
    resolveCodexSelectionRange("aaa", {
      text: "aa",
      source: "rich"
    }),
    undefined
  );
});

test("maps non-breaking spaces and normalized line endings to source indexes", () => {
  assert.deepEqual(
    resolveCodexSelectionRange("alpha beta", {
      text: "alpha\u00a0beta",
      source: "rich"
    }),
    { startIndex: 0, endIndex: 10 }
  );

  assert.deepEqual(
    resolveCodexSelectionRange("before\r\nfirst\r\nsecond\r\nafter", {
      text: "first\nsecond",
      source: "rich"
    }),
    { startIndex: 8, endIndex: 21 }
  );

  assert.deepEqual(
    resolveCodexSelectionRange("x\rfirst\rsecond", {
      text: "first\nsecond",
      source: "rich"
    }),
    { startIndex: 2, endIndex: 14 }
  );
});

test("returns UTF-16 source offsets used by TextDocument.positionAt", () => {
  assert.deepEqual(
    resolveCodexSelectionRange("😀 selected", {
      text: "selected",
      source: "rich"
    }),
    { startIndex: 3, endIndex: 11 }
  );
});

test("rejects ambiguous matches after line-ending normalization", () => {
  assert.equal(
    resolveCodexSelectionRange("same\r\ntext\n--\nsame\ntext", {
      text: "same\rtext",
      source: "rich"
    }),
    undefined
  );
});
