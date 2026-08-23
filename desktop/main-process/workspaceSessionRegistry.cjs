"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { promises: defaultFileSystem } = require("node:fs");
const { PublicError } = require("../publicErrors.cjs");
const {
  assertContained,
  isPathWithinOrEqual,
  toApiRelativePath
} = require("../workspacePaths.cjs");

function createWorkspaceSessionRegistry({
  fromWebContents,
  showOpenDialog,
  fileSystem = defaultFileSystem,
  randomId = randomUUID
}) {
  /** @type {Map<string, WorkspaceRoot>} */
  const rootsById = new Map();
  /** @type {Map<number, ActiveMarkdown>} */
  const activeMarkdownByOwner = new Map();

  async function chooseFolder(event) {
    const parentWindow = fromWebContents(event.sender) ?? undefined;
    const options = {
      title: "Open a folder in Markflow",
      buttonLabel: "Open folder",
      properties: ["openDirectory", "dontAddToRecent"]
    };
    const result = await showOpenDialog(parentWindow, options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];
    const realPath = await fileSystem.realpath(selectedPath);
    const stats = await fileSystem.stat(realPath);

    if (!stats.isDirectory()) {
      throw new PublicError("NOT_A_DIRECTORY", "The selected item is not a folder.");
    }

    const ownerId = event.sender.id;
    clearOwner(ownerId);

    const root = {
      id: randomId(),
      ownerId,
      name: path.basename(realPath) || realPath,
      displayPath: path.resolve(selectedPath),
      realPath
    };

    rootsById.set(root.id, root);
    return toPublicRoot(root);
  }

  function getOwnedRoot(ownerId, rootId) {
    const root = rootsById.get(rootId);

    if (!root || root.ownerId !== ownerId) {
      throw new PublicError(
        "FOLDER_UNAVAILABLE",
        "That folder is no longer open in this window."
      );
    }

    return root;
  }

  function getRootById(rootId) {
    return rootsById.get(rootId);
  }

  function getActiveMarkdown(ownerId) {
    return activeMarkdownByOwner.get(ownerId);
  }

  function setActiveMarkdown(ownerId, activeMarkdown) {
    activeMarkdownByOwner.set(ownerId, activeMarkdown);
  }

  function clearActiveMarkdown(ownerId) {
    activeMarkdownByOwner.delete(ownerId);
  }

  function updateActiveMarkdown(ownerId, update) {
    const active = activeMarkdownByOwner.get(ownerId);

    if (active) {
      Object.assign(active, update);
    }
  }

  async function updateActiveMarkdownAfterRelocation(ownerId, root, sourcePath, destinationPath) {
    const active = activeMarkdownByOwner.get(ownerId);

    if (!active || !isPathWithinOrEqual(sourcePath, active.realPath)) {
      return;
    }

    const nextPath = path.resolve(destinationPath, path.relative(sourcePath, active.realPath));
    assertContained(root.realPath, nextPath);
    active.realPath = await fileSystem.realpath(nextPath);
    active.relativePath = toApiRelativePath(path.relative(root.realPath, active.realPath));
  }

  function clearActiveMarkdownInside(ownerId, sourcePath) {
    const active = activeMarkdownByOwner.get(ownerId);

    if (active && isPathWithinOrEqual(sourcePath, active.realPath)) {
      activeMarkdownByOwner.delete(ownerId);
    }
  }

  function clearOwnerRoots(ownerId) {
    for (const [rootId, root] of rootsById) {
      if (root.ownerId === ownerId) {
        rootsById.delete(rootId);
      }
    }
  }

  function clearOwner(ownerId) {
    activeMarkdownByOwner.delete(ownerId);
    clearOwnerRoots(ownerId);
  }

  return {
    chooseFolder,
    clearActiveMarkdown,
    clearActiveMarkdownInside,
    clearOwner,
    getActiveMarkdown,
    getOwnedRoot,
    getRootById,
    setActiveMarkdown,
    updateActiveMarkdown,
    updateActiveMarkdownAfterRelocation
  };
}

function toPublicRoot(root) {
  return { id: root.id, name: root.name, displayPath: root.displayPath };
}

/**
 * @typedef {object} WorkspaceRoot
 * @property {string} id
 * @property {number} ownerId
 * @property {string} name
 * @property {string} displayPath
 * @property {string} realPath
 */

/**
 * @typedef {object} ActiveMarkdown
 * @property {string} rootId
 * @property {string} relativePath
 * @property {string} realPath
 * @property {string} revision
 * @property {"lf" | "crlf"} eol
 * @property {boolean} hasBom
 */

module.exports = { createWorkspaceSessionRegistry };
