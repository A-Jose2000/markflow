"use strict";

const DESKTOP_CHANNELS = Object.freeze({
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

module.exports = { DESKTOP_CHANNELS };
