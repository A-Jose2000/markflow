import assert from "node:assert/strict";
import test from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";

import {
  collectOutlineSubtreeKeys,
  getOutlineDragDepthDelta,
  LEGACY_MARKFLOW_BLOCK_DEPTH_DEFINITION_PREFIX,
  MARKFLOW_BLOCK_DEPTH_DEFINITION_ID,
  MARKFLOW_EMPTY_BLOCK_DEFINITION_ID,
  readMarkflowBlockMarker,
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

test("recognizes only valid versioned block markers", () => {
  assert.deepEqual(
    readMarkflowBlockMarker(
      { identifier: MARKFLOW_BLOCK_DEPTH_DEFINITION_ID, title: "2", url: "#" },
      7
    ),
    { depth: 2, kind: "depth" }
  );
  assert.deepEqual(
    readMarkflowBlockMarker(
      { identifier: MARKFLOW_EMPTY_BLOCK_DEFINITION_ID, title: "1", url: "#" },
      7
    ),
    { depth: 1, kind: "empty" }
  );
  assert.deepEqual(
    readMarkflowBlockMarker(
      { identifier: `${LEGACY_MARKFLOW_BLOCK_DEPTH_DEFINITION_PREFIX}abc`, title: "3", url: "#" },
      7
    ),
    { depth: 3, kind: "depth" }
  );
  assert.equal(
    readMarkflowBlockMarker(
      { identifier: MARKFLOW_BLOCK_DEPTH_DEFINITION_ID, title: "8", url: "#" },
      7
    ),
    undefined
  );
  assert.equal(
    readMarkflowBlockMarker(
      { identifier: MARKFLOW_BLOCK_DEPTH_DEFINITION_ID, title: "1", url: "/ordinary-link" },
      7
    ),
    undefined
  );
});

test("uses a full-lane drag dead zone before changing outline depth", () => {
  assert.equal(getOutlineDragDepthDelta(51, 40), 0);
  assert.equal(getOutlineDragDepthDelta(52, 40), 1);
  assert.equal(getOutlineDragDepthDelta(91, 40), 1);
  assert.equal(getOutlineDragDepthDelta(92, 40), 2);
  assert.equal(getOutlineDragDepthDelta(-52, 40), -1);
});

test("keeps empty-block markers distinct from following Markdown blocks", () => {
  const markdown = toMarkdown({
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: "A" }] },
      {
        type: "definition",
        identifier: MARKFLOW_EMPTY_BLOCK_DEFINITION_ID,
        label: MARKFLOW_EMPTY_BLOCK_DEFINITION_ID,
        title: "1",
        url: "#"
      },
      { type: "paragraph", children: [] },
      { type: "paragraph", children: [{ type: "text", value: "E" }] }
    ]
  });
  const parsed = fromMarkdown(markdown);

  assert.deepEqual(parsed.children.map((node) => node.type), ["paragraph", "definition", "paragraph"]);
  assert.deepEqual(readMarkflowBlockMarker(parsed.children[1], 7), {
    depth: 1,
    kind: "empty"
  });
  assert.equal(parsed.children[2].type === "paragraph" && parsed.children[2].children[0]?.value, "E");
});

test("round-trips consecutive and trailing empty-block markers", () => {
  const marker = (depth) => ({
    type: "definition",
    identifier: MARKFLOW_EMPTY_BLOCK_DEFINITION_ID,
    label: MARKFLOW_EMPTY_BLOCK_DEFINITION_ID,
    title: String(depth),
    url: "#"
  });
  const markdown = toMarkdown({
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: "A" }] },
      marker(1),
      marker(2)
    ]
  });
  const parsed = fromMarkdown(markdown);

  assert.deepEqual(parsed.children.map((node) => node.type), ["paragraph", "definition", "definition"]);
  assert.deepEqual(readMarkflowBlockMarker(parsed.children[1], 7), { depth: 1, kind: "empty" });
  assert.deepEqual(readMarkflowBlockMarker(parsed.children[2], 7), { depth: 2, kind: "empty" });
});
