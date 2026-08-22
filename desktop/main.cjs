"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { constants: fsConstants, promises: fs } = require("node:fs");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell
} = require("electron");

const APP_SCHEME = "markflow-app";
const MEDIA_SCHEME = "markflow-media";
const MAX_MARKDOWN_BYTES = 32 * 1024 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 32_000;
const MAX_CLOSE_ERROR_LENGTH = 1_000;
const CLOSE_RESPONSE_TIMEOUT_MS = 15_000;
const RENDERER_ROOT_PATH = path.join(__dirname, "dist", "renderer");
const BUNDLED_RENDERER_URL = `${APP_SCHEME}://bundle/index.html`;
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const APP_ICON_PATH = path.join(__dirname, "icon.ico");

const BUNDLED_RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: https: ${MEDIA_SCHEME}:`,
  `media-src 'self' blob: ${MEDIA_SCHEME}:`,
  `frame-src ${MEDIA_SCHEME}:`,
  "object-src 'none'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

const BUNDLED_CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"]
]);

const CHANNELS = Object.freeze({
  chooseFolder: "markflow-desktop:choose-folder",
  listDirectory: "markflow-desktop:list-directory",
  createMarkdownFile: "markflow-desktop:create-markdown-file",
  createFolder: "markflow-desktop:create-folder",
  importDroppedFiles: "markflow-desktop:import-dropped-files",
  moveEntry: "markflow-desktop:move-entry",
  renameEntry: "markflow-desktop:rename-entry",
  trashEntry: "markflow-desktop:trash-entry",
  openMarkdown: "markflow-desktop:open-markdown",
  openMedia: "markflow-desktop:open-media",
  autosaveCurrentMarkdown: "markflow-desktop:autosave-current-markdown",
  beforeClose: "markflow-desktop:before-close",
  completeClose: "markflow-desktop:complete-close"
});

const FILE_TYPES = new Map([
  [".md", { kind: "markdown", mimeType: "text/markdown; charset=utf-8" }],
  [".markdown", { kind: "markdown", mimeType: "text/markdown; charset=utf-8" }],
  [".png", { kind: "image", mimeType: "image/png" }],
  [".jpg", { kind: "image", mimeType: "image/jpeg" }],
  [".jpeg", { kind: "image", mimeType: "image/jpeg" }],
  [".gif", { kind: "image", mimeType: "image/gif" }],
  [".webp", { kind: "image", mimeType: "image/webp" }],
  [".bmp", { kind: "image", mimeType: "image/bmp" }],
  [".avif", { kind: "image", mimeType: "image/avif" }],
  [".ico", { kind: "image", mimeType: "image/x-icon" }],
  [".svg", { kind: "image", mimeType: "image/svg+xml" }],
  [".mp3", { kind: "audio", mimeType: "audio/mpeg" }],
  [".wav", { kind: "audio", mimeType: "audio/wav" }],
  [".ogg", { kind: "audio", mimeType: "audio/ogg" }],
  [".oga", { kind: "audio", mimeType: "audio/ogg" }],
  [".m4a", { kind: "audio", mimeType: "audio/mp4" }],
  [".aac", { kind: "audio", mimeType: "audio/aac" }],
  [".flac", { kind: "audio", mimeType: "audio/flac" }],
  [".opus", { kind: "audio", mimeType: "audio/opus" }],
  [".mp4", { kind: "video", mimeType: "video/mp4" }],
  [".webm", { kind: "video", mimeType: "video/webm" }],
  [".ogv", { kind: "video", mimeType: "video/ogg" }],
  [".mov", { kind: "video", mimeType: "video/quicktime" }],
  [".m4v", { kind: "video", mimeType: "video/x-m4v" }],
  [".pdf", { kind: "pdf", mimeType: "application/pdf" }]
]);

/** @type {Map<string, { id: string, ownerId: number, name: string, displayPath: string, realPath: string }>} */
const rootsById = new Map();

/** @type {Map<number, { rootId: string, relativePath: string, realPath: string, revision: string, eol: "lf" | "crlf", hasBom: boolean }>} */
const activeMarkdownByOwner = new Map();

/** @type {Map<number, { ownerId: number, requestId: string, status: "waiting" | "prompting" | "allowing", timeout: NodeJS.Timeout, window: Electron.BrowserWindow }>} */
const pendingCloseByOwner = new Map();

let mainWindow;
let configuredSession;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      codeCache: true,
      corsEnabled: true
    }
  },
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

app.enableSandbox();

if (process.platform === "win32") {
  app.setAppUserModelId("com.ajose.markflow");
}

registerIpcHandlers();

app.whenReady().then(async () => {
  registerBundledRendererProtocol();
  registerMediaProtocol();
  mainWindow = await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createMainWindow();
    }
  });
}).catch((error) => {
  console.error("Markflow Desktop failed to start.", error);
  dialog.showErrorBox("Markflow could not start", "The desktop application failed during startup.");
  app.quit();
});

app.on("window-all-closed", () => {
  app.quit();
});

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: "#191919",
    autoHideMenuBar: true,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });

  configureRestrictedSession(window.webContents.session);
  attachWebContentsGuards(window);

  window.once("ready-to-show", () => {
    window.show();
  });

  const developmentUrl = getDevelopmentRendererUrl();

  if (developmentUrl) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadURL(BUNDLED_RENDERER_URL);
  }

  return window;
}

function configureRestrictedSession(session) {
  if (configuredSession === session) {
    return;
  }

  configuredSession = session;
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.on("will-download", (event) => event.preventDefault());
}

function attachWebContentsGuards(window) {
  const { webContents } = window;
  const ownerId = webContents.id;

  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) {
      event.preventDefault();
    }
  });

  webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.on("close", (event) => {
    const closeState = pendingCloseByOwner.get(ownerId);

    if (closeState?.status === "allowing") {
      clearPendingClose(ownerId);
      return;
    }

    event.preventDefault();

    if (!closeState) {
      beginCloseHandshake(window, ownerId);
    }
  });
  webContents.on("render-process-gone", () => {
    const closeState = pendingCloseByOwner.get(ownerId);

    if (closeState?.status === "waiting") {
      void resolveCloseHandshake(closeState, {
        requestId: closeState.requestId,
        ok: false,
        message: "The editor stopped responding before its pending changes could be saved."
      });
    }
  });
  webContents.once("destroyed", () => clearOwnerState(ownerId));
}

function registerIpcHandlers() {
  registerIpcHandler(CHANNELS.chooseFolder, chooseFolder);
  registerIpcHandler(CHANNELS.listDirectory, listDirectory);
  registerIpcHandler(CHANNELS.createMarkdownFile, createMarkdownFile);
  registerIpcHandler(CHANNELS.createFolder, createFolder);
  registerIpcHandler(CHANNELS.importDroppedFiles, importDroppedFiles);
  registerIpcHandler(CHANNELS.moveEntry, moveEntry);
  registerIpcHandler(CHANNELS.renameEntry, renameEntry);
  registerIpcHandler(CHANNELS.trashEntry, trashEntry);
  registerIpcHandler(CHANNELS.openMarkdown, openMarkdown);
  registerIpcHandler(CHANNELS.openMedia, openMedia);
  registerIpcHandler(CHANNELS.autosaveCurrentMarkdown, autosaveCurrentMarkdown);
  registerIpcHandler(CHANNELS.completeClose, completeClose);
}

function registerIpcHandler(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    assertTrustedSender(event);

    try {
      return await handler(event, payload);
    } catch (error) {
      console.error(`Markflow Desktop IPC failure on ${channel}.`, error);

      if (error instanceof PublicError) {
        throw new Error(`${error.code}: ${error.message}`);
      }

      throw new Error("IO_ERROR: Markflow could not complete that filesystem operation.");
    }
  });
}

function beginCloseHandshake(window, ownerId) {
  const requestId = randomUUID();
  const closeState = {
    ownerId,
    requestId,
    status: "waiting",
    timeout: setTimeout(() => {
      const currentState = pendingCloseByOwner.get(ownerId);

      if (currentState === closeState && currentState.status === "waiting") {
        void resolveCloseHandshake(currentState, {
          requestId,
          ok: false,
          message: "Markflow timed out while waiting for pending changes to save."
        });
      }
    }, CLOSE_RESPONSE_TIMEOUT_MS),
    window
  };

  pendingCloseByOwner.set(ownerId, closeState);

  try {
    window.webContents.send(CHANNELS.beforeClose, { requestId });
  } catch (error) {
    console.error("Markflow Desktop could not request a final autosave.", error);
    void resolveCloseHandshake(closeState, {
      requestId,
      ok: false,
      message: "The editor could not be reached to save its pending changes."
    });
  }
}

async function completeClose(event, payload) {
  const result = readCloseResult(payload);
  const closeState = pendingCloseByOwner.get(event.sender.id);

  if (
    !closeState ||
    closeState.status !== "waiting" ||
    closeState.requestId !== result.requestId
  ) {
    throw new PublicError("INVALID_CLOSE_REQUEST", "That close request is no longer active.");
  }

  await resolveCloseHandshake(closeState, result);
}

async function resolveCloseHandshake(closeState, result) {
  if (
    pendingCloseByOwner.get(closeState.ownerId) !== closeState ||
    closeState.status !== "waiting"
  ) {
    return;
  }

  clearTimeout(closeState.timeout);

  if (result.ok) {
    closeState.status = "allowing";
    closeWindowAfterIpcReply(closeState);
    return;
  }

  closeState.status = "prompting";

  if (closeState.window.isDestroyed()) {
    clearPendingClose(closeState.ownerId);
    return;
  }

  let response;

  try {
    response = await dialog.showMessageBox(closeState.window, {
      type: "warning",
      title: "Unsaved changes",
      message: "Markflow could not save your latest changes.",
      detail: result.message,
      buttons: ["Keep editing", "Quit without saving"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
  } catch (error) {
    console.error("Markflow Desktop could not show the unsaved-changes dialog.", error);
    clearPendingClose(closeState.ownerId);
    return;
  }

  if (pendingCloseByOwner.get(closeState.ownerId) !== closeState) {
    return;
  }

  if (response.response === 1) {
    closeState.status = "allowing";
    closeWindowAfterIpcReply(closeState);
    return;
  }

  clearPendingClose(closeState.ownerId);

  if (!closeState.window.isDestroyed()) {
    closeState.window.show();
    closeState.window.focus();
  }
}

function closeWindowAfterIpcReply(closeState) {
  setImmediate(() => {
    if (
      pendingCloseByOwner.get(closeState.ownerId) === closeState &&
      closeState.status === "allowing" &&
      !closeState.window.isDestroyed()
    ) {
      closeState.window.close();
    }
  });
}

async function chooseFolder(event) {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options = {
    title: "Open a folder in Markflow",
    buttonLabel: "Open folder",
    properties: ["openDirectory", "dontAddToRecent"]
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  const realPath = await fs.realpath(selectedPath);
  const stats = await fs.stat(realPath);

  if (!stats.isDirectory()) {
    throw new PublicError("NOT_A_DIRECTORY", "The selected item is not a folder.");
  }

  const ownerId = event.sender.id;
  activeMarkdownByOwner.delete(ownerId);
  clearOwnerRoots(ownerId);

  const root = {
    id: randomUUID(),
    ownerId,
    name: path.basename(realPath) || realPath,
    displayPath: path.resolve(selectedPath),
    realPath
  };

  rootsById.set(root.id, root);

  return toPublicRoot(root);
}

async function listDirectory(event, payload) {
  const request = readPathRequest(payload);
  const root = getOwnedRoot(event.sender.id, request.rootId);
  const directoryPath = await resolveExistingPath(root, request.relativePath);
  const directoryStats = await fs.stat(directoryPath);

  if (!directoryStats.isDirectory()) {
    throw new PublicError("NOT_A_DIRECTORY", "That explorer item is not a folder.");
  }

  const directoryEntries = await fs.readdir(directoryPath, { withFileTypes: true });
  const visibleEntries = [];

  for (const entry of directoryEntries) {
    // Junctions and symbolic links are deliberately omitted. This prevents cycles
    // and ensures every visible node has one canonical location below the root.
    if (entry.isSymbolicLink()) {
      continue;
    }

    const relativePath = joinApiPath(request.relativePath, entry.name);

    if (entry.isDirectory()) {
      visibleEntries.push({
        name: entry.name,
        relativePath,
        kind: "directory"
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileType = classifyFile(entry.name);

    if (!fileType) {
      continue;
    }

    visibleEntries.push({
      name: entry.name,
      relativePath,
      kind: fileType.kind,
      mimeType: fileType.mimeType
    });
  }

  visibleEntries.sort((left, right) => {
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
  });

  return visibleEntries;
}

async function createMarkdownFile(event, payload) {
  const request = readCreateEntryRequest(payload);
  const root = getOwnedRoot(event.sender.id, request.rootId);
  const parentPath = await resolveExistingPath(root, request.parentRelativePath);
  const parentStats = await fs.stat(parentPath);

  if (!parentStats.isDirectory()) {
    throw new PublicError("NOT_A_DIRECTORY", "Choose a folder before creating a Markdown file.");
  }

  const name = normalizeNewMarkdownName(request.name);
  const relativePath = joinApiPath(request.parentRelativePath, name);
  const candidatePath = path.resolve(parentPath, name);
  assertContained(root.realPath, candidatePath);

  try {
    await fs.writeFile(candidatePath, "", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (hasFileSystemErrorCode(error, "EEXIST")) {
      throw new PublicError("ALREADY_EXISTS", "A file or folder with that name already exists.");
    }

    throw error;
  }

  const realPath = await fs.realpath(candidatePath);
  assertContained(root.realPath, realPath);

  return {
    kind: "markdown",
    name,
    relativePath,
    mimeType: FILE_TYPES.get(".md").mimeType
  };
}

async function createFolder(event, payload) {
  const request = readCreateEntryRequest(payload);
  const root = getOwnedRoot(event.sender.id, request.rootId);
  const parentPath = await resolveExistingPath(root, request.parentRelativePath);
  const parentStats = await fs.stat(parentPath);

  if (!parentStats.isDirectory()) {
    throw new PublicError("NOT_A_DIRECTORY", "Choose a folder before creating another folder.");
  }

  const name = normalizeNewEntryName(request.name);
  const relativePath = joinApiPath(request.parentRelativePath, name);
  const candidatePath = path.resolve(parentPath, name);
  assertContained(root.realPath, candidatePath);

  try {
    await fs.mkdir(candidatePath);
  } catch (error) {
    if (hasFileSystemErrorCode(error, "EEXIST")) {
      throw new PublicError("ALREADY_EXISTS", "A file or folder with that name already exists.");
    }

    throw error;
  }

  const realPath = await fs.realpath(candidatePath);
  assertContained(root.realPath, realPath);

  return {
    kind: "directory",
    name,
    relativePath
  };
}

async function importDroppedFiles(event, payload) {
  const request = readImportFilesRequest(payload);
  const root = getOwnedRoot(event.sender.id, request.rootId);
  const parentPath = await resolveExistingPath(root, request.parentRelativePath);
  const parentStats = await fs.stat(parentPath);

  if (!parentStats.isDirectory()) {
    throw new PublicError("NOT_A_DIRECTORY", "Drop files onto an existing folder.");
  }

  const sources = [];
  const rejected = [];

  for (const sourcePath of request.sourcePaths) {
    const sourceStats = await fs.stat(sourcePath).catch(() => undefined);
    const sourceName = path.basename(sourcePath);
    const fileType = classifyFile(sourceName);

    if (!sourceStats?.isFile() || !fileType) {
      rejected.push(sourceName || "Unsupported item");
      continue;
    }

    sources.push({ sourcePath, sourceName, fileType });
  }

  if (sources.length === 0) {
    throw new PublicError(
      "UNSUPPORTED_FILE",
      "Drop Markdown, image, audio, video, or PDF files into the Explorer."
    );
  }

  const imported = [];

  for (const source of sources) {
    const copied = await copyDroppedFile(root, parentPath, request.parentRelativePath, source);
    imported.push(copied);
  }

  return { imported, rejected };
}

async function copyDroppedFile(root, parentPath, parentRelativePath, source) {
  const parsedName = path.parse(normalizeNewEntryName(source.sourceName));

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const name = attempt === 0 ? parsedName.base : `${parsedName.name} (${attempt})${parsedName.ext}`;
    const relativePath = joinApiPath(parentRelativePath, name);
    const candidatePath = path.resolve(parentPath, name);
    assertContained(root.realPath, candidatePath);

    try {
      await fs.copyFile(source.sourcePath, candidatePath, fsConstants.COPYFILE_EXCL);
      const realPath = await fs.realpath(candidatePath);
      assertContained(root.realPath, realPath);

      return {
        kind: source.fileType.kind,
        name,
        relativePath,
        mimeType: source.fileType.mimeType
      };
    } catch (error) {
      if (hasFileSystemErrorCode(error, "EEXIST")) {
        continue;
      }

      await fs.unlink(candidatePath).catch(() => undefined);
      throw error;
    }
  }

  throw new PublicError("ALREADY_EXISTS", `Markflow could not find an available name for ${source.sourceName}.`);
}

async function moveEntry(event, payload) {
  const request = readMoveEntryRequest(payload);
  const root = getOwnedRoot(event.sender.id, request.rootId);
  const sourcePath = await resolveExistingPath(root, request.sourceRelativePath);
  const sourceEntry = await readExplorerEntry(sourcePath, request.sourceRelativePath);
  const destinationParentPath = await resolveExistingPath(root, request.destinationParentRelativePath);
  const destinationParentStats = await fs.stat(destinationParentPath);

  if (!destinationParentStats.isDirectory()) {
    throw new PublicError("NOT_A_DIRECTORY", "Move items into an existing folder.");
  }

  if (sourceEntry.kind === "directory" && isPathWithinOrEqual(sourcePath, destinationParentPath)) {
    throw new PublicError("INVALID_DESTINATION", "A folder cannot be moved into itself or one of its subfolders.");
  }

  const nextRelativePath = joinApiPath(request.destinationParentRelativePath, sourceEntry.name);
  const destinationPath = path.resolve(destinationParentPath, sourceEntry.name);
  assertContained(root.realPath, destinationPath);

  if (sameFileSystemPath(sourcePath, destinationPath)) {
    return {
      changed: false,
      previousRelativePath: request.sourceRelativePath,
      entry: sourceEntry
    };
  }

  await assertDestinationAvailable(destinationPath, sourcePath);

  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (hasFileSystemErrorCode(error, "EEXIST") || hasFileSystemErrorCode(error, "ENOTEMPTY")) {
      throw new PublicError("ALREADY_EXISTS", "A file or folder with that name already exists there.");
    }

    throw error;
  }

  const realDestinationPath = await fs.realpath(destinationPath);
  assertContained(root.realPath, realDestinationPath);
  await updateActiveMarkdownAfterRelocation(
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
  const root = getOwnedRoot(event.sender.id, request.rootId);
  const sourcePath = await resolveExistingPath(root, request.relativePath);
  const sourceEntry = await readExplorerEntry(sourcePath, request.relativePath);
  const parentRelativePath = apiParentPath(request.relativePath);
  const parentPath = path.dirname(sourcePath);
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
  const destinationPath = path.resolve(parentPath, name);
  assertContained(root.realPath, destinationPath);

  if (sourceEntry.name === name) {
    return {
      changed: false,
      previousRelativePath: request.relativePath,
      entry: sourceEntry
    };
  }

  await assertDestinationAvailable(destinationPath, sourcePath);

  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (hasFileSystemErrorCode(error, "EEXIST") || hasFileSystemErrorCode(error, "ENOTEMPTY")) {
      throw new PublicError("ALREADY_EXISTS", "A file or folder with that name already exists.");
    }

    throw error;
  }

  const realDestinationPath = await fs.realpath(destinationPath);
  assertContained(root.realPath, realDestinationPath);
  await updateActiveMarkdownAfterRelocation(
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
    throw new PublicError("INVALID_REQUEST", "The open Explorer folder cannot be deleted from Markflow.");
  }

  const root = getOwnedRoot(event.sender.id, request.rootId);
  const sourcePath = await resolveExistingPath(root, request.relativePath);
  const entry = await readExplorerEntry(sourcePath, request.relativePath);

  await shell.trashItem(sourcePath);
  clearActiveMarkdownInside(event.sender.id, sourcePath);

  return {
    relativePath: request.relativePath,
    name: entry.name
  };
}

async function readExplorerEntry(realPath, relativePath) {
  const stats = await fs.stat(realPath);
  const name = path.basename(realPath);

  if (stats.isDirectory()) {
    return {
      kind: "directory",
      name,
      relativePath
    };
  }

  if (!stats.isFile()) {
    throw new PublicError("NOT_A_FILE", "That Explorer item is not a regular file or folder.");
  }

  const fileType = classifyFile(name);

  if (!fileType) {
    throw new PublicError("UNSUPPORTED_FILE", "That file type is not supported by Markflow.");
  }

  return {
    kind: fileType.kind,
    name,
    relativePath,
    mimeType: fileType.mimeType
  };
}

async function assertDestinationAvailable(destinationPath, sourcePath) {
  try {
    const existingPath = await fs.realpath(destinationPath);

    if (!sameFileSystemPath(existingPath, sourcePath)) {
      throw new PublicError("ALREADY_EXISTS", "A file or folder with that name already exists there.");
    }
  } catch (error) {
    if (hasFileSystemErrorCode(error, "ENOENT")) {
      return;
    }

    throw error;
  }
}

async function updateActiveMarkdownAfterRelocation(ownerId, root, sourcePath, destinationPath) {
  const active = activeMarkdownByOwner.get(ownerId);

  if (!active || !isPathWithinOrEqual(sourcePath, active.realPath)) {
    return;
  }

  const suffix = path.relative(sourcePath, active.realPath);
  const nextPath = path.resolve(destinationPath, suffix);
  assertContained(root.realPath, nextPath);
  active.realPath = await fs.realpath(nextPath);
  active.relativePath = toApiRelativePath(path.relative(root.realPath, active.realPath));
}

function clearActiveMarkdownInside(ownerId, sourcePath) {
  const active = activeMarkdownByOwner.get(ownerId);

  if (active && isPathWithinOrEqual(sourcePath, active.realPath)) {
    activeMarkdownByOwner.delete(ownerId);
  }
}

async function openMarkdown(event, payload) {
  const request = readPathRequest(payload);
  const root = getOwnedRoot(event.sender.id, request.rootId);
  const fileType = classifyFile(request.relativePath);

  if (fileType?.kind !== "markdown") {
    throw new PublicError("UNSUPPORTED_FILE", "Only Markdown files can be opened in the editor.");
  }

  const realPath = await resolveExistingPath(root, request.relativePath);
  const openedFile = await readMarkdownFile(realPath);
  const normalizedRelativePath = toApiRelativePath(path.relative(root.realPath, realPath));

  activeMarkdownByOwner.set(event.sender.id, {
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
  const root = getOwnedRoot(event.sender.id, request.rootId);
  const fileType = classifyFile(request.relativePath);

  if (!fileType || fileType.kind === "markdown") {
    throw new PublicError("UNSUPPORTED_FILE", "That file does not have an in-app media preview.");
  }

  const realPath = await resolveExistingPath(root, request.relativePath);
  const stats = await fs.stat(realPath);

  if (!stats.isFile()) {
    throw new PublicError("NOT_A_FILE", "That explorer item is not a file.");
  }

  const normalizedRelativePath = toApiRelativePath(path.relative(root.realPath, realPath));
  activeMarkdownByOwner.delete(event.sender.id);

  return {
    rootId: root.id,
    relativePath: normalizedRelativePath,
    name: path.basename(realPath),
    displayPath: path.join(root.displayPath, ...normalizedRelativePath.split("/")),
    kind: fileType.kind,
    mimeType: fileType.mimeType,
    url: createMediaUrl(root.id, normalizedRelativePath)
  };
}

async function autosaveCurrentMarkdown(event, payload) {
  let request;

  try {
    request = readAutosaveRequest(payload);
  } catch (error) {
    return saveFailure("invalid_markdown", publicMessage(error, "The Markdown update is invalid."));
  }

  const active = activeMarkdownByOwner.get(event.sender.id);

  if (!active) {
    return saveFailure("no_current_document", "Open a Markdown file before saving.");
  }

  if (active.rootId !== request.rootId || active.relativePath !== request.relativePath) {
    return saveFailure("stale_document", "The requested file is no longer the active Markdown document.");
  }

  const root = rootsById.get(active.rootId);

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

    const beforeStats = await fs.stat(realPath, { bigint: true });
    const diskRevision = revisionFromStats(beforeStats);

    if (diskRevision !== active.revision) {
      return saveFailure("conflict", "The document was changed by another application.", diskRevision);
    }

    const encodedMarkdown = encodeMarkdown(request.markdown, active.eol, active.hasBom);

    if (encodedMarkdown.byteLength > MAX_MARKDOWN_BYTES) {
      return saveFailure("invalid_markdown", "This Markdown document is too large to autosave.");
    }

    await writeFileAtomically(realPath, encodedMarkdown, Number(beforeStats.mode));

    const afterStats = await fs.stat(realPath, { bigint: true });
    const revision = revisionFromStats(afterStats);
    active.realPath = await fs.realpath(realPath);
    active.revision = revision;

    return {
      ok: true,
      revision,
      savedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error("Markflow Desktop could not autosave the active Markdown file.", error);
    return saveFailure("io_error", "Markflow could not save the current Markdown file.");
  }
}

function registerBundledRendererProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);

      if (
        url.hostname !== "bundle" ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== "" ||
        (request.method !== "GET" && request.method !== "HEAD")
      ) {
        return protocolErrorResponse(404, "Application resource unavailable");
      }

      const relativePath = decodeMediaPath(url.pathname);
      const candidatePath = path.resolve(RENDERER_ROOT_PATH, ...readRelativePath(relativePath));
      assertContained(RENDERER_ROOT_PATH, candidatePath);

      const [realRendererRoot, realResourcePath] = await Promise.all([
        fs.realpath(RENDERER_ROOT_PATH),
        fs.realpath(candidatePath)
      ]);
      assertContained(realRendererRoot, realResourcePath);

      const stats = await fs.stat(realResourcePath);

      if (!stats.isFile()) {
        return protocolErrorResponse(404, "Application resource unavailable");
      }

      const contentType = BUNDLED_CONTENT_TYPES.get(path.extname(realResourcePath).toLowerCase());

      if (!contentType) {
        return protocolErrorResponse(415, "Unsupported application resource");
      }

      const response = await net.fetch(pathToFileURL(realResourcePath).toString(), {
        method: request.method,
        headers: request.headers,
        bypassCustomProtocolHandlers: true
      });
      const headers = new Headers(response.headers);
      headers.set("Content-Type", contentType);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cache-Control", "no-store");

      if (path.extname(realResourcePath).toLowerCase() === ".html") {
        headers.set("Content-Security-Policy", BUNDLED_RENDERER_CSP);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.error("Markflow Desktop application protocol rejected a request.", error);
      return protocolErrorResponse(404, "Application resource unavailable");
    }
  });
}

function registerMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const root = rootsById.get(url.hostname);

      if (!root) {
        return protocolErrorResponse(404, "Folder unavailable");
      }

      const relativePath = decodeMediaPath(url.pathname);
      const fileType = classifyFile(relativePath);

      if (!fileType || fileType.kind === "markdown") {
        return protocolErrorResponse(415, "Unsupported media type");
      }

      const realPath = await resolveExistingPath(root, relativePath);
      const stats = await fs.stat(realPath);

      if (!stats.isFile()) {
        return protocolErrorResponse(404, "Media unavailable");
      }

      const response = await net.fetch(pathToFileURL(realPath).toString(), {
        headers: request.headers,
        bypassCustomProtocolHandlers: true
      });
      const headers = new Headers(response.headers);
      headers.set("Content-Type", fileType.mimeType);
      headers.set("Content-Disposition", "inline");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cache-Control", "no-store");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.error("Markflow Desktop media protocol rejected a request.", error);
      return protocolErrorResponse(404, "Media unavailable");
    }
  });
}

async function readMarkdownFile(realPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const beforeStats = await fs.stat(realPath, { bigint: true });

    if (!beforeStats.isFile()) {
      throw new PublicError("NOT_A_FILE", "That explorer item is not a file.");
    }

    if (beforeStats.size > BigInt(MAX_MARKDOWN_BYTES)) {
      throw new PublicError("FILE_TOO_LARGE", "This Markdown file is too large to edit safely.");
    }

    const contents = await fs.readFile(realPath);
    const afterStats = await fs.stat(realPath, { bigint: true });

    if (revisionFromStats(beforeStats) !== revisionFromStats(afterStats) && attempt === 0) {
      continue;
    }

    if (revisionFromStats(beforeStats) !== revisionFromStats(afterStats)) {
      throw new PublicError("FILE_CHANGED", "The Markdown file kept changing while it was being opened.");
    }

    if (contents.includes(0)) {
      throw new PublicError("BINARY_FILE", "This file appears to contain binary data.");
    }

    const hasBom = contents.length >= 3 && contents[0] === 0xef && contents[1] === 0xbb && contents[2] === 0xbf;
    const body = hasBom ? contents.subarray(3) : contents;
    let markdown;

    try {
      markdown = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      throw new PublicError("INVALID_ENCODING", "Markflow currently supports UTF-8 Markdown files.");
    }

    const eol = detectEol(markdown);

    return {
      markdown: markdown.replace(/\r\n?/g, "\n"),
      revision: revisionFromStats(afterStats),
      eol,
      hasBom
    };
  }

  throw new PublicError("FILE_CHANGED", "The Markdown file could not be read consistently.");
}

async function writeFileAtomically(targetPath, contents, mode) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    await fs.writeFile(temporaryPath, contents, {
      flag: "wx",
      mode
    });

    const handle = await fs.open(temporaryPath, "r+");

    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

async function resolveExistingPath(root, relativePath) {
  const pathSegments = readRelativePath(relativePath);
  const candidatePath = path.resolve(root.realPath, ...pathSegments);
  assertContained(root.realPath, candidatePath);

  let realPath;

  try {
    realPath = await fs.realpath(candidatePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
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
    return {
      requestId,
      ok: true
    };
  }

  if (payload.ok !== false || typeof payload.message !== "string") {
    throw new PublicError("INVALID_CLOSE_REQUEST", "The close response is invalid.");
  }

  const message = payload.message.trim();

  if (message.length === 0 || message.length > MAX_CLOSE_ERROR_LENGTH || message.includes("\0")) {
    throw new PublicError("INVALID_CLOSE_REQUEST", "The close failure message is invalid.");
  }

  return {
    requestId,
    ok: false,
    message
  };
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

function classifyFile(fileName) {
  return FILE_TYPES.get(path.extname(fileName).toLowerCase());
}

function getOwnedRoot(ownerId, rootId) {
  const root = rootsById.get(rootId);

  if (!root || root.ownerId !== ownerId) {
    throw new PublicError("FOLDER_UNAVAILABLE", "That folder is no longer open in this window.");
  }

  return root;
}

function toPublicRoot(root) {
  return {
    id: root.id,
    name: root.name,
    displayPath: root.displayPath
  };
}

function createMediaUrl(rootId, relativePath) {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `${MEDIA_SCHEME}://${rootId}/${encodedPath}`;
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

