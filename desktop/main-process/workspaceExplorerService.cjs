"use strict";

const path = require("node:path");
const { constants: fsConstants, promises: defaultFileSystem } = require("node:fs");
const { classifyFile } = require("../fileCatalog.cjs");
const { PublicError, hasFileSystemErrorCode } = require("../publicErrors.cjs");
const {
  normalizeNewEntryName,
  normalizeNewMarkdownName,
  readCreateEntryRequest,
  readImportFilesRequest,
  readMoveEntryRequest,
  readPathRequest,
  readRenameEntryRequest
} = require("../requestValidation.cjs");
const {
  apiParentPath,
  assertContained,
  isPathWithinOrEqual,
  joinApiPath,
  resolveExistingPath,
  sameFileSystemPath
} = require("../workspacePaths.cjs");

function createWorkspaceExplorerService({
  sessions,
  trashItem,
  fileSystem = defaultFileSystem
}) {
  async function listDirectory(event, payload) {
    const request = readPathRequest(payload);
    const root = sessions.getOwnedRoot(event.sender.id, request.rootId);
    const directoryPath = await resolveExistingPath(root, request.relativePath);
    const directoryStats = await fileSystem.stat(directoryPath);

    if (!directoryStats.isDirectory()) {
      throw new PublicError("NOT_A_DIRECTORY", "That explorer item is not a folder.");
    }

    const directoryEntries = await fileSystem.readdir(directoryPath, { withFileTypes: true });
    const visibleEntries = [];

    for (const entry of directoryEntries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const relativePath = joinApiPath(request.relativePath, entry.name);

      if (entry.isDirectory()) {
        visibleEntries.push({ name: entry.name, relativePath, kind: "directory" });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileType = classifyFile(entry.name);

      if (fileType) {
        visibleEntries.push({
          name: entry.name,
          relativePath,
          kind: fileType.kind,
          mimeType: fileType.mimeType
        });
      }
    }

    visibleEntries.sort(compareExplorerEntries);
    return visibleEntries;
  }

  async function createMarkdownFile(event, payload) {
    const request = readCreateEntryRequest(payload);
    const root = sessions.getOwnedRoot(event.sender.id, request.rootId);
    const parentPath = await requireDirectory(
      root,
      request.parentRelativePath,
      "Choose a folder before creating a Markdown file."
    );
    const name = normalizeNewMarkdownName(request.name);
    const relativePath = joinApiPath(request.parentRelativePath, name);
    const candidatePath = path.resolve(parentPath, name);
    assertContained(root.realPath, candidatePath);

    try {
      await fileSystem.writeFile(candidatePath, "", { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (hasFileSystemErrorCode(error, "EEXIST")) {
        throw new PublicError("ALREADY_EXISTS", "A file or folder with that name already exists.");
      }

      throw error;
    }

    const realPath = await fileSystem.realpath(candidatePath);
    assertContained(root.realPath, realPath);
    return { kind: "markdown", name, relativePath, mimeType: classifyFile(name).mimeType };
  }

  async function createFolder(event, payload) {
    const request = readCreateEntryRequest(payload);
    const root = sessions.getOwnedRoot(event.sender.id, request.rootId);
    const parentPath = await requireDirectory(
      root,
      request.parentRelativePath,
      "Choose a folder before creating another folder."
    );
    const name = normalizeNewEntryName(request.name);
    const relativePath = joinApiPath(request.parentRelativePath, name);
    const candidatePath = path.resolve(parentPath, name);
    assertContained(root.realPath, candidatePath);

    try {
      await fileSystem.mkdir(candidatePath);
    } catch (error) {
      if (hasFileSystemErrorCode(error, "EEXIST")) {
        throw new PublicError("ALREADY_EXISTS", "A file or folder with that name already exists.");
      }

      throw error;
    }

    const realPath = await fileSystem.realpath(candidatePath);
    assertContained(root.realPath, realPath);
    return { kind: "directory", name, relativePath };
  }

  async function importDroppedFiles(event, payload) {
    const request = readImportFilesRequest(payload);
    const root = sessions.getOwnedRoot(event.sender.id, request.rootId);
    const parentPath = await requireDirectory(
      root,
      request.parentRelativePath,
      "Drop files onto an existing folder."
    );
    const sources = [];
    const rejected = [];

    for (const sourcePath of request.sourcePaths) {
      const sourceStats = await fileSystem.stat(sourcePath).catch(() => undefined);
      const sourceName = path.basename(sourcePath);
      const fileType = classifyFile(sourceName);

      if (!sourceStats?.isFile() || !fileType) {
        rejected.push(sourceName || "Unsupported item");
      } else {
        sources.push({ sourcePath, sourceName, fileType });
      }
    }

    if (sources.length === 0) {
      throw new PublicError(
        "UNSUPPORTED_FILE",
        "Drop Markdown, image, audio, video, or PDF files into the Explorer."
      );
    }

    const imported = [];

    for (const source of sources) {
      imported.push(await copyDroppedFile(root, parentPath, request.parentRelativePath, source));
    }

    return { imported, rejected };
  }

  async function copyDroppedFile(root, parentPath, parentRelativePath, source) {
    const parsedName = path.parse(normalizeNewEntryName(source.sourceName));

    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const name = attempt === 0
        ? parsedName.base
        : `${parsedName.name} (${attempt})${parsedName.ext}`;
      const relativePath = joinApiPath(parentRelativePath, name);
      const candidatePath = path.resolve(parentPath, name);
      assertContained(root.realPath, candidatePath);

      try {
        await fileSystem.copyFile(source.sourcePath, candidatePath, fsConstants.COPYFILE_EXCL);
        const realPath = await fileSystem.realpath(candidatePath);
        assertContained(root.realPath, realPath);
        return { kind: source.fileType.kind, name, relativePath, mimeType: source.fileType.mimeType };
      } catch (error) {
        if (hasFileSystemErrorCode(error, "EEXIST")) {
          continue;
        }

        await fileSystem.unlink(candidatePath).catch(() => undefined);
        throw error;
      }
    }

    throw new PublicError(
      "ALREADY_EXISTS",
      `Markflow could not find an available name for ${source.sourceName}.`
    );
  }

  async function moveEntry(event, payload) {
    const request = readMoveEntryRequest(payload);
    const root = sessions.getOwnedRoot(event.sender.id, request.rootId);
    const sourcePath = await resolveExistingPath(root, request.sourceRelativePath);
    const sourceEntry = await readExplorerEntry(sourcePath, request.sourceRelativePath);
    const destinationParentPath = await requireDirectory(
      root,
      request.destinationParentRelativePath,
      "Move items into an existing folder."
    );

    if (sourceEntry.kind === "directory" && isPathWithinOrEqual(sourcePath, destinationParentPath)) {
      throw new PublicError(
        "INVALID_DESTINATION",
        "A folder cannot be moved into itself or one of its subfolders."
      );
    }

    const nextRelativePath = joinApiPath(request.destinationParentRelativePath, sourceEntry.name);
    const destinationPath = path.resolve(destinationParentPath, sourceEntry.name);
    assertContained(root.realPath, destinationPath);

    if (sameFileSystemPath(sourcePath, destinationPath)) {
      return { changed: false, previousRelativePath: request.sourceRelativePath, entry: sourceEntry };
    }

    await assertDestinationAvailable(destinationPath, sourcePath);
    await relocateEntry(sourcePath, destinationPath, "A file or folder with that name already exists there.");
    const realDestinationPath = await fileSystem.realpath(destinationPath);
    assertContained(root.realPath, realDestinationPath);
    await sessions.updateActiveMarkdownAfterRelocation(
      event.sender.id,
      root,
      sourcePath,
      realDestinationPath
    );

    return {
      changed: true,
      previousRelativePath: request.sourceRelativePath,
      entry: await readExplorerEntry(realDestinationPath, nextRelativePath)
    };
  }

  async function renameEntry(event, payload) {
    const request = readRenameEntryRequest(payload);
    const root = sessions.getOwnedRoot(event.sender.id, request.rootId);
    const sourcePath = await resolveExistingPath(root, request.relativePath);
    const sourceEntry = await readExplorerEntry(sourcePath, request.relativePath);
    const parentRelativePath = apiParentPath(request.relativePath);
    let name = normalizeNewEntryName(request.name);

    if (sourceEntry.kind !== "directory") {
      if (!path.extname(name) && sourceEntry.kind === "markdown") {
        name = normalizeNewEntryName(`${name}.md`);
      }

      const nextFileType = classifyFile(name);

      if (!nextFileType || nextFileType.kind !== sourceEntry.kind) {
        throw new PublicError(
          "UNSUPPORTED_FILE",
          `Keep a supported ${sourceEntry.kind} extension when renaming this file.`
        );
      }
    }

    const nextRelativePath = joinApiPath(parentRelativePath, name);
    const destinationPath = path.resolve(path.dirname(sourcePath), name);
    assertContained(root.realPath, destinationPath);

    if (sourceEntry.name === name) {
      return { changed: false, previousRelativePath: request.relativePath, entry: sourceEntry };
    }

    await assertDestinationAvailable(destinationPath, sourcePath);
    await relocateEntry(sourcePath, destinationPath, "A file or folder with that name already exists.");
    const realDestinationPath = await fileSystem.realpath(destinationPath);
    assertContained(root.realPath, realDestinationPath);
    await sessions.updateActiveMarkdownAfterRelocation(
      event.sender.id,
      root,
      sourcePath,
      realDestinationPath
    );

    return {
      changed: true,
      previousRelativePath: request.relativePath,
      entry: await readExplorerEntry(realDestinationPath, nextRelativePath)
    };
  }

  async function trashEntry(event, payload) {
    const request = readPathRequest(payload);

    if (!request.relativePath) {
      throw new PublicError(
        "INVALID_REQUEST",
        "The open Explorer folder cannot be deleted from Markflow."
      );
    }

    const root = sessions.getOwnedRoot(event.sender.id, request.rootId);
    const sourcePath = await resolveExistingPath(root, request.relativePath);
    const entry = await readExplorerEntry(sourcePath, request.relativePath);
    await trashItem(sourcePath);
    sessions.clearActiveMarkdownInside(event.sender.id, sourcePath);
    return { relativePath: request.relativePath, name: entry.name };
  }

  async function requireDirectory(root, relativePath, message) {
    const directoryPath = await resolveExistingPath(root, relativePath);
    const stats = await fileSystem.stat(directoryPath);

    if (!stats.isDirectory()) {
      throw new PublicError("NOT_A_DIRECTORY", message);
    }

    return directoryPath;
  }

  async function relocateEntry(sourcePath, destinationPath, conflictMessage) {
    try {
      await fileSystem.rename(sourcePath, destinationPath);
    } catch (error) {
      if (hasFileSystemErrorCode(error, "EEXIST") || hasFileSystemErrorCode(error, "ENOTEMPTY")) {
        throw new PublicError("ALREADY_EXISTS", conflictMessage);
      }

      throw error;
    }
  }

  async function readExplorerEntry(realPath, relativePath) {
    const stats = await fileSystem.stat(realPath);
    const name = path.basename(realPath);

    if (stats.isDirectory()) {
      return { kind: "directory", name, relativePath };
    }

    if (!stats.isFile()) {
      throw new PublicError(
        "NOT_A_FILE",
        "That Explorer item is not a regular file or folder."
      );
    }

    const fileType = classifyFile(name);

    if (!fileType) {
      throw new PublicError("UNSUPPORTED_FILE", "That file type is not supported by Markflow.");
    }

    return { kind: fileType.kind, name, relativePath, mimeType: fileType.mimeType };
  }

  async function assertDestinationAvailable(destinationPath, sourcePath) {
    try {
      const existingPath = await fileSystem.realpath(destinationPath);

      if (!sameFileSystemPath(existingPath, sourcePath)) {
        throw new PublicError(
          "ALREADY_EXISTS",
          "A file or folder with that name already exists there."
        );
      }
    } catch (error) {
      if (hasFileSystemErrorCode(error, "ENOENT")) {
        return;
      }

      throw error;
    }
  }

  return {
    createFolder,
    createMarkdownFile,
    importDroppedFiles,
    listDirectory,
    moveEntry,
    renameEntry,
    trashEntry
  };
}

function compareExplorerEntries(left, right) {
  if (left.kind === "directory" && right.kind !== "directory") {
    return -1;
  }

  if (left.kind !== "directory" && right.kind === "directory") {
    return 1;
  }

  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

module.exports = {
  compareExplorerEntries,
  createWorkspaceExplorerService
};
