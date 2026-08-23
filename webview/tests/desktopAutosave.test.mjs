import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopAutosave } from "../src/desktop/autosave.ts";

const originalWindow = globalThis.window;

globalThis.window = {
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  setTimeout: globalThis.setTimeout.bind(globalThis)
};

test.after(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

function createDocument(overrides = {}) {
  return {
    rootId: "root-1",
    relativePath: "notes/example.md",
    name: "example.md",
    displayPath: "C:\\notes\\example.md",
    markdown: "Initial",
    revision: "revision-1",
    eol: "lf",
    hasBom: false,
    ...overrides
  };
}

test("flushes the latest Markdown and advances the expected revision", async (t) => {
  const requests = [];
  const savedResults = [];
  let revision = 1;
  const controller = createDesktopAutosave(
    {
      async autosaveCurrentMarkdown(request) {
        requests.push(request);
        revision += 1;
        return {
          ok: true,
          revision: `revision-${revision}`,
          savedAt: `save-${revision}`
        };
      }
    },
    {
      delayMs: 60_000,
      onSaved: (result) => savedResults.push(result)
    }
  );
  t.after(() => controller.dispose());

  controller.trackDocument(createDocument());
  controller.schedule("Second");
  assert.equal(controller.hasPendingChanges(), true);

  assert.deepEqual(await controller.flush(), {
    ok: true,
    revision: "revision-2",
    savedAt: "save-2"
  });
  assert.equal(controller.hasPendingChanges(), false);

  controller.schedule("Third");
  await controller.flush();

  assert.deepEqual(requests, [
    {
      rootId: "root-1",
      relativePath: "notes/example.md",
      markdown: "Second",
      expectedRevision: "revision-1"
    },
    {
      rootId: "root-1",
      relativePath: "notes/example.md",
      markdown: "Third",
      expectedRevision: "revision-2"
    }
  ]);
  assert.equal(savedResults.length, 2);
});

test("retains a failed save for an explicit retry", async (t) => {
  const requests = [];
  const reportedErrors = [];
  const failure = {
    ok: false,
    code: "conflict",
    message: "The file changed on disk.",
    diskRevision: "revision-disk"
  };
  const controller = createDesktopAutosave(
    {
      async autosaveCurrentMarkdown(request) {
        requests.push(request);

        if (requests.length === 1) {
          return failure;
        }

        return {
          ok: true,
          revision: "revision-2",
          savedAt: "save-2"
        };
      }
    },
    {
      delayMs: 60_000,
      onError: (error) => reportedErrors.push(error)
    }
  );
  t.after(() => controller.dispose());

  controller.trackDocument(createDocument());
  controller.schedule("Changed");

  assert.deepEqual(await controller.flush(), failure);
  assert.equal(controller.hasPendingChanges(), true);
  assert.deepEqual(await controller.flush(), {
    ok: true,
    revision: "revision-2",
    savedAt: "save-2"
  });
  assert.equal(controller.hasPendingChanges(), false);
  assert.deepEqual(reportedErrors, [failure]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].expectedRevision, "revision-1");
});

test("tracking another document cancels queued work from the previous document", async (t) => {
  const requests = [];
  const controller = createDesktopAutosave(
    {
      async autosaveCurrentMarkdown(request) {
        requests.push(request);
        return {
          ok: true,
          revision: "revision-2",
          savedAt: "save-2"
        };
      }
    },
    { delayMs: 60_000 }
  );
  t.after(() => controller.dispose());

  controller.trackDocument(createDocument());
  controller.schedule("Unsaved first document");
  controller.trackDocument(
    createDocument({
      relativePath: "notes/second.md",
      name: "second.md",
      displayPath: "C:\\notes\\second.md",
      markdown: "Second document"
    })
  );

  assert.equal(controller.hasPendingChanges(), false);
  assert.equal(await controller.flush(), undefined);

  controller.schedule("Second document");
  assert.equal(controller.hasPendingChanges(), false);
  assert.deepEqual(requests, []);
});