function detectEol(markdown) {
  let crlfCount = 0;
  let lfCount = 0;

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "\n") {
      continue;
    }

    if (index > 0 && markdown[index - 1] === "\r") {
      crlfCount += 1;
    } else {
      lfCount += 1;
    }
  }

  return crlfCount > lfCount ? "crlf" : "lf";
}

function encodeMarkdown(markdown, eol, hasBom) {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const withOriginalEol = eol === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
  const body = Buffer.from(withOriginalEol, "utf8");

  return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

function revisionFromStats(stats) {
  const mtime = "mtimeNs" in stats ? stats.mtimeNs : BigInt(Math.trunc(Number(stats.mtimeMs) * 1_000_000));
  return `${stats.dev}:${stats.ino}:${stats.size}:${mtime}`;
}

function saveFailure(code, message, diskRevision) {
  return {
    ok: false,
    code,
    message,
    ...(diskRevision ? { diskRevision } : {})
  };
}

function protocolErrorResponse(status, message) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function assertTrustedSender(event) {
  const frame = event.senderFrame;

  if (!frame || frame !== event.sender.mainFrame || !isTrustedRendererUrl(frame.url)) {
    throw new PublicError("UNTRUSTED_SENDER", "The desktop request did not come from the Markflow application.");
  }
}

function isTrustedRendererUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (url.protocol === `${APP_SCHEME}:`) {
      return (
        url.hostname === "bundle" &&
        url.username === "" &&
        url.password === "" &&
        url.port === "" &&
        url.pathname === "/index.html" &&
        url.search === ""
      );
    }

    const developmentUrl = getDevelopmentRendererUrl();
    return Boolean(developmentUrl && url.origin === new URL(developmentUrl).origin);
  } catch {
    return false;
  }
}

