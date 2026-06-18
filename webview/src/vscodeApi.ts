import type { WebviewToExtensionMessage } from "./markdownMessages";

interface VscodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
  getState<TState = unknown>(): TState | undefined;
  setState<TState = unknown>(state: TState): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VscodeApi;
  }
}

let api: VscodeApi | undefined;

export function getVsCodeApi(): VscodeApi {
  if (api) {
    return api;
  }

  if (typeof window.acquireVsCodeApi === "function") {
    api = window.acquireVsCodeApi();
    return api;
  }

  api = {
    postMessage: () => undefined,
    getState: () => undefined,
    setState: () => undefined
  };

  return api;
}
