import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { listAuthoredSourceFiles, toPosixFileKey } from "./source-inventory.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleExtensions = [".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"];
const resolutionExtensions = [".d.ts", ...moduleExtensions];
const moduleFileKeys = listAuthoredSourceFiles(repositoryRoot).filter((fileKey) =>
  moduleExtensions.includes(path.extname(fileKey))
);
const moduleFileKeySet = new Set(moduleFileKeys);
const dependenciesByFile = new Map(
  moduleFileKeys.map((fileKey) => [fileKey, readDependencies(fileKey)])
);

const compositionRootImporters = new Map([
  ["desktop/main.cjs", new Set()],
  ["mobile/App.tsx", new Set(["mobile/index.ts"])],
  ["src/extension.ts", new Set()],
  ["src/markdownEditorProvider.ts", new Set(["src/extension.ts"])],
  ["webview/src/App.tsx", new Set(["webview/src/main.tsx"])],
  ["webview/src/draggableBlocksPlugin.tsx", new Set(["webview/src/editor/useRichEditorRuntime.tsx"])]
]);

const pureModelFiles = new Set(
  moduleFileKeys.filter(
    (fileKey) =>
      fileKey.startsWith("shared/") ||
      fileKey.endsWith("Model.ts") ||
      fileKey === "src/markdownMessageParser.ts" ||
      fileKey === "webview/src/blockCommands.ts" ||
      fileKey === "webview/src/desktop/contracts.ts"
  )
);

const violations = [
  ...findUnresolvedModuleViolations(),
  ...findCompositionRootImportViolations(),
  ...findLayerViolations(),
  ...findPureModelViolations(),
  ...findCycles()
].sort();

if (violations.length > 0) {
  console.error("Dependency architecture check failed:\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Dependency architecture check passed for ${moduleFileKeys.length} authored modules.`);
}

function readDependencies(fileKey) {
  const source = readFileSync(path.join(repositoryRoot, fileKey), "utf8");
  const sourceFile = ts.createSourceFile(
    fileKey,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(fileKey)
  );
  const dependencies = [];

  visit(sourceFile);
  return dependencies;

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      addDependency(node.moduleSpecifier, node.getStart(sourceFile));
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      addDependency(node.moduleReference.expression, node.getStart(sourceFile));
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;

      if (isRequire || isDynamicImport) {
        addDependency(node.arguments[0], node.getStart(sourceFile));
      }
    }

    ts.forEachChild(node, visit);
  }

  function addDependency(specifierNode, position) {
    if (!ts.isStringLiteralLike(specifierNode)) {
      return;
    }

    dependencies.push({
      fileKey: resolveInternalModule(fileKey, specifierNode.text),
      line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
      specifier: specifierNode.text
    });
  }
}

function resolveInternalModule(importerFileKey, specifier) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const importerDirectory = path.dirname(path.join(repositoryRoot, importerFileKey));
  const unresolvedPath = path.resolve(importerDirectory, specifier);
  const candidates = path.extname(unresolvedPath)
    ? [unresolvedPath]
    : [
        ...resolutionExtensions.map((extension) => `${unresolvedPath}${extension}`),
        ...resolutionExtensions.map((extension) => path.join(unresolvedPath, `index${extension}`))
      ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const fileKey = toPosixFileKey(path.relative(repositoryRoot, candidate));
    return moduleFileKeySet.has(fileKey) ? fileKey : undefined;
  }

  return undefined;
}

function findUnresolvedModuleViolations() {
  const violations = [];

  for (const [fileKey, dependencies] of dependenciesByFile) {
    for (const dependency of dependencies) {
      const extension = path.extname(dependency.specifier);
      const looksLikeModule = extension === "" || resolutionExtensions.includes(extension);

      if (dependency.specifier.startsWith(".") && looksLikeModule && !dependency.fileKey) {
        violations.push(`${fileKey}:${dependency.line} cannot resolve ${dependency.specifier}`);
      }
    }
  }

  return violations;
}

