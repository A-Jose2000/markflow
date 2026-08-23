"use strict";

const path = require("node:path");

const { MAX_MARKDOWN_BYTES } = require("./markdownStore.cjs");
const { PublicError } = require("./publicErrors.cjs");

const MAX_RELATIVE_PATH_LENGTH = 32_000;
const MAX_CLOSE_ERROR_LENGTH = 1_000;

function readPathRequest(payload) {
  if (!isPlainRecord(payload)) {
    throw new PublicError("INVALID_REQUEST", "The filesystem request is invalid.");
  }

  return {
    rootId: readRootId(payload.rootId),
    relativePath: normalizeApiRelativePath(payload.relativePath)
  };
}

function readCreateEntryRequest(payload) {
  if (!isPlainRecord(payload)) {
    throw new PublicError("INVALID_REQUEST", "The create request is invalid.");
  }

  return {
    rootId: readRootId(payload.rootId),
    parentRelativePath: normalizeApiRelativePath(payload.parentRelativePath),
    name: normalizeNewEntryName(payload.name)
  };
}

function readImportFilesRequest(payload) {
  if (!isPlainRecord(payload) || !Array.isArray(payload.sourcePaths)) {
    throw new PublicError("INVALID_REQUEST", "The dropped-file request is invalid.");
  }

  if (payload.sourcePaths.length === 0 || payload.sourcePaths.length > 100) {
    throw new PublicError("INVALID_REQUEST", "Drop between 1 and 100 files at a time.");
  }

  const sourcePaths = payload.sourcePaths.map((sourcePath) => {
    if (
      typeof sourcePath !== "string" ||
      sourcePath.length === 0 ||
      sourcePath.length > MAX_RELATIVE_PATH_LENGTH ||
      sourcePath.includes("\0") ||
      !path.isAbsolute(sourcePath)
    ) {
      throw new PublicError("INVALID_REQUEST", "A dropped file path is invalid.");
    }

    return path.resolve(sourcePath);
  });

  return {
    rootId: readRootId(payload.rootId),
    parentRelativePath: normalizeApiRelativePath(payload.parentRelativePath),
    sourcePaths
  };
}

function readMoveEntryRequest(payload) {
  if (!isPlainRecord(payload)) {
    throw new PublicError("INVALID_REQUEST", "The move request is invalid.");
  }

  const sourceRelativePath = normalizeApiRelativePath(payload.sourceRelativePath);

  if (!sourceRelativePath) {
    throw new PublicError("INVALID_REQUEST", "The open Explorer folder cannot be moved.");
  }

  return {
    rootId: readRootId(payload.rootId),
    sourceRelativePath,
    destinationParentRelativePath: normalizeApiRelativePath(payload.destinationParentRelativePath)
  };
}

function readRenameEntryRequest(payload) {
  if (!isPlainRecord(payload)) {
    throw new PublicError("INVALID_REQUEST", "The rename request is invalid.");
  }

  const relativePath = normalizeApiRelativePath(payload.relativePath);

  if (!relativePath) {
    throw new PublicError("INVALID_REQUEST", "The open Explorer folder cannot be renamed.");
  }

  return {
    rootId: readRootId(payload.rootId),
    relativePath,
    name: normalizeNewEntryName(payload.name)
  };
}

function normalizeNewMarkdownName(value) {
  const name = normalizeNewEntryName(value);
  const extension = path.extname(name).toLowerCase();

  if (!extension) {
    return normalizeNewEntryName(`${name}.md`);
  }

  if (extension !== ".md" && extension !== ".markdown") {
    throw new PublicError("UNSUPPORTED_FILE", "New editor files must use .md or .markdown.");
  }

  return name;
}

function normalizeNewEntryName(value) {
  if (typeof value !== "string") {
    throw new PublicError("INVALID_NAME", "Enter a name for the new item.");
  }

  const name = value.trim();

  if (
    name.length === 0 ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
    /[. ]$/.test(name)
  ) {
    throw new PublicError("INVALID_NAME", "That name is not valid on Windows.");
  }

  const windowsBaseName = name.split(".", 1)[0].toUpperCase();

  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsBaseName)) {
    throw new PublicError("INVALID_NAME", "That name is reserved by Windows.");
  }

  return name;
}

