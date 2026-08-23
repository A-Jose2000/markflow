"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createApplicationProtocolHandler,
  createMediaProtocolHandler
} = require("../main-process/protocolHandlers.cjs");

const quietLogger = { error() {} };

test("the application protocol serves only allowlisted bundle content with hardened headers", async (t) => {
  const rendererRoot = await mkdtemp(path.join(os.tmpdir(), "markflow-renderer-"));
  t.after(() => rm(rendererRoot, { recursive: true, force: true }));
  await writeFile(path.join(rendererRoot, "index.html"), "<main>Markflow</main>", "utf8");
  const handler = createApplicationProtocolHandler({
    rendererRootPath: rendererRoot,
    rendererContentSecurityPolicy: "default-src 'self'",
    logger: quietLogger,
    netFetch: async () => new Response("<main>Markflow</main>", {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" }
    })
  });

  const response = await handler(new Request("markflow-app://bundle/index.html"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-store");

  const rejected = await handler(new Request("markflow-app://other/index.html"));
  assert.equal(rejected.status, 404);
});

test("the media protocol enforces root ownership and explicit preview types", async (t) => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "markflow-media-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  await writeFile(path.join(rootPath, "cover.png"), "image", "utf8");
  const handler = createMediaProtocolHandler({
    getRootById: (rootId) => rootId === "root-1" ? { realPath: rootPath } : undefined,
    logger: quietLogger,
    netFetch: async () => new Response("image", { status: 200 })
  });

  const response = await handler(new Request("markflow-media://root-1/cover.png"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-disposition"), "inline");

  const missingRoot = await handler(new Request("markflow-media://missing/cover.png"));
  assert.equal(missingRoot.status, 404);
  const markdown = await handler(new Request("markflow-media://root-1/notes.md"));
  assert.equal(markdown.status, 415);
});
