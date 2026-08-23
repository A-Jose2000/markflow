import { useEffect, useRef, useState } from "react";

import {
  createDesktopAutosave,
  type DesktopAutosaveController
} from "./autosave";
import type {
  DesktopMarkdownDocument,
  DesktopSaveFailure,
  MarkflowDesktopApi
} from "./contracts";
import { useDesktopCloseHandshake } from "./useDesktopCloseHandshake";
import type { DesktopSaveState } from "./workspaceTypes";

const DEFAULT_AUTOSAVE_DELAY_MS = 250;

export interface DesktopSaveController {
  readonly error?: string;
  readonly saveState: DesktopSaveState;
  clearError(): void;
  disposeDocument(): void;
  fail(error: unknown, fallbackMessage: string): void;
  flushChanges(): Promise<void>;
  reportError(error: Error): void;
  saveNow(): Promise<void>;
  scheduleMarkdown(markdown: string): void;
  setIdle(): void;
  setLoading(): void;
  trackDocument(document: DesktopMarkdownDocument): void;
}

export function useDesktopSaveController(
  api: MarkflowDesktopApi | undefined
): DesktopSaveController {
  const autosaveRef = useRef<DesktopAutosaveController | undefined>(undefined);
  const [saveState, setSaveState] = useState<DesktopSaveState>("idle");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!api) {
      return;
    }

    const autosave = createDesktopAutosave(api, {
      delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
      onSaved: markSaved,
      onError: (autosaveError) => fail(autosaveError, "Save failed.")
    });

    autosaveRef.current = autosave;

    return () => {
      autosave.dispose();

      if (autosaveRef.current === autosave) {
        autosaveRef.current = undefined;
      }
    };
  }, [api]);

  useDesktopCloseHandshake({
    api,
    flush: async () => autosaveRef.current?.flush(),
    hasPendingChanges: () => autosaveRef.current?.hasPendingChanges() ?? false,
    normalizeError: (closeError) =>
      getDesktopErrorMessage(
        closeError instanceof Error
          ? closeError
          : new Error("Markflow could not save pending changes.")
      ),
    onError: (message) => {
      setSaveState("error");
      setError(message);
    },
    onSaved: markSaved,
    onSaving: () => setSaveState("saving")
  });

  function markSaved(): void {
    setSaveState("saved");
    setError(undefined);
  }

  function clearError(): void {
    setError(undefined);
  }

  function disposeDocument(): void {
    autosaveRef.current?.dispose();
  }

  function fail(saveError: unknown, fallbackMessage: string): void {
    setSaveState("error");
    setError(getDesktopErrorMessage(saveError, fallbackMessage));
  }

  async function flushChanges(): Promise<void> {
    const result = await autosaveRef.current?.flush();

    if (result && !result.ok) {
      throw new Error(result.message);
    }
  }

  async function saveNow(): Promise<void> {
    setSaveState("saving");

    try {
      const result = await autosaveRef.current?.flush();

      if (result && !result.ok) {
        setSaveState("error");
        setError(result.message);
        return;
      }

      markSaved();
    } catch (saveError) {
      fail(saveError, "Save failed.");
    }
  }

  function scheduleMarkdown(markdown: string): void {
    if (!api) {
      return;
    }

    setSaveState("saving");
    autosaveRef.current?.schedule(markdown);
  }

  function setIdle(): void {
    setSaveState("idle");
  }

  function setLoading(): void {
    setSaveState("loading");
  }

  function trackDocument(document: DesktopMarkdownDocument): void {
    autosaveRef.current?.trackDocument(document);
    markSaved();
  }

  function reportError(workspaceError: Error): void {
    setError(workspaceError.message);
  }

  return {
    error,
    saveState,
    clearError,
    disposeDocument,
    fail,
    flushChanges,
    reportError,
    saveNow,
    scheduleMarkdown,
    setIdle,
    setLoading,
    trackDocument
  };
}

function getDesktopErrorMessage(error: unknown, fallbackMessage = "Save failed."): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (isDesktopSaveFailure(error)) {
    return error.message;
  }

  return fallbackMessage;
}

function isDesktopSaveFailure(error: unknown): error is DesktopSaveFailure {
  return Boolean(
    error &&
      typeof error === "object" &&
      "ok" in error &&
      error.ok === false &&
      "message" in error &&
      typeof error.message === "string"
  );
}
