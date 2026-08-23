import type { MarkflowDesktopApi } from "./contracts";

declare global {
  interface Window {
    readonly markflowDesktop?: MarkflowDesktopApi;
  }
}

export function getDesktopApi(): MarkflowDesktopApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const api = window.markflowDesktop;

  if (
    !api ||
    typeof api.chooseFolder !== "function" ||
    typeof api.listDirectory !== "function" ||
    typeof api.createMarkdownFile !== "function" ||
    typeof api.createFolder !== "function" ||
    typeof api.importDroppedFiles !== "function" ||
    typeof api.moveEntry !== "function" ||
    typeof api.renameEntry !== "function" ||
    typeof api.trashEntry !== "function" ||
    typeof api.openMarkdown !== "function" ||
    typeof api.openMedia !== "function" ||
    typeof api.autosaveCurrentMarkdown !== "function" ||
    typeof api.onBeforeClose !== "function" ||
    typeof api.completeClose !== "function"
  ) {
    return undefined;
  }

  return api;
}

export function requireDesktopApi(): MarkflowDesktopApi {
  const api = getDesktopApi();

  if (!api) {
    throw new Error("The Markflow desktop bridge is not available in this renderer.");
  }

  return api;
}
