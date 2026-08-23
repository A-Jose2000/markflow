import assert from "node:assert/strict";
import test from "node:test";

import {
  areBlockKeyListsEqual,
  resolveHierarchicalBlockSelection
} from "../src/blockSelectionModel.ts";

function createModel() {
  const scopeDefinitions = [
    ["root", undefined, ["heading", "a", "b", "tail"]],
    ["a-children", "a", ["a1", "a2", "a3"]],
    ["a2-children", "a2", ["a2x", "a2y"]],
    ["b-children", "b", ["b1", "b2"]]
  ];
  const scopes = new Map(
    scopeDefinitions.map(([key, parentUnitKey, unitKeys]) => [key, { key, parentUnitKey, unitKeys }])
  );
  const units = new Map();

  for (const [scopeKey, , unitKeys] of scopeDefinitions) {
    for (const key of unitKeys) {
      units.set(key, { key, scopeKey });
    }
  }

  return { scopes, units };
}

test("selects nested siblings at the deepest available level", () => {
  assert.deepEqual(resolveHierarchicalBlockSelection(createModel(), "a1", ["a1", "a3"]), {
    scopeKey: "a-children",
    keys: ["a1", "a2", "a3"]
  });
});

test("promotes nested hits to their owning parent range", () => {
  assert.deepEqual(resolveHierarchicalBlockSelection(createModel(), "a2", ["a2", "b"]), {
    scopeKey: "root",
    keys: ["a", "b"]
  });
});

test("promotes directly across more than one hierarchy level", () => {
  assert.deepEqual(resolveHierarchicalBlockSelection(createModel(), "a2x", ["a2x", "tail"]), {
    scopeKey: "root",
    keys: ["a", "b", "tail"]
  });
});

test("selecting a parent row collapses its selected descendants", () => {
  assert.deepEqual(resolveHierarchicalBlockSelection(createModel(), "a2", ["a", "a2"]), {
    scopeKey: "root",
    keys: ["a"]
  });
});

test("an outer-level anchor never descends into child scope", () => {
  assert.deepEqual(resolveHierarchicalBlockSelection(createModel(), "b", ["a2", "b1"]), {
    scopeKey: "root",
    keys: ["a", "b"]
  });
});

test("recomputing a smaller marquee demotes to the nested scope", () => {
  const model = createModel();
  assert.equal(resolveHierarchicalBlockSelection(model, "a2", ["a2", "b"])?.scopeKey, "root");
  assert.deepEqual(resolveHierarchicalBlockSelection(model, "a2", ["a1", "a2"]), {
    scopeKey: "a-children",
    keys: ["a1", "a2"]
  });
});

test("block key list equality preserves order", () => {
  assert.equal(areBlockKeyListsEqual(["a", "b"], ["a", "b"]), true);
  assert.equal(areBlockKeyListsEqual(["a", "b"], ["b", "a"]), false);
  assert.equal(areBlockKeyListsEqual(["a"], ["a", "b"]), false);
});

test("returns no selection when the marquee no longer intersects a row", () => {
  assert.equal(resolveHierarchicalBlockSelection(createModel(), "a2", []), undefined);
});
