"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PublicError } = require("../publicErrors.cjs");
const { createWorkspaceService } = require("../main-process/workspaceService.cjs");

function createEvent(ownerId) {
  return { sender: { id: ownerId } };
}

test("workspace roots are owner-scoped and explorer results retain the desktop ordering contract", async (t) => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "markflow-workspace-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  await mkdir(path.join(rootPath, "Folder"));
  await writeFile(path.join(rootPath, "Notes.md"), "# Notes\n", "utf8");
  await writeFile(path.join(rootPath, "ignored.zip"), "archive", "utf8");
  const service = createWorkspaceService({
    fromWebContents: () => undefined,
    showOpenDialog: async () => ({ canceled: false, filePaths: [rootPath] }),
    trashItem: async () => undefined,
    randomId: () => "root-1"
  });
  const root = await service.handlers.chooseFolder(createEvent(7));

  assert.equal(root.id, "root-1");
  assert.deepEqual(
    await service.handlers.listDirectory(createEvent(7), { rootId: root.id, relativePath: "" }),
    [
      { kind: "directory", name: "Folder", relativePath: "Folder" },
      {
        kind: "markdown",
        mimeType: "text/markdown; charset=utf-8",
        name: "Notes.md",
        relativePath: "Notes.md"
      }
    ]
  );
  await assert.rejects(
    service.handlers.listDirectory(createEvent(8), { rootId: root.id, relativePath: "" }),
    (error) => error instanceof PublicError && error.code === "FOLDER_UNAVAILABLE"
  );

  service.clearOwner(7);
  assert.equal(service.getRootById(root.id), undefined);
});

test("an opened Markdown document keeps its revision and encoding through autosave", async (t) => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "markflow-document-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  await writeFile(path.join(rootPath, "Notes.md"), "# Notes\r\n", "utf8");
  const service = createWorkspaceService({
    fromWebContents: () => undefined,
    showOpenDialog: async () => ({ canceled: false, filePaths: [rootPath] }),
    trashItem: async () => undefined,
    randomId: () => "root-1",
    now: () => new Date("2026-08-22T12:00:00.000Z")
  });
  const event = createEvent(7);
  const root = await service.handlers.chooseFolder(event);
  const opened = await service.handlers.openMarkdown(event, {
    rootId: root.id,
    relativePath: "Notes.md"
  });
  const result = await service.handlers.autosaveCurrentMarkdown(event, {
    rootId: root.id,
    relativePath: "Notes.md",
    expectedRevision: opened.revision,
    markdown: "# Updated\n"
  });

  assert.equal(result.ok, true);
  assert.equal(result.savedAt, "2026-08-22T12:00:00.000Z");
  assert.equal(await readFile(path.join(rootPath, "Notes.md"), "utf8"), "# Updated\r\n");
});

test("moving a folder relocates its active document before the next autosave", async (t) => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "markflow-relocation-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  await mkdir(path.join(rootPath, "Drafts"));
  await mkdir(path.join(rootPath, "Archive"));
  await writeFile(path.join(rootPath, "Drafts", "Notes.md"), "Draft\n", "utf8");
  const service = createWorkspaceService({
    fromWebContents: () => undefined,
    showOpenDialog: async () => ({ canceled: false, filePaths: [rootPath] }),
    trashItem: async () => undefined,
    randomId: () => "root-1"
  });
  const event = createEvent(7);
  const root = await service.handlers.chooseFolder(event);
  const opened = await service.handlers.openMarkdown(event, {
    rootId: root.id,
    relativePath: "Drafts/Notes.md"
  });

  await service.handlers.moveEntry(event, {
    rootId: root.id,
    sourceRelativePath: "Drafts",
    destinationParentRelativePath: "Archive"
  });
  const saved = await service.handlers.autosaveCurrentMarkdown(event, {
    rootId: root.id,
    relativePath: "Archive/Drafts/Notes.md",
    expectedRevision: opened.revision,
    markdown: "Final\n"
  });

  assert.equal(saved.ok, true);
  assert.equal(
    await readFile(path.join(rootPath, "Archive", "Drafts", "Notes.md"), "utf8"),
    "Final\n"
  );
});
