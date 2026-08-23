"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { DESKTOP_CHANNELS } = require("../channels.cjs");

test("sandboxed preload channel literals match the main-process contract", () => {
  const preloadSource = readFileSync(path.join(__dirname, "..", "preload.cjs"), "utf8");

  for (const channel of Object.values(DESKTOP_CHANNELS)) {
    assert.equal(
      preloadSource.includes(JSON.stringify(channel)),
      true,
      `preload.cjs is missing ${channel}`
    );
  }
});
