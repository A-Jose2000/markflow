import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCK_COMMAND_PLANS,
  BLOCK_COMMANDS,
  filterBlockCommands
} from "../src/blockCommands.ts";

test("exposes the complete block command catalog", () => {
  assert.deepEqual(
    BLOCK_COMMANDS.map((command) => command.id),
    [
      "paragraph",
      "heading-1",
      "heading-2",
      "heading-3",
      "bullet-list",
      "number-list",
      "check-list",
      "toggle",
      "quote",
      "code",
      "table",
      "divider"
    ]
  );
});

test("defines an execution plan for every catalog command", () => {
  assert.deepEqual(Object.keys(BLOCK_COMMAND_PLANS), BLOCK_COMMANDS.map((command) => command.id));
  assert.deepEqual(BLOCK_COMMAND_PLANS["heading-2"], { kind: "element", element: "heading-2" });
  assert.deepEqual(BLOCK_COMMAND_PLANS["check-list"], { kind: "list", listType: "check" });
});

test("filters commands across labels, descriptions, and keywords", () => {
  assert.deepEqual(filterBlockCommands("programming", false).map((command) => command.id), ["code"]);
  assert.deepEqual(filterBlockCommands("large section", false).map((command) => command.id), ["heading-1"]);
  assert.deepEqual(filterBlockCommands(" TODO ", false).map((command) => command.id), ["check-list"]);
});

test("excludes insert-only commands from turn-into results", () => {
  assert.equal(filterBlockCommands("", false).length, BLOCK_COMMANDS.length);
  assert.equal(filterBlockCommands("table", true).length, 0);
  assert.equal(filterBlockCommands("divider", true).length, 0);
  assert.deepEqual(filterBlockCommands("quote", true).map((command) => command.id), ["quote"]);
});
