import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listAuthoredSourceFiles } from "./source-inventory.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultMaximumLines = 800;

// Composition roots and lifecycle facades should remain substantially smaller
// than the repository-wide ceiling. These caps leave modest maintenance room
// without allowing extracted responsibilities to drift back into them.
const focusedCaps = new Map([
  ["desktop/main.cjs", 350],
  ["desktop/main-process/workspaceService.cjs", 100],
  ["mobile/App.tsx", 100],
  ["src/customEditorSession.ts", 400],
  ["src/markdownEditorProvider.ts", 75],
  ["webview/src/App.tsx", 200],
  ["webview/src/DesktopSidebar.tsx", 300],
  ["webview/src/desktop/useDesktopWorkspace.ts", 100],
  ["webview/src/draggableBlocksPlugin.tsx", 775],
  ["webview/src/editorTheme.css", 25]
]);

// This browser characterization suite is being decomposed separately. Its cap
// prevents it from growing while preserving room for that work.
const transitionalCaps = new Map([
  ["webview/tests/browser/markflow-unified-block-regression.mjs", 950]
]);

const sourceFiles = listAuthoredSourceFiles(repositoryRoot);
const violations = sourceFiles.flatMap((fileKey) => {
  const source = readFileSync(path.join(repositoryRoot, fileKey), "utf8");
  const lineCount = countLines(source);
  const maximumLines = focusedCaps.get(fileKey) ?? transitionalCaps.get(fileKey) ?? defaultMaximumLines;

  return lineCount > maximumLines
    ? [`${fileKey}: ${lineCount} lines (maximum ${maximumLines})`]
    : [];
});

if (violations.length > 0) {
  console.error("Source boundary check failed:\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Source boundary check passed for ${sourceFiles.length} authored source and test files.`);
}

function countLines(source) {
  if (source.length === 0) {
    return 0;
  }

  return source.split(/\r?\n/).length - (/\r?\n$/.test(source) ? 1 : 0);
}
