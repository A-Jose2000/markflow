"use strict";

const path = require("node:path");
const { promises: fs } = require("node:fs");

const { PublicError, hasFileSystemErrorCode } = require("./publicErrors.cjs");
const { readRelativePath } = require("./requestValidation.cjs");

async function resolveExistingPath(root, relativePath) {
  const pathSegments = readRelativePath(relativePath);
  const candidatePath = path.resolve(root.realPath, ...pathSegments);
  assertContained(root.realPath, candidatePath);

  let realPath;

  try {
    realPath = await fs.realpath(candidatePath);
  } catch (error) {
    if (hasFileSystemErrorCode(error, "ENOENT")) {
      throw new PublicError("NOT_FOUND", "That file or folder no longer exists.");
    }

    throw error;
  }

  assertContained(root.realPath, realPath);
  return realPath;
}

function assertContained(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  const escapesRoot =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);

  if (escapesRoot) {
    throw new PublicError("OUTSIDE_FOLDER", "That path is outside the selected folder.");
  }
}

function joinApiPath(parentPath, childName) {
  return parentPath ? `${parentPath}/${childName}` : childName;
}

function apiParentPath(relativePath) {
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex < 0 ? "" : relativePath.slice(0, separatorIndex);
}

function isPathWithinOrEqual(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sameFileSystemPath(leftPath, rightPath) {
  const left = path.resolve(leftPath);
  const right = path.resolve(rightPath);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function toApiRelativePath(relativePath) {
  return relativePath.split(path.sep).filter(Boolean).join("/");
}

module.exports = {
  apiParentPath,
  assertContained,
  isPathWithinOrEqual,
  joinApiPath,
  resolveExistingPath,
  sameFileSystemPath,
  toApiRelativePath
};
