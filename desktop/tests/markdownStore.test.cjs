"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  detectEol,
  encodeMarkdown,
  revisionFromStats
} = require("../markdownStore.cjs");

test("detectEol keeps the dominant line ending", () => {
  assert.equal(detectEol("one\r\ntwo\r\nthree\n"), "crlf");
  assert.equal(detectEol("one\ntwo\r\nthree\n"), "lf");
  assert.equal(detectEol("single line"), "lf");
});

test("encodeMarkdown restores line endings and an optional UTF-8 BOM", () => {
  assert.deepEqual(
    encodeMarkdown("one\ntwo\n", "crlf", false),
    Buffer.from("one\r\ntwo\r\n", "utf8")
  );
  assert.deepEqual(
    encodeMarkdown("one\r\ntwo", "lf", true),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("one\ntwo", "utf8")])
  );
});

test("revisionFromStats is stable for bigint and millisecond timestamps", () => {
  assert.equal(
    revisionFromStats({ dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n }),
    "1:2:3:4"
  );
  assert.equal(
    revisionFromStats({ dev: 1, ino: 2, size: 3, mtimeMs: 1.25 }),
    "1:2:3:1250000"
  );
});
