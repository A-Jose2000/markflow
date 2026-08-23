import assert from "node:assert/strict";
import test from "node:test";

import {
  createSelectionSnapshot,
  createSelectionSnapshotFileName
} from "../../src/codexSelectionSnapshotModel.ts";

const capturedAt = new Date("2026-08-22T14:15:16.123Z");

test("creates deterministic, filesystem-safe selection snapshot names", () => {
  assert.equal(
    createSelectionSnapshotFileName("/notes/Preguntas clínicas.md", capturedAt),
    "2026-08-22T14-15-16-123Z-Preguntas-cl-nicas.md"
  );
  assert.equal(
    createSelectionSnapshotFileName("/", capturedAt),
    "2026-08-22T14-15-16-123Z-selection.md"
  );
});

test("uses a fence longer than backtick runs in selected Markdown", () => {
  const snapshot = createSelectionSnapshot({
    capturedAt,
    selection: {
      text: "A ````code```` example",
      source: "rich"
    },
    sourcePath: "/notes/example.md"
  });

  assert.equal(
    snapshot,
    [
      "# Markflow Selection",
      "",
      "Source file: /notes/example.md",
      "Selection source: rich",
      "Captured at: 2026-08-22T14:15:16.123Z",
      "",
      "`````markdown",
      "A ````code```` example",
      "`````",
      ""
    ].join("\n")
  );
});
