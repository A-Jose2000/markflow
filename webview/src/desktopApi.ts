export type DesktopMediaKind = "image" | "audio" | "video" | "pdf";
export type DesktopFileKind = "markdown" | DesktopMediaKind;

export interface DesktopFolderRoot {
  readonly id: string;
  readonly name: string;
  readonly displayPath: string;
}

export interface DesktopDirectoryEntry {
  readonly kind: "directory";
  readonly name: string;
  readonly relativePath: string;
}

export interface DesktopFileEntry {
  readonly kind: DesktopFileKind;
  readonly name: string;
  readonly relativePath: string;
  readonly mimeType: string;
}

export type DesktopFolderEntry = DesktopDirectoryEntry | DesktopFileEntry;

export interface DesktopFileTarget {
  readonly rootId: string;
  readonly name: string;
  readonly relativePath: string;
  readonly kind: DesktopFileKind;
  readonly mimeType: string;
}

export interface DesktopPathRequest {
  readonly rootId: string;
  readonly relativePath: string;
}

export interface DesktopCreateEntryRequest {
  readonly rootId: string;
  readonly parentRelativePath: string;
  readonly name: string;
}

export interface DesktopDroppedFilesRequest {
  readonly rootId: string;
  readonly parentRelativePath: string;
}

export interface DesktopImportResult {
  readonly imported: DesktopFileEntry[];
  readonly rejected: string[];
}

export interface DesktopMarkdownDocument {
  readonly rootId: string;
  readonly relativePath: string;
  readonly name: string;
  readonly displayPath: string;
  readonly markdown: string;
  readonly revision: string;
  readonly eol: "lf" | "crlf";
  readonly hasBom: boolean;
}

export interface DesktopMediaDocument {
  readonly rootId: string;
  readonly relativePath: string;
  readonly name: string;
  readonly displayPath: string;
  readonly kind: DesktopMediaKind;
  readonly mimeType: string;
  readonly url: string;
}

export interface DesktopAutosaveRequest extends DesktopPathRequest {
  readonly markdown: string;
  readonly expectedRevision: string;
}

export interface DesktopSaveSuccess {
  readonly ok: true;
  readonly revision: string;
  readonly savedAt: string;
}

export interface DesktopSaveFailure {
  readonly ok: false;
  readonly code:
    | "no_current_document"
    | "stale_document"
    | "conflict"
    | "invalid_markdown"
    | "io_error";
  readonly message: string;
  readonly diskRevision?: string;
}

export type DesktopSaveResult = DesktopSaveSuccess | DesktopSaveFailure;

export interface DesktopCloseRequest {
  readonly requestId: string;
}

export type DesktopCloseResult =
  | { readonly requestId: string; readonly ok: true }
  | { readonly requestId: string; readonly ok: false; readonly message: string };

export interface MarkflowDesktopApi {
  chooseFolder(): Promise<DesktopFolderRoot | null>;
  listDirectory(request: DesktopPathRequest): Promise<DesktopFolderEntry[]>;
  createMarkdownFile(request: DesktopCreateEntryRequest): Promise<DesktopFileEntry>;
  createFolder(request: DesktopCreateEntryRequest): Promise<DesktopDirectoryEntry>;
  importDroppedFiles(request: DesktopDroppedFilesRequest, files: File[]): Promise<DesktopImportResult>;
  openMarkdown(request: DesktopPathRequest): Promise<DesktopMarkdownDocument>;
  openMedia(request: DesktopPathRequest): Promise<DesktopMediaDocument>;
  autosaveCurrentMarkdown(request: DesktopAutosaveRequest): Promise<DesktopSaveResult>;
  onBeforeClose(listener: (request: DesktopCloseRequest) => void): () => void;
  completeClose(result: DesktopCloseResult): Promise<void>;
}

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
