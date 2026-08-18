"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const CHANNELS = Object.freeze({
  chooseFolder: "markflow-desktop:choose-folder",
  listDirectory: "markflow-desktop:list-directory",
  createMarkdownFile: "markflow-desktop:create-markdown-file",
  createFolder: "markflow-desktop:create-folder",
  importDroppedFiles: "markflow-desktop:import-dropped-files",
  openMarkdown: "markflow-desktop:open-markdown",
  openMedia: "markflow-desktop:open-media",
  autosaveCurrentMarkdown: "markflow-desktop:autosave-current-markdown",
  beforeClose: "markflow-desktop:before-close",
  completeClose: "markflow-desktop:complete-close"
});

const desktopApi = Object.freeze({
  chooseFolder: () => ipcRenderer.invoke(CHANNELS.chooseFolder),
  listDirectory: (request) => ipcRenderer.invoke(CHANNELS.listDirectory, request),
  createMarkdownFile: (request) => ipcRenderer.invoke(CHANNELS.createMarkdownFile, request),
  createFolder: (request) => ipcRenderer.invoke(CHANNELS.createFolder, request),
  importDroppedFiles: (request, files) => {
    if (!request || typeof request !== "object" || !Array.isArray(files)) {
      throw new TypeError("The dropped-file request is invalid.");
    }

    const sourcePaths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    return ipcRenderer.invoke(CHANNELS.importDroppedFiles, {
      rootId: request.rootId,
      parentRelativePath: request.parentRelativePath,
      sourcePaths
    });
  },
  openMarkdown: (request) => ipcRenderer.invoke(CHANNELS.openMarkdown, request),
  openMedia: (request) => ipcRenderer.invoke(CHANNELS.openMedia, request),
  autosaveCurrentMarkdown: (request) => ipcRenderer.invoke(CHANNELS.autosaveCurrentMarkdown, request),
  onBeforeClose: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("The close listener must be a function.");
    }

    const handleBeforeClose = (_event, payload) => {
      if (
        !payload ||
        typeof payload !== "object" ||
        typeof payload.requestId !== "string"
      ) {
        return;
      }

      listener(Object.freeze({ requestId: payload.requestId }));
    };

    ipcRenderer.on(CHANNELS.beforeClose, handleBeforeClose);

    return () => {
      ipcRenderer.removeListener(CHANNELS.beforeClose, handleBeforeClose);
    };
  },
  completeClose: (result) => ipcRenderer.invoke(CHANNELS.completeClose, result)
});

contextBridge.exposeInMainWorld("markflowDesktop", desktopApi);
