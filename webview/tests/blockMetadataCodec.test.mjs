import assert from "node:assert/strict";
import test from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";

import {
  createMarkflowBlockMetadataTitle,
  createMarkflowMetadataDefinition,
  LEGACY_MARKFLOW_BLOCK_DEPTH_DEFINITION_PREFIX,
  MARKFLOW_BLOCK_DEPTH_DEFINITION_ID,
  MARKFLOW_BLOCK_METADATA_DEFINITION_ID,
  MARKFLOW_EMPTY_BLOCK_DEFINITION_ID,
  readMarkflowBlockMetadata,
  readMarkflowBlockMarker
} from "../src/blockMetadataCodec.ts";

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

test("round-trips combined depth, toggle, and empty metadata", () => {
  const title = createMarkflowBlockMetadataTitle({ depth: 2, empty: true, toggle: "closed" });
  assert.equal(title, "d=2&t=closed&e=1");
  assert.deepEqual(
    readMarkflowBlockMetadata(
      { identifier: MARKFLOW_BLOCK_METADATA_DEFINITION_ID, title, url: "#" },
      7
    ),
    { depth: 2, empty: true, toggle: "closed" }
  );
  assert.deepEqual(
    readMarkflowBlockMetadata(
      { identifier: MARKFLOW_BLOCK_METADATA_DEFINITION_ID.toUpperCase(), title: "d=0", url: "#" },
      7
    ),
    { depth: 0, empty: false, toggle: "none" }
  );
  const numberedTitle = createMarkflowBlockMetadataTitle({
    depth: 1,
    empty: false,
    listStart: 4,
    toggle: "open"
  });
  assert.equal(numberedTitle, "d=1&t=open&s=4");
  assert.deepEqual(
    readMarkflowBlockMetadata(
      { identifier: MARKFLOW_BLOCK_METADATA_DEFINITION_ID, title: numberedTitle, url: "#" },
      7
    ),
    { depth: 1, empty: false, listStart: 4, toggle: "open" }
  );
});

test("rejects malformed combined block metadata", () => {
  const definition = (title) => ({
    identifier: MARKFLOW_BLOCK_METADATA_DEFINITION_ID,
    title,
    url: "#"
  });
  assert.equal(readMarkflowBlockMetadata(definition("t=open"), 7), undefined);
  assert.equal(readMarkflowBlockMetadata(definition("d=-1"), 7), undefined);
  assert.equal(readMarkflowBlockMetadata(definition("d=8"), 7), undefined);
  assert.equal(readMarkflowBlockMetadata(definition("d=1&t=maybe"), 7), undefined);
  assert.equal(readMarkflowBlockMetadata(definition("d=1&e=yes"), 7), undefined);
  assert.equal(readMarkflowBlockMetadata(definition("d=1&s=0"), 7), undefined);
  assert.equal(readMarkflowBlockMetadata(definition("d=1&s=1.5"), 7), undefined);
  assert.equal(readMarkflowBlockMetadata({ ...definition("d=1"), url: "/real" }, 7), undefined);
});

test("serializes list-item metadata as an invisible definition", () => {
  const markdown = toMarkdown({
    type: "root",
    children: [
      {
        type: "list",
        ordered: false,
        spread: false,
        children: [
          {
            type: "listItem",
            spread: false,
            children: [
              createMarkflowMetadataDefinition({
                depth: 1,
                empty: false,
                toggle: "open"
              }),
              { type: "paragraph", children: [{ type: "text", value: "Nested item" }] }
            ]
          }
        ]
      }
    ]
  });
  const parsed = fromMarkdown(markdown);
  const metadata = parsed.children[0].children[0].children[0];

  assert.equal(metadata.type, "definition");
  assert.deepEqual(readMarkflowBlockMetadata(metadata, 7), {
    depth: 1,
    empty: false,
    toggle: "open"
  });
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
