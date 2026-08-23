"use strict";

const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell
} = require("electron");
const { DESKTOP_CHANNELS: CHANNELS } = require("./channels.cjs");
const { PublicError } = require("./publicErrors.cjs");
const { createCloseCoordinator } = require("./main-process/closeCoordinator.cjs");
const {
  APP_SCHEME,
  MEDIA_SCHEME,
  registerProtocolHandlers
} = require("./main-process/protocolHandlers.cjs");
const { createWorkspaceService } = require("./main-process/workspaceService.cjs");

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

const workspaceService = createWorkspaceService({
  fromWebContents: (webContents) => BrowserWindow.fromWebContents(webContents),
  showOpenDialog: (parentWindow, options) => parentWindow
    ? dialog.showOpenDialog(parentWindow, options)
    : dialog.showOpenDialog(options),
  trashItem: (targetPath) => shell.trashItem(targetPath),
  mediaScheme: MEDIA_SCHEME
});
const closeCoordinator = createCloseCoordinator({
  beforeCloseChannel: CHANNELS.beforeClose,
  dialog
});

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
  registerProtocolHandlers({
    protocol,
    netFetch: (url, options) => net.fetch(url, options),
    rendererRootPath: RENDERER_ROOT_PATH,
    rendererContentSecurityPolicy: BUNDLED_RENDERER_CSP,
    getRootById: workspaceService.getRootById
  });
  mainWindow = await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createMainWindow();
    }
  });
}).catch((error) => {
  console.error("Markflow Desktop failed to start.", error);
  dialog.showErrorBox(
    "Markflow could not start",
    "The desktop application failed during startup."
  );
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
  window.once("ready-to-show", () => window.show());

  const developmentUrl = getDevelopmentRendererUrl();
  await window.loadURL(developmentUrl || BUNDLED_RENDERER_URL);
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
  window.on("close", (event) => closeCoordinator.handleWindowClose(window, event));
  webContents.on("render-process-gone", () => closeCoordinator.handleRendererGone(ownerId));
  webContents.once("destroyed", () => {
    closeCoordinator.clearOwner(ownerId);
    workspaceService.clearOwner(ownerId);
  });
}

function registerIpcHandlers() {
  const handlers = workspaceService.handlers;
  registerIpcHandler(CHANNELS.chooseFolder, handlers.chooseFolder);
  registerIpcHandler(CHANNELS.listDirectory, handlers.listDirectory);
  registerIpcHandler(CHANNELS.createMarkdownFile, handlers.createMarkdownFile);
  registerIpcHandler(CHANNELS.createFolder, handlers.createFolder);
  registerIpcHandler(CHANNELS.importDroppedFiles, handlers.importDroppedFiles);
  registerIpcHandler(CHANNELS.moveEntry, handlers.moveEntry);
  registerIpcHandler(CHANNELS.renameEntry, handlers.renameEntry);
  registerIpcHandler(CHANNELS.trashEntry, handlers.trashEntry);
  registerIpcHandler(CHANNELS.openMarkdown, handlers.openMarkdown);
  registerIpcHandler(CHANNELS.openMedia, handlers.openMedia);
  registerIpcHandler(CHANNELS.autosaveCurrentMarkdown, handlers.autosaveCurrentMarkdown);
  registerIpcHandler(CHANNELS.completeClose, closeCoordinator.complete);
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

function assertTrustedSender(event) {
  const frame = event.senderFrame;

  if (!frame || frame !== event.sender.mainFrame || !isTrustedRendererUrl(frame.url)) {
    throw new PublicError(
      "UNTRUSTED_SENDER",
      "The desktop request did not come from the Markflow application."
    );
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
