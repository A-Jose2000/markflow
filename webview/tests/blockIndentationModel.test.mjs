import assert from "node:assert/strict";
import test from "node:test";

import {
  changeOutlineDepth,
  collectCollapsedOutlineKeys,
  collectOutlineSubtreeKeys,
  getOutlineDragDepthDelta,
  resolveOutlineInsertion
} from "../src/blockIndentationModel.ts";

const outline = [
  { key: "a", depth: 0 },
  { key: "b", depth: 1 },
  { key: "c", depth: 2 },
  { key: "d", depth: 1 },
  { key: "e", depth: 0 }
];

test("collects a parent with every descendant in its subtree", () => {
  assert.deepEqual([...collectOutlineSubtreeKeys(outline, ["a"])], ["a", "b", "c", "d"]);
  assert.deepEqual([...collectOutlineSubtreeKeys(outline, ["b"])], ["b", "c"]);
});

test("combines selected sibling roots without losing nested descendants", () => {
  assert.deepEqual([...collectOutlineSubtreeKeys(outline, ["b", "d"])], ["b", "c", "d"]);
});

test("indents a mixed subtree beneath its previous sibling", () => {
  assert.deepEqual(changeOutlineDepth(outline, ["d"], 1, 7), {
    rows: [
      { key: "a", depth: 0 },
      { key: "b", depth: 1 },
      { key: "c", depth: 2 },
      { key: "d", depth: 2 },
      { key: "e", depth: 0 }
    ],
    rootKeys: ["d"]
  });
});

test("outdents a subtree after the old parent's remaining children", () => {
  assert.deepEqual(changeOutlineDepth(outline, ["b"], -1, 7), {
    rows: [
      { key: "a", depth: 0 },
      { key: "d", depth: 1 },
      { key: "b", depth: 0 },
      { key: "c", depth: 1 },
      { key: "e", depth: 0 }
    ],
    rootKeys: ["b"]
  });
});

test("outdents consecutive selected siblings as one ordered group", () => {
  assert.deepEqual(changeOutlineDepth(outline, ["b", "d"], -1, 7), {
    rows: [
      { key: "a", depth: 0 },
      { key: "b", depth: 0 },
      { key: "c", depth: 1 },
      { key: "d", depth: 0 },
      { key: "e", depth: 0 }
    ],
    rootKeys: ["b", "d"]
  });
});

test("rejects indentation without a previous sibling and at the maximum depth", () => {
  assert.equal(changeOutlineDepth(outline, ["a"], 1, 7), undefined);
  assert.equal(changeOutlineDepth([{ key: "a", depth: 0 }, { key: "b", depth: 1 }], ["b"], 1, 1), undefined);
});

test("collects only descendants of closed toggles", () => {
  assert.deepEqual(
    [...collectCollapsedOutlineKeys(outline, new Set(["a"]))],
    ["b", "c", "d"]
  );
  assert.deepEqual(
    [...collectCollapsedOutlineKeys(outline, new Set(["b"]))],
    ["c"]
  );
});

test("keeps insertion inside a parent while its following descendants continue", () => {
  assert.deepEqual(resolveOutlineInsertion(outline, 3, 0), {
    afterKey: "c",
    beforeKey: "d",
    depth: 1,
    parentKey: "a"
  });
});

test("allows nesting beneath the preceding visible block", () => {
  assert.deepEqual(resolveOutlineInsertion(outline, 3, 3), {
    afterKey: "c",
    beforeKey: "d",
    depth: 3,
    parentKey: "c"
  });
});

test("allows root insertion once the preceding subtree has ended", () => {
  assert.deepEqual(resolveOutlineInsertion(outline, 4, 0), {
    afterKey: "d",
    beforeKey: "e",
    depth: 0,
    parentKey: undefined
  });
});

test("clamps requested depth to one level beyond the predecessor", () => {
  assert.equal(resolveOutlineInsertion(outline, 2, 20)?.depth, 2);
  assert.equal(resolveOutlineInsertion(outline, 0, 4)?.depth, 0);
});

test("uses a full-lane drag dead zone before changing outline depth", () => {
  assert.equal(getOutlineDragDepthDelta(51, 40), 0);
  assert.equal(getOutlineDragDepthDelta(52, 40), 1);
  assert.equal(getOutlineDragDepthDelta(91, 40), 1);
  assert.equal(getOutlineDragDepthDelta(92, 40), 2);
  assert.equal(getOutlineDragDepthDelta(-52, 40), -1);
});
