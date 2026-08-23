"use strict";

const { randomUUID } = require("node:crypto");
const { promises: defaultFileSystem } = require("node:fs");
const { createWorkspaceDocumentService } = require("./workspaceDocumentService.cjs");
const { createWorkspaceExplorerService } = require("./workspaceExplorerService.cjs");
const { createWorkspaceSessionRegistry } = require("./workspaceSessionRegistry.cjs");

function createWorkspaceService({
  fromWebContents,
  showOpenDialog,
  trashItem,
  fileSystem = defaultFileSystem,
  logger = console,
  now = () => new Date(),
  randomId = randomUUID,
  mediaScheme = "markflow-media"
}) {
  const sessions = createWorkspaceSessionRegistry({
    fileSystem,
    fromWebContents,
    randomId,
    showOpenDialog
  });
  const explorer = createWorkspaceExplorerService({
    fileSystem,
    sessions,
    trashItem
  });
  const documents = createWorkspaceDocumentService({
    fileSystem,
    logger,
    mediaScheme,
    now,
    sessions
  });

  return {
    clearOwner: sessions.clearOwner,
    getRootById: sessions.getRootById,
    handlers: {
      autosaveCurrentMarkdown: documents.autosaveCurrentMarkdown,
      chooseFolder: sessions.chooseFolder,
      createFolder: explorer.createFolder,
      createMarkdownFile: explorer.createMarkdownFile,
      importDroppedFiles: explorer.importDroppedFiles,
      listDirectory: explorer.listDirectory,
      moveEntry: explorer.moveEntry,
      openMarkdown: documents.openMarkdown,
      openMedia: documents.openMedia,
      renameEntry: explorer.renameEntry,
      trashEntry: explorer.trashEntry
    }
  };
}

module.exports = { createWorkspaceService };
