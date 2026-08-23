import assert from "node:assert/strict";
import test from "node:test";

import { resolveOutlineNumberMarkers } from "../src/outlineNumberingModel.ts";

function markerEntries(currentRows, nextRows = currentRows) {
  return [...resolveOutlineNumberMarkers(currentRows, nextRows)];
}

test("numbers consecutive ordered siblings independently for each parent", () => {
  const rows = [
    { key: "one", depth: 0, kind: "ordered", preferredStart: 1 },
    { key: "one-child", depth: 1, kind: "ordered", preferredStart: 4 },
    { key: "one-child-next", depth: 1, kind: "ordered", preferredStart: 5 },
    { key: "two", depth: 0, kind: "ordered", preferredStart: 2 },
    { key: "two-child", depth: 1, kind: "ordered", preferredStart: 1 }
  ];

  assert.deepEqual(markerEntries(rows), [
    ["one", 1],
    ["one-child", 4],
    ["one-child-next", 5],
    ["two", 2],
    ["two-child", 1]
  ]);
});

test("resets an ordered item when it is reparented", () => {
  const currentRows = [
    { key: "one", depth: 0, kind: "ordered", preferredStart: 1 },
    { key: "two", depth: 0, kind: "ordered", preferredStart: 2 },
    { key: "three", depth: 0, kind: "ordered", preferredStart: 3 }
  ];
  const nextRows = [
    currentRows[0],
    { ...currentRows[1], depth: 1 },
    currentRows[2]
  ];

  assert.deepEqual(markerEntries(currentRows, nextRows), [
    ["one", 1],
    ["two", 1],
    ["three", 2]
  ]);
});

test("preserves a custom start when its parent subtree changes absolute depth", () => {
  const currentRows = [
    { key: "previous", depth: 0, kind: "other" },
    { key: "parent", depth: 0, kind: "other" },
    { key: "nested-four", depth: 1, kind: "ordered", preferredStart: 4 },
    { key: "nested-five", depth: 1, kind: "ordered", preferredStart: 5 }
  ];
  const nextRows = [
    currentRows[0],
    { ...currentRows[1], depth: 1 },
    { ...currentRows[2], depth: 2 },
    { ...currentRows[3], depth: 2 }
  ];

  assert.deepEqual(markerEntries(currentRows, nextRows), [
    ["nested-four", 4],
    ["nested-five", 5]
  ]);
});

test("breaks an ordered run at a non-number block", () => {
  const rows = [
    { key: "one", depth: 0, kind: "ordered", preferredStart: 1 },
    { key: "break", depth: 0, kind: "other" },
    { key: "four", depth: 0, kind: "ordered", preferredStart: 4 }
  ];

  assert.deepEqual(markerEntries(rows), [["one", 1], ["four", 4]]);
});

test("honors a new ordered row's preferred start", () => {
  const currentRows = [{ key: "existing", depth: 0, kind: "other" }];
  const nextRows = [
    currentRows[0],
    { key: "new", depth: 0, kind: "ordered", preferredStart: 7 }
  ];

  assert.deepEqual(markerEntries(currentRows, nextRows), [["new", 7]]);
});