function findCompositionRootImportViolations() {
  const violations = [];

  for (const [importerFileKey, dependencies] of dependenciesByFile) {
    for (const dependency of dependencies) {
      const allowedImporters = dependency.fileKey
        ? compositionRootImporters.get(dependency.fileKey)
        : undefined;

      if (allowedImporters && !allowedImporters.has(importerFileKey)) {
        violations.push(
          `${importerFileKey}:${dependency.line} imports composition root ${dependency.fileKey}`
        );
      }
    }
  }

  return violations;
}

function findLayerViolations() {
  const violations = [];

  for (const [importerFileKey, dependencies] of dependenciesByFile) {
    for (const dependency of dependencies) {
      if (!dependency.fileKey) {
        continue;
      }

      const reason = getLayerViolation(importerFileKey, dependency.fileKey);
      if (reason) {
        violations.push(`${importerFileKey}:${dependency.line} ${reason} (${dependency.fileKey})`);
      }
    }
  }

  return violations;
}

function getLayerViolation(importerFileKey, dependencyFileKey) {
  if (isProductionFile(importerFileKey) && isTestOrScriptFile(dependencyFileKey)) {
    return "production code imports a test or repository script";
  }

  if (importerFileKey.startsWith("shared/") && !dependencyFileKey.startsWith("shared/")) {
    return "shared contracts import an application layer";
  }

  if (
    importerFileKey.startsWith("src/") &&
    !dependencyFileKey.startsWith("src/") &&
    !dependencyFileKey.startsWith("shared/")
  ) {
    return "the VS Code extension imports another application layer";
  }

  if (importerFileKey.startsWith("desktop/") && /^(mobile|src|webview\/src)\//.test(dependencyFileKey)) {
    return "the desktop main process imports another application layer";
  }

  if (importerFileKey.startsWith("mobile/") && /^(desktop|src|webview\/src)\//.test(dependencyFileKey)) {
    return "the mobile app imports another application layer";
  }

  if (importerFileKey.startsWith("webview/src/") && /^(desktop|mobile|src)\//.test(dependencyFileKey)) {
    return "the webview imports another application layer";
  }

  return undefined;
}

function findPureModelViolations() {
  const violations = [];

  for (const fileKey of pureModelFiles) {
    for (const dependency of dependenciesByFile.get(fileKey) ?? []) {
      if (dependency.fileKey && pureModelFiles.has(dependency.fileKey)) {
        continue;
      }

      if (dependency.fileKey || !dependency.specifier.startsWith(".")) {
        violations.push(
          `${fileKey}:${dependency.line} pure model imports ${dependency.fileKey ?? dependency.specifier}`
        );
      }
    }
  }

  return violations;
}

function findCycles() {
  const violations = [];
  const completed = new Set();
  const activeIndexes = new Map();
  const stack = [];
  const reported = new Set();

  for (const fileKey of moduleFileKeys) {
    visit(fileKey);
  }

  return violations;

  function visit(fileKey) {
    if (completed.has(fileKey)) {
      return;
    }

    const activeIndex = activeIndexes.get(fileKey);
    if (activeIndex !== undefined) {
      const cycle = [...stack.slice(activeIndex), fileKey];
      const signature = canonicalCycleSignature(cycle);

      if (!reported.has(signature)) {
        reported.add(signature);
        violations.push(`dependency cycle: ${cycle.join(" -> ")}`);
      }
      return;
    }

    activeIndexes.set(fileKey, stack.length);
    stack.push(fileKey);

    for (const dependency of dependenciesByFile.get(fileKey) ?? []) {
      if (dependency.fileKey) {
        visit(dependency.fileKey);
      }
    }

    stack.pop();
    activeIndexes.delete(fileKey);
    completed.add(fileKey);
  }
}

function canonicalCycleSignature(cycle) {
  return [...cycle.slice(0, -1)].sort().join("|");
}

function isProductionFile(fileKey) {
  return /^(?:desktop|mobile|shared|src|webview\/src)\//.test(fileKey) && !fileKey.includes("/tests/");
}

function isTestOrScriptFile(fileKey) {
  return fileKey.startsWith("scripts/") || fileKey.includes("/tests/");
}

function getScriptKind(fileKey) {
  if (fileKey.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (fileKey.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (fileKey.endsWith(".ts") || fileKey.endsWith(".d.ts")) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}
