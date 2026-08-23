import type {
  DesktopMarkdownDocument,
  DesktopSaveFailure,
  DesktopSaveResult,
  DesktopSaveSuccess,
  MarkflowDesktopApi
} from "./contracts";

export interface DesktopAutosaveOptions {
  readonly delayMs?: number;
  readonly onSaved?: (result: DesktopSaveSuccess) => void;
  readonly onError?: (error: DesktopSaveFailure | Error) => void;
}

export interface DesktopAutosaveController {
  trackDocument(document: DesktopMarkdownDocument): void;
  schedule(markdown: string): void;
  flush(): Promise<DesktopSaveResult | undefined>;
  hasPendingChanges(): boolean;
  dispose(): void;
}

interface TrackedDocument {
  readonly rootId: string;
  readonly relativePath: string;
  revision: string;
  lastSavedMarkdown: string;
}

interface PendingSave {
  readonly generation: number;
  readonly markdown: string;
}

/**
 * Creates the renderer-side debounce for the main process' current-document
 * autosave endpoint. Call and await flush() before opening another Markdown
 * file, then pass the newly opened document to trackDocument().
 */
export function createDesktopAutosave(
  api: MarkflowDesktopApi,
  options: DesktopAutosaveOptions = {}
): DesktopAutosaveController {
  const configuredDelayMs = options.delayMs ?? 250;
  const delayMs = Number.isFinite(configuredDelayMs) ? Math.max(0, configuredDelayMs) : 250;
  let activeDocument: TrackedDocument | undefined;
  let pendingSave: PendingSave | undefined;
  let timer: number | undefined;
  let generation = 0;
  let saveLoop: Promise<DesktopSaveResult | undefined> | undefined;
  let inFlightSave: PendingSave | undefined;

  function clearTimer(): void {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  }

  function reportError(error: DesktopSaveFailure | Error): void {
    try {
      options.onError?.(error);
    } catch (callbackError) {
      console.error("Markflow Desktop autosave error callback failed.", callbackError);
    }
  }

  async function runSaveLoop(): Promise<DesktopSaveResult | undefined> {
    let lastResult: DesktopSaveResult | undefined;

    while (pendingSave) {
      const save = pendingSave;
      pendingSave = undefined;
      const document = activeDocument;

      if (!document || save.generation !== generation || save.markdown === document.lastSavedMarkdown) {
        continue;
      }

      inFlightSave = save;

      try {
        const result = await api.autosaveCurrentMarkdown({
          rootId: document.rootId,
          relativePath: document.relativePath,
          markdown: save.markdown,
          expectedRevision: document.revision
        });
        lastResult = result;

        if (
          save.generation !== generation ||
          activeDocument?.rootId !== document.rootId ||
          activeDocument.relativePath !== document.relativePath
        ) {
          continue;
        }

        if (!result.ok) {
          pendingSave ??= save;
          reportError(result);
          return result;
        }

        document.revision = result.revision;
        document.lastSavedMarkdown = save.markdown;

        try {
          options.onSaved?.(result);
        } catch (callbackError) {
          console.error("Markflow Desktop autosave success callback failed.", callbackError);
        }
      } catch (error) {
        if (save.generation !== generation) {
          continue;
        }

        const failure: DesktopSaveFailure = {
          ok: false,
          code: "io_error",
          message: "Markflow could not reach the desktop save service."
        };
        pendingSave ??= save;
        console.error("Markflow Desktop autosave IPC failed.", error);
        reportError(failure);
        return failure;
      } finally {
        if (inFlightSave === save) {
          inFlightSave = undefined;
        }
      }
    }

    return lastResult;
  }

  function ensureSaveLoop(): Promise<DesktopSaveResult | undefined> {
    if (saveLoop) {
      return saveLoop;
    }

    const nextLoop = runSaveLoop();
    saveLoop = nextLoop;

    void nextLoop.finally(() => {
      if (saveLoop === nextLoop) {
        saveLoop = undefined;
      }
    });

    return nextLoop;
  }

  return {
    trackDocument(document): void {
      clearTimer();
      generation += 1;
      pendingSave = undefined;
      activeDocument = {
        rootId: document.rootId,
        relativePath: document.relativePath,
        revision: document.revision,
        lastSavedMarkdown: document.markdown
      };
    },

    schedule(markdown): void {
      const document = activeDocument;

      if (
        !document ||
        (markdown === document.lastSavedMarkdown && !pendingSave && !inFlightSave)
      ) {
        return;
      }

      pendingSave = {
        generation,
        markdown
      };
      clearTimer();
      timer = window.setTimeout(() => {
        timer = undefined;
        void ensureSaveLoop().catch((error: unknown) => {
          reportError(error instanceof Error ? error : new Error("Markflow Desktop autosave failed."));
        });
      }, delayMs);
    },

    async flush(): Promise<DesktopSaveResult | undefined> {
      clearTimer();
      let lastResult: DesktopSaveResult | undefined;

      while (saveLoop || pendingSave) {
        const currentLoop = saveLoop ?? ensureSaveLoop();
        lastResult = await currentLoop;

        if (saveLoop === currentLoop) {
          saveLoop = undefined;
        }

        if (lastResult && !lastResult.ok) {
          return lastResult;
        }
      }

      return lastResult;
    },

    hasPendingChanges(): boolean {
      return Boolean(pendingSave || inFlightSave || saveLoop);
    },

    dispose(): void {
      clearTimer();
      generation += 1;
      pendingSave = undefined;
      inFlightSave = undefined;
      activeDocument = undefined;
    }
  };
}
