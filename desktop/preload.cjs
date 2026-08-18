"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = Object.freeze({
  chooseFolder: "markflow-desktop:choose-folder",
  listDirectory: "markflow-desktop:list-directory",
  openMarkdown: "markflow-desktop:open-markdown",
  openMedia: "markflow-desktop:open-media",
  autosaveCurrentMarkdown: "markflow-desktop:autosave-current-markdown",
  beforeClose: "markflow-desktop:before-close",
  completeClose: "markflow-desktop:complete-close"
});

const desktopApi = Object.freeze({
  chooseFolder: () => ipcRenderer.invoke(CHANNELS.chooseFolder),
  listDirectory: (request) => ipcRenderer.invoke(CHANNELS.listDirectory, request),
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
