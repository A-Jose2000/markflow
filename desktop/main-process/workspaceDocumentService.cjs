"use strict";

const path = require("node:path");
const { promises: defaultFileSystem } = require("node:fs");
const { classifyFile } = require("../fileCatalog.cjs");
const {
  MAX_MARKDOWN_BYTES,
  encodeMarkdown,
  readMarkdownFile,
  revisionFromStats,
  writeFileAtomically
} = require("../markdownStore.cjs");
const { PublicError, publicMessage } = require("../publicErrors.cjs");
const { readAutosaveRequest, readPathRequest } = require("../requestValidation.cjs");
const { resolveExistingPath, toApiRelativePath } = require("../workspacePaths.cjs");

function createWorkspaceDocumentService({
  sessions,
  fileSystem = defaultFileSystem,
  logger = console,
  now = () => new Date(),
  mediaScheme = "markflow-media"
}) {
  async function openMarkdown(event, payload) {
    const request = readPathRequest(payload);
    const root = sessions.getOwnedRoot(event.sender.id, request.rootId);
    const fileType = classifyFile(request.relativePath);

    if (fileType?.kind !== "markdown") {
      throw new PublicError("UNSUPPORTED_FILE", "Only Markdown files can be opened in the editor.");
    }

    const realPath = await resolveExistingPath(root, request.relativePath);
    const openedFile = await readMarkdownFile(realPath);
    const normalizedRelativePath = toApiRelativePath(path.relative(root.realPath, realPath));
    sessions.setActiveMarkdown(event.sender.id, {
      rootId: root.id,
      relativePath: normalizedRelativePath,
      realPath,
      revision: openedFile.revision,
      eol: openedFile.eol,
      hasBom: openedFile.hasBom
    });

    return {
      rootId: root.id,
      relativePath: normalizedRelativePath,
      name: path.basename(realPath),
      displayPath: path.join(root.displayPath, ...normalizedRelativePath.split("/")),
      markdown: openedFile.markdown,
      revision: openedFile.revision,
      eol: openedFile.eol,
      hasBom: openedFile.hasBom
    };
  }

  async function openMedia(event, payload) {
    const request = readPathRequest(payload);
    const root = sessions.getOwnedRoot(event.sender.id, request.rootId);
    const fileType = classifyFile(request.relativePath);

    if (!fileType || fileType.kind === "markdown") {
      throw new PublicError(
        "UNSUPPORTED_FILE",
        "That file does not have an in-app media preview."
      );
    }

    const realPath = await resolveExistingPath(root, request.relativePath);
    const stats = await fileSystem.stat(realPath);

    if (!stats.isFile()) {
      throw new PublicError("NOT_A_FILE", "That explorer item is not a file.");
    }

    const normalizedRelativePath = toApiRelativePath(path.relative(root.realPath, realPath));
    sessions.clearActiveMarkdown(event.sender.id);
    return {
      rootId: root.id,
      relativePath: normalizedRelativePath,
      name: path.basename(realPath),
      displayPath: path.join(root.displayPath, ...normalizedRelativePath.split("/")),
      kind: fileType.kind,
      mimeType: fileType.mimeType,
      url: createMediaUrl(mediaScheme, root.id, normalizedRelativePath)
    };
  }

  async function autosaveCurrentMarkdown(event, payload) {
    let request;

    try {
      request = readAutosaveRequest(payload);
    } catch (error) {
      return saveFailure("invalid_markdown", publicMessage(error, "The Markdown update is invalid."));
    }

    const active = sessions.getActiveMarkdown(event.sender.id);

    if (!active) {
      return saveFailure("no_current_document", "Open a Markdown file before saving.");
    }

    if (active.rootId !== request.rootId || active.relativePath !== request.relativePath) {
      return saveFailure("stale_document", "The requested file is no longer the active Markdown document.");
    }

    const root = sessions.getRootById(active.rootId);

    if (!root || root.ownerId !== event.sender.id) {
      return saveFailure("stale_document", "The folder containing this document is no longer open.");
    }

    if (request.expectedRevision !== active.revision) {
      return saveFailure("conflict", "The document changed since this edit was prepared.", active.revision);
    }

    try {
      const realPath = await resolveExistingPath(root, active.relativePath);

      if (realPath !== active.realPath) {
        return saveFailure("conflict", "The document now resolves to a different file.");
      }

      const beforeStats = await fileSystem.stat(realPath, { bigint: true });
      const diskRevision = revisionFromStats(beforeStats);

      if (diskRevision !== active.revision) {
        return saveFailure("conflict", "The document was changed by another application.", diskRevision);
      }

      const encodedMarkdown = encodeMarkdown(request.markdown, active.eol, active.hasBom);

      if (encodedMarkdown.byteLength > MAX_MARKDOWN_BYTES) {
        return saveFailure("invalid_markdown", "This Markdown document is too large to autosave.");
      }

      await writeFileAtomically(realPath, encodedMarkdown, Number(beforeStats.mode));
      const afterStats = await fileSystem.stat(realPath, { bigint: true });
      const revision = revisionFromStats(afterStats);
      sessions.updateActiveMarkdown(event.sender.id, {
        realPath: await fileSystem.realpath(realPath),
        revision
      });
      return { ok: true, revision, savedAt: now().toISOString() };
    } catch (error) {
      logger.error("Markflow Desktop could not autosave the active Markdown file.", error);
      return saveFailure("io_error", "Markflow could not save the current Markdown file.");
    }
  }

  return {
    autosaveCurrentMarkdown,
    openMarkdown,
    openMedia
  };
}

function createMediaUrl(mediaScheme, rootId, relativePath) {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `${mediaScheme}://${rootId}/${encodedPath}`;
}

function saveFailure(code, message, diskRevision) {
  return { ok: false, code, message, ...(diskRevision ? { diskRevision } : {}) };
}

module.exports = {
  createMediaUrl,
  createWorkspaceDocumentService,
  saveFailure
};
