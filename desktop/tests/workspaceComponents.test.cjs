"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { PublicError } = require("../publicErrors.cjs");
const { createMediaUrl } = require("../main-process/workspaceDocumentService.cjs");
const { compareExplorerEntries } = require("../main-process/workspaceExplorerService.cjs");
const { createWorkspaceSessionRegistry } = require("../main-process/workspaceSessionRegistry.cjs");

test("Explorer ordering keeps folders first and applies numeric filename ordering", () => {
  const entries = [
    { kind: "markdown", name: "Note 10.md" },
    { kind: "directory", name: "zeta" },
    { kind: "markdown", name: "note 2.md" },
    { kind: "directory", name: "Alpha" }
  ];

  entries.sort(compareExplorerEntries);

  assert.deepEqual(entries.map((entry) => entry.name), [
    "Alpha",
    "zeta",
    "note 2.md",
    "Note 10.md"
  ]);
});

test("media URLs encode each path segment without flattening the document path", () => {
  assert.equal(
    createMediaUrl("markflow-media", "root-1", "Meeting notes #1/audio?.mp3"),
    "markflow-media://root-1/Meeting%20notes%20%231/audio%3F.mp3"
  );
});

test("opening another folder replaces only that owner's root and document session", async () => {
  const firstPath = path.resolve("workspace-one");
  const secondPath = path.resolve("workspace-two");
  const selectedPaths = [firstPath, secondPath];
  const ids = ["root-1", "root-2"];
  const sessions = createWorkspaceSessionRegistry({
    fileSystem: {
      realpath: async (filePath) => path.resolve(filePath),
      stat: async () => ({ isDirectory: () => true })
    },
    fromWebContents: () => undefined,
    randomId: () => ids.shift(),
    showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPaths.shift()] })
  });
  const event = { sender: { id: 7 } };
  const firstRoot = await sessions.chooseFolder(event);
  sessions.setActiveMarkdown(7, {
    rootId: firstRoot.id,
    relativePath: "Drafts/Notes.md",
    realPath: path.join(firstPath, "Drafts", "Notes.md"),
    revision: "revision-1",
    eol: "lf",
    hasBom: false
  });

  const secondRoot = await sessions.chooseFolder(event);

  assert.equal(sessions.getRootById(firstRoot.id), undefined);
  assert.equal(sessions.getActiveMarkdown(7), undefined);
  assert.equal(sessions.getOwnedRoot(7, secondRoot.id).realPath, secondPath);
  await assert.rejects(
    async () => sessions.getOwnedRoot(8, secondRoot.id),
    (error) => error instanceof PublicError && error.code === "FOLDER_UNAVAILABLE"
  );
});