function getDevelopmentRendererUrl() {
  if (app.isPackaged) {
    return undefined;
  }

  const rawUrl = process.env.MARKFLOW_DESKTOP_DEV_SERVER_URL;

  if (!rawUrl) {
    return undefined;
  }

  const url = new URL(rawUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

  if ((url.protocol !== "http:" && url.protocol !== "https:") || !localHosts.has(url.hostname)) {
    throw new Error("MARKFLOW_DESKTOP_DEV_SERVER_URL must use HTTP(S) on localhost.");
  }

  return url.toString();
}

function clearOwnerRoots(ownerId) {
  for (const [rootId, root] of rootsById) {
    if (root.ownerId === ownerId) {
      rootsById.delete(rootId);
    }
  }
}

function clearOwnerState(ownerId) {
  clearPendingClose(ownerId);
  activeMarkdownByOwner.delete(ownerId);
  clearOwnerRoots(ownerId);
}

function clearPendingClose(ownerId) {
  const closeState = pendingCloseByOwner.get(ownerId);

  if (closeState) {
    clearTimeout(closeState.timeout);
    pendingCloseByOwner.delete(ownerId);
  }
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicMessage(error, fallback) {
  return error instanceof PublicError ? error.message : fallback;
}

function hasFileSystemErrorCode(error, code) {
  return Boolean(error && typeof error === "object" && error.code === code);
}

class PublicError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicError";
    this.code = code;
  }
}