function readAutosaveRequest(payload) {
  if (!isPlainRecord(payload)) {
    throw new PublicError("INVALID_REQUEST", "The autosave request is invalid.");
  }

  const rootId = readRootId(payload.rootId);
  const relativePath = normalizeApiRelativePath(payload.relativePath);

  if (typeof payload.expectedRevision !== "string" || payload.expectedRevision.length > 256) {
    throw new PublicError("INVALID_REQUEST", "The autosave revision is invalid.");
  }

  if (typeof payload.markdown !== "string") {
    throw new PublicError("INVALID_REQUEST", "The Markdown update is invalid.");
  }

  if (Buffer.byteLength(payload.markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new PublicError("FILE_TOO_LARGE", "This Markdown document is too large to autosave.");
  }

  return {
    rootId,
    relativePath,
    expectedRevision: payload.expectedRevision,
    markdown: payload.markdown
  };
}

function readCloseResult(payload) {
  if (!isPlainRecord(payload)) {
    throw new PublicError("INVALID_CLOSE_REQUEST", "The close response is invalid.");
  }

  const requestId = readCloseRequestId(payload.requestId);

  if (payload.ok === true) {
    return { requestId, ok: true };
  }

  if (payload.ok !== false || typeof payload.message !== "string") {
    throw new PublicError("INVALID_CLOSE_REQUEST", "The close response is invalid.");
  }

  const message = payload.message.trim();

  if (message.length === 0 || message.length > MAX_CLOSE_ERROR_LENGTH || message.includes("\0")) {
    throw new PublicError("INVALID_CLOSE_REQUEST", "The close failure message is invalid.");
  }

  return { requestId, ok: false, message };
}

function readCloseRequestId(value) {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new PublicError("INVALID_CLOSE_REQUEST", "The close request identifier is invalid.");
  }

  return value;
}

function readRootId(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[a-zA-Z0-9-]+$/.test(value)) {
    throw new PublicError("INVALID_REQUEST", "The folder identifier is invalid.");
  }

  return value;
}

function normalizeApiRelativePath(value) {
  if (typeof value !== "string") {
    throw new PublicError("INVALID_REQUEST", "The relative path is invalid.");
  }

  if (value.length > MAX_RELATIVE_PATH_LENGTH || value.includes("\0")) {
    throw new PublicError("INVALID_REQUEST", "The relative path is invalid.");
  }

  if (value === "") {
    return "";
  }

  if (
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value)
  ) {
    throw new PublicError("OUTSIDE_FOLDER", "Absolute paths are not accepted by the explorer.");
  }

  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");

  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new PublicError("OUTSIDE_FOLDER", "The relative path contains an invalid segment.");
  }

  return segments.join("/");
}

function readRelativePath(value) {
  const normalized = normalizeApiRelativePath(value);
  return normalized === "" ? [] : normalized.split("/");
}

function decodeMediaPath(pathname) {
  const segments = pathname.split("/").filter(Boolean).map((segment) => {
    let decoded;

    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new PublicError("INVALID_REQUEST", "The media path is invalid.");
    }

    if (decoded.includes("/") || decoded.includes("\\")) {
      throw new PublicError("OUTSIDE_FOLDER", "The media path contains an invalid segment.");
    }

    return decoded;
  });

  return normalizeApiRelativePath(segments.join("/"));
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  decodeMediaPath,
  normalizeApiRelativePath,
  normalizeNewEntryName,
  normalizeNewMarkdownName,
  readAutosaveRequest,
  readCloseResult,
  readCreateEntryRequest,
  readImportFilesRequest,
  readMoveEntryRequest,
  readPathRequest,
  readRelativePath,
  readRenameEntryRequest
};
