import { readdirSync } from "node:fs";
import path from "node:path";

const authoredExtensions = new Set([".cjs", ".css", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
  ".agents",
  ".android-toolchain",
  ".codex",
  ".expo",
  ".git",
  ".gradle",
  ".vscode",
  "android",
  "dist",
  "ios",
  "node_modules",
  "package",
  "release",
  "testing"
]);

export function toPosixFileKey(filePath) {
  return filePath.replaceAll("\\", "/").split(path.sep).join(path.posix.sep);
}

export function listAuthoredSourceFiles(repositoryRoot) {
  return collectFiles(repositoryRoot, repositoryRoot).sort();
}

function collectFiles(repositoryRoot, directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : collectFiles(repositoryRoot, absolutePath);
    }

    if (!entry.isFile() || !authoredExtensions.has(path.extname(entry.name))) {
      return [];
    }

    return [toPosixFileKey(path.relative(repositoryRoot, absolutePath))];
  });
}
