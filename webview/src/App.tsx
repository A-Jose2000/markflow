import "@mdxeditor/editor/style.css";
import "katex/dist/katex.min.css";
import { Component, type ErrorInfo, type JSX, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import type { ExtensionToWebviewMessage } from "./markdownMessages";
import { DesktopSidebar } from "./DesktopSidebar";
import {
  createDesktopAutosave,
  getDesktopApi,
  type DesktopAutosaveController,
  type DesktopFileTarget,
  type DesktopFolderRoot,
  type DesktopMarkdownDocument,
  type DesktopMediaDocument,
  type DesktopSaveFailure
} from "./desktopApi";
import { createDraggableBlocksPlugin } from "./draggableBlocksPlugin";
import { markflowMathPlugin } from "./mathPlugin";
import { getVsCodeApi } from "./vscodeApi";

const DEFAULT_DEBOUNCE_MS = 250;

export type MdxEditorModule = typeof import("@mdxeditor/editor");
type EditorMode = "raw" | "rich";
type CodexSelectionSource = "raw" | "rich";
type DesktopView =
  | { type: "markdown"; document: DesktopMarkdownDocument }
  | { type: "media"; document: DesktopMediaDocument };
type DesktopSaveState = "idle" | "loading" | "saving" | "saved" | "error";

interface CodexSelectionPayload {
  text: string;
  source: CodexSelectionSource;
  startIndex?: number;
  endIndex?: number;
}

interface RichEditorBoundaryProps {
  children: ReactNode;
  onError: (error: Error) => void;
}

class RichEditorBoundary extends Component<RichEditorBoundaryProps> {
  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Markflow rich editor render failed.", error, errorInfo);
    this.props.onError(error);
  }

  public override render(): ReactNode {
    return this.props.children;
  }
}

export function App(): JSX.Element {
  const vscode = useMemo(() => getVsCodeApi(), []);
  const desktopApi = useMemo(() => getDesktopApi(), []);
  const appShellRef = useRef<HTMLElement>(null);
  const editorRef = useRef<MDXEditorMethods>(null);
  const rawEditorRef = useRef<HTMLTextAreaElement>(null);
  const debounceTimerRef = useRef<number | undefined>(undefined);
  const applyingExternalUpdateRef = useRef(false);
  const composingRef = useRef(false);
  const isReadyRef = useRef(false);
  const lastCodexSelectionRef = useRef<CodexSelectionPayload | undefined>(undefined);
  const markdownRef = useRef("");
  const pendingExternalMarkdownRef = useRef<string | undefined>(undefined);
  const debounceMsRef = useRef(DEFAULT_DEBOUNCE_MS);
  const desktopAutosaveRef = useRef<DesktopAutosaveController | undefined>(undefined);
  const desktopCloseRequestRef = useRef<string | undefined>(undefined);
  const desktopNavigationGenerationRef = useRef(0);
  const [markdown, setMarkdown] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [readonly, setReadonly] = useState(false);
  const [editorError, setEditorError] = useState<string | undefined>();
  const [editorMode, setEditorMode] = useState<EditorMode>("rich");
  const [richEditorModule, setRichEditorModule] = useState<MdxEditorModule | undefined>();
  const [richEditorLoadError, setRichEditorLoadError] = useState<string | undefined>();
  const [resourcePath, setResourcePath] = useState<string | undefined>();
  const [hasCodexSelection, setHasCodexSelection] = useState(false);
  const [desktopView, setDesktopView] = useState<DesktopView | undefined>();
  const [desktopActiveTarget, setDesktopActiveTarget] = useState<DesktopFileTarget | undefined>();
  const [desktopSaveState, setDesktopSaveState] = useState<DesktopSaveState>("idle");
  const [desktopError, setDesktopError] = useState<string | undefined>();
  const webviewContext = useMemo(() => JSON.stringify({ markflowHasSelection: hasCodexSelection }), [hasCodexSelection]);

  const plugins = useMemo(
    () =>
      richEditorModule
        ? [
            richEditorModule.headingsPlugin(),
            richEditorModule.listsPlugin(),
            richEditorModule.quotePlugin(),
            richEditorModule.thematicBreakPlugin(),
            richEditorModule.linkPlugin(),
            richEditorModule.linkDialogPlugin(),
            richEditorModule.tablePlugin(),
            richEditorModule.codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
            richEditorModule.codeMirrorPlugin({
              codeBlockLanguages: {
                bash: "Bash",
                css: "CSS",
                html: "HTML",
                js: "JavaScript",
                json: "JSON",
                jsx: "JSX",
                markdown: "Markdown",
                md: "Markdown",
                mermaid: "Mermaid",
                py: "Python",
                sql: "SQL",
                ts: "TypeScript",
                tsx: "TSX",
                txt: "Plain text",
                yaml: "YAML"
              }
            }),
            richEditorModule.frontmatterPlugin(),
            createDraggableBlocksPlugin(richEditorModule),
            markflowMathPlugin(richEditorModule),
            richEditorModule.diffSourcePlugin({ viewMode: "rich-text" }),
            richEditorModule.markdownShortcutPlugin(),
            richEditorModule.toolbarPlugin({
              toolbarContents: () => (
                <richEditorModule.DiffSourceToggleWrapper>
                  <richEditorModule.UndoRedo />
                  <richEditorModule.Separator />
                  <richEditorModule.BlockTypeSelect />
                  <richEditorModule.Separator />
                  <richEditorModule.BoldItalicUnderlineToggles />
                  <richEditorModule.CodeToggle />
                  <richEditorModule.CreateLink />
                  <richEditorModule.Separator />
                  <richEditorModule.ListsToggle />
                  <richEditorModule.Separator />
                  <richEditorModule.InsertCodeBlock />
                  <richEditorModule.InsertTable />
                  <richEditorModule.InsertThematicBreak />
                </richEditorModule.DiffSourceToggleWrapper>
              )
            })
          ]
        : [],
    [richEditorModule]
  );

  useEffect(() => {
    let isDisposed = false;

    import("@mdxeditor/editor")
      .then((editorModule) => {
        if (isDisposed) {
          return;
        }

        setRichEditorModule(editorModule);
      })
      .catch((error: unknown) => {
        if (isDisposed) {
          return;
        }

        const message = error instanceof Error ? error.message : "The rich Markdown editor failed to load.";
        console.error("Markflow could not load MDXEditor.", error);
        setRichEditorLoadError(message);
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    const autosave = createDesktopAutosave(desktopApi, {
      delayMs: DEFAULT_DEBOUNCE_MS,
      onSaved: () => {
        setDesktopSaveState("saved");
        setDesktopError(undefined);
      },
      onError: (error) => {
        setDesktopSaveState("error");
        setDesktopError(getDesktopErrorMessage(error));
      }
    });

    desktopAutosaveRef.current = autosave;

    return () => {
      autosave.dispose();

      if (desktopAutosaveRef.current === autosave) {
        desktopAutosaveRef.current = undefined;
      }
    };
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() !== "s" || (!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      event.preventDefault();
      setDesktopSaveState("saving");
      void (async () => {
        try {
          const result = await desktopAutosaveRef.current?.flush();

          if (result && !result.ok) {
            setDesktopSaveState("error");
            setDesktopError(result.message);
            return;
          }

          setDesktopSaveState("saved");
          setDesktopError(undefined);
        } catch (error) {
          setDesktopSaveState("error");
          setDesktopError(getDesktopErrorMessage(error instanceof Error ? error : new Error("Save failed.")));
        }
      })();
    };

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    return desktopApi.onBeforeClose((request) => {
      if (desktopCloseRequestRef.current) {
        return;
      }

      desktopCloseRequestRef.current = request.requestId;

      void (async () => {
        let completion:
          | { requestId: string; ok: true }
          | { requestId: string; ok: false; message: string };

        try {
          const autosave = desktopAutosaveRef.current;

          if (autosave?.hasPendingChanges()) {
            setDesktopSaveState("saving");
          }

          const result = await autosave?.flush();

          if (result && !result.ok) {
            setDesktopSaveState("error");
            setDesktopError(result.message);
            completion = {
              requestId: request.requestId,
              ok: false,
              message: result.message.slice(0, 1_000) || "Markflow could not save pending changes."
            };
          } else {
            setDesktopSaveState("saved");
            setDesktopError(undefined);
            completion = {
              requestId: request.requestId,
              ok: true
            };
          }
        } catch (error) {
          const message = getDesktopErrorMessage(
            error instanceof Error ? error : new Error("Markflow could not save pending changes.")
          );
          setDesktopSaveState("error");
          setDesktopError(message);
          completion = {
            requestId: request.requestId,
            ok: false,
            message: message.slice(0, 1_000) || "Markflow could not save pending changes."
          };
        }

        try {
          await desktopApi.completeClose(completion);
        } catch (error) {
          console.error("Markflow Desktop could not complete the close handshake.", error);
        } finally {
          if (desktopCloseRequestRef.current === request.requestId) {
            desktopCloseRequestRef.current = undefined;
          }
        }
      })();
    });
  }, [desktopApi]);

  useEffect(() => {
    const updateCodexSelection = () => {
      publishCodexSelection(readCurrentCodexSelection());
    };

    document.addEventListener("selectionchange", updateCodexSelection);
    window.addEventListener("keyup", updateCodexSelection, true);
    window.addEventListener("mouseup", updateCodexSelection, true);

    return () => {
      document.removeEventListener("selectionchange", updateCodexSelection);
      window.removeEventListener("keyup", updateCodexSelection, true);
      window.removeEventListener("mouseup", updateCodexSelection, true);
    };
  }, [editorMode, editorError, richEditorLoadError, markdown, vscode]);

  const RichMarkdownEditor = richEditorModule?.MDXEditor;

  useEffect(() => {
    if (desktopApi) {
      isReadyRef.current = true;
      debounceMsRef.current = DEFAULT_DEBOUNCE_MS;
      setReadonly(false);
      setIsReady(true);

      return () => {
        clearPendingEdit();
      };
    }

    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;

      if (message.type === "init") {
        if (isReadyRef.current) {
          return;
        }

        isReadyRef.current = true;
        debounceMsRef.current = message.debounceMs;
        setResourcePath(message.resourcePath);
        setReadonly(message.readonly);
        setEditorError(undefined);
        commitMarkdownState(message.markdown);
        setIsReady(true);
        return;
      }

      if (message.type === "update") {
        applyExternalMarkdown(message.markdown);
      }
    };

    window.addEventListener("message", handleMessage);

    const requestInitialDocument = () => {
      if (!isReadyRef.current) {
        vscode.postMessage({ type: "ready" });
      }
    };

    requestInitialDocument();
    const readyRetryTimer = window.setInterval(requestInitialDocument, 500);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(readyRetryTimer);
      clearPendingEdit();
    };
  }, [desktopApi, vscode]);

  function clearPendingEdit(): void {
    if (debounceTimerRef.current !== undefined) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
  }

  function commitMarkdownState(nextMarkdown: string): void {
    markdownRef.current = nextMarkdown;
    setMarkdown(nextMarkdown);
  }

  function applyExternalMarkdown(nextMarkdown: string): void {
    if (nextMarkdown === markdownRef.current) {
      return;
    }

    if (composingRef.current) {
      pendingExternalMarkdownRef.current = nextMarkdown;
      return;
    }

    applyingExternalUpdateRef.current = true;
    setEditorError(undefined);
    commitMarkdownState(nextMarkdown);
    editorRef.current?.setMarkdown(nextMarkdown);

    window.requestAnimationFrame(() => {
      applyingExternalUpdateRef.current = false;
    });
  }

  function flushPendingExternalMarkdown(): void {
    const pendingMarkdown = pendingExternalMarkdownRef.current;
    pendingExternalMarkdownRef.current = undefined;

    if (pendingMarkdown !== undefined) {
      applyExternalMarkdown(pendingMarkdown);
    }
  }

  function handleMarkdownChange(nextMarkdown: string, initialMarkdownNormalize = false): void {
    commitMarkdownState(nextMarkdown);

    if (readonly || applyingExternalUpdateRef.current || initialMarkdownNormalize) {
      return;
    }

    if (desktopApi) {
      setDesktopSaveState("saving");
      desktopAutosaveRef.current?.schedule(nextMarkdown);
      return;
    }

    clearPendingEdit();

    debounceTimerRef.current = window.setTimeout(() => {
      vscode.postMessage({
        type: "edit",
        markdown: nextMarkdown
      });
    }, debounceMsRef.current);
  }

  function handleContextMenuCapture(): void {
    publishCodexSelection(readCurrentCodexSelection());
  }

  function readCurrentCodexSelection(): CodexSelectionPayload | undefined {
    const rawSelection = readRawCodexSelection();

    if (rawSelection) {
      return rawSelection;
    }

    if (editorMode !== "rich" || editorError || richEditorLoadError) {
      return undefined;
    }

    return readRichCodexSelection();
  }

  function readRawCodexSelection(): CodexSelectionPayload | undefined {
    const rawEditor = rawEditorRef.current;

    if (!rawEditor || document.activeElement !== rawEditor) {
      return undefined;
    }

    const startIndex = Math.min(rawEditor.selectionStart, rawEditor.selectionEnd);
    const endIndex = Math.max(rawEditor.selectionStart, rawEditor.selectionEnd);

    if (startIndex === endIndex) {
      return undefined;
    }

    const selectedText = markdown.slice(startIndex, endIndex);

    if (selectedText.trim().length === 0) {
      return undefined;
    }

    return {
      text: selectedText,
      source: "raw",
      startIndex,
      endIndex
    };
  }

  function readRichCodexSelection(): CodexSelectionPayload | undefined {
    const selection = window.getSelection();
    const editorElement = document.querySelector(".rich-editor-shell");

    if (
      !selection ||
      selection.isCollapsed ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !editorElement?.contains(selection.anchorNode) ||
      !editorElement.contains(selection.focusNode)
    ) {
      return undefined;
    }

    const selectedText = selection.toString().replace(/\u00a0/g, " ");

    if (selectedText.trim().length === 0) {
      return undefined;
    }

    return {
      text: selectedText,
      source: "rich"
    };
  }

  function publishCodexSelection(selection: CodexSelectionPayload | undefined): void {
    const nextSelection = selection && selection.text.trim().length > 0 ? selection : undefined;

    if (areCodexSelectionsEqual(lastCodexSelectionRef.current, nextSelection)) {
      updateCodexContext(Boolean(nextSelection));
      return;
    }

    lastCodexSelectionRef.current = nextSelection;
    updateCodexContext(Boolean(nextSelection));

    vscode.postMessage(
      nextSelection
        ? {
            type: "codexSelection",
            ...nextSelection
          }
        : {
            type: "codexSelection",
            text: "",
            source: editorMode === "raw" ? "raw" : "rich"
          }
    );
  }

  function updateCodexContext(hasSelection: boolean): void {
    const nextContext = JSON.stringify({ markflowHasSelection: hasSelection });
    appShellRef.current?.setAttribute("data-vscode-context", nextContext);
    setHasCodexSelection((current) => (current === hasSelection ? current : hasSelection));
  }

  async function flushDesktopChanges(): Promise<void> {
    const result = await desktopAutosaveRef.current?.flush();

    if (result && !result.ok) {
      throw new Error(result.message);
    }
  }

  async function handleOpenDesktopMarkdown(target: DesktopFileTarget): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const navigationGeneration = ++desktopNavigationGenerationRef.current;
    await flushDesktopChanges();

    if (navigationGeneration !== desktopNavigationGenerationRef.current) {
      return;
    }

    const document = await desktopApi.openMarkdown({
      rootId: target.rootId,
      relativePath: target.relativePath
    });

    if (navigationGeneration !== desktopNavigationGenerationRef.current) {
      return;
    }

    desktopAutosaveRef.current?.trackDocument(document);
    applyingExternalUpdateRef.current = true;
    setEditorError(undefined);
    setDesktopError(undefined);
    setDesktopSaveState("saved");
    setDesktopActiveTarget(target);
    setDesktopView({ type: "markdown", document });
    setResourcePath(document.displayPath);
    commitMarkdownState(document.markdown);
    editorRef.current?.setMarkdown(document.markdown);

    window.requestAnimationFrame(() => {
      applyingExternalUpdateRef.current = false;
    });
  }

  async function handleOpenDesktopMedia(target: DesktopFileTarget): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const navigationGeneration = ++desktopNavigationGenerationRef.current;
    await flushDesktopChanges();

    if (navigationGeneration !== desktopNavigationGenerationRef.current) {
      return;
    }

    const document = await desktopApi.openMedia({
      rootId: target.rootId,
      relativePath: target.relativePath
    });

    if (navigationGeneration !== desktopNavigationGenerationRef.current) {
      return;
    }

    desktopAutosaveRef.current?.dispose();
    setDesktopError(undefined);
    setDesktopSaveState("idle");
    setDesktopActiveTarget(target);
    setDesktopView({ type: "media", document });
    setResourcePath(document.displayPath);
  }

  function handleDesktopFolderChanged(root: DesktopFolderRoot): void {
    desktopNavigationGenerationRef.current += 1;
    desktopAutosaveRef.current?.dispose();
    clearPendingEdit();
    setDesktopView(undefined);
    setDesktopActiveTarget(undefined);
    setDesktopSaveState("idle");
    setDesktopError(undefined);
    setResourcePath(root.displayPath);
    commitMarkdownState("");
  }

  async function handleDiscardAndReloadDesktopMarkdown(): Promise<void> {
    if (!desktopApi || desktopView?.type !== "markdown") {
      return;
    }

    const shouldReload = window.confirm(
      "Discard Markflow's unsaved changes and reload the latest version from disk?"
    );

    if (!shouldReload) {
      return;
    }

    const navigationGeneration = ++desktopNavigationGenerationRef.current;
    const currentDocument = desktopView.document;
    setDesktopSaveState("loading");

    try {
      const document = await desktopApi.openMarkdown({
        rootId: currentDocument.rootId,
        relativePath: currentDocument.relativePath
      });

      if (navigationGeneration !== desktopNavigationGenerationRef.current) {
        return;
      }

      desktopAutosaveRef.current?.trackDocument(document);
      applyingExternalUpdateRef.current = true;
      setEditorError(undefined);
      setDesktopError(undefined);
      setDesktopSaveState("saved");
      setDesktopView({ type: "markdown", document });
      setResourcePath(document.displayPath);
      commitMarkdownState(document.markdown);
      editorRef.current?.setMarkdown(document.markdown);

      window.requestAnimationFrame(() => {
        applyingExternalUpdateRef.current = false;
      });
    } catch (error) {
      setDesktopSaveState("error");
      setDesktopError(
        getDesktopErrorMessage(error instanceof Error ? error : new Error("The file could not be reloaded."))
      );
    }
  }

  function handleEditorError(payload: { error: string; source: string }): void {
    console.error("Markflow could not parse Markdown for the rich editor.", payload);
    setEditorError(payload.error);
    setEditorMode("raw");
    commitMarkdownState(payload.source);
  }

  function handleRichEditorRenderError(error: Error): void {
    setEditorError(error.message);
    setEditorMode("raw");
  }

  if (!isReady) {
    return (
      <main className="app-shell app-shell--loading" aria-busy="true">
        <div className="loading-line" />
        <p className="loading-copy">Waiting for the Markdown document...</p>
      </main>
    );
  }

  const editorSurface =
    editorMode === "raw" || editorError || richEditorLoadError || !RichMarkdownEditor ? (
      <section className="fallback-shell" aria-label="Raw Markdown fallback editor">
        <div className="fallback-banner">
          <strong>{RichMarkdownEditor ? "Raw Markdown" : "Loading rich editor"}</strong>
          <span>{editorError ?? richEditorLoadError ?? "The raw editor is available while Markflow starts."}</span>
        </div>
        <textarea
          ref={rawEditorRef}
          className="raw-markdown-editor"
          onChange={(event) => handleMarkdownChange(event.currentTarget.value)}
          onSelect={() => publishCodexSelection(readCurrentCodexSelection())}
          readOnly={readonly}
          spellCheck={false}
          value={markdown}
        />
      </section>
    ) : (
      <section className="rich-editor-shell" aria-label="Rich Markdown editor">
        <RichEditorBoundary onError={handleRichEditorRenderError}>
          <RichMarkdownEditor
            ref={editorRef}
            markdown={markdown}
            readOnly={readonly}
            plugins={plugins}
            className="markflow-rich-editor"
            contentEditableClassName="markflow-editor"
            onChange={handleMarkdownChange}
            onError={handleEditorError}
            suppressHtmlProcessing={Boolean(desktopApi)}
            trim={false}
          />
        </RichEditorBoundary>
      </section>
    );

  return (
    <main
      ref={appShellRef}
      className={`app-shell${desktopApi ? " app-shell--desktop" : ""}`}
      data-vscode-context={webviewContext}
      onContextMenuCapture={handleContextMenuCapture}
      onCompositionEnd={() => {
        composingRef.current = false;
        flushPendingExternalMarkdown();
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
    >
      {desktopApi ? (
        <DesktopSidebar
          activeTarget={desktopActiveTarget}
          api={desktopApi}
          onBeforeChooseFolder={flushDesktopChanges}
          onBeforeCreate={flushDesktopChanges}
          onError={(error) => setDesktopError(error.message)}
          onFolderChanged={handleDesktopFolderChanged}
          onOpenMarkdown={handleOpenDesktopMarkdown}
          onOpenMedia={handleOpenDesktopMedia}
        />
      ) : null}

      <section className="app-workspace">
        <header className="app-topbar">
          <div className="topbar-actions">
            {!desktopApi || desktopView?.type === "markdown" ? (
              <div className="mode-switcher" role="group" aria-label="Editor mode">
                <button
                  data-active={editorMode === "raw"}
                  onClick={() => setEditorMode("raw")}
                  title="Raw Markdown"
                  type="button"
                >
                  Raw
                </button>
                <button
                  data-active={editorMode === "rich"}
                  disabled={!RichMarkdownEditor || Boolean(richEditorLoadError)}
                  onClick={() => {
                    setEditorError(undefined);
                    setEditorMode("rich");
                  }}
                  title={richEditorLoadError ?? "Rich Markdown"}
                  type="button"
                >
                  Rich
                </button>
              </div>
            ) : null}
          </div>

          <div className="document-status" aria-live="polite" title={resourcePath}>
            {desktopApi
              ? getDesktopStatusLabel(desktopView, desktopSaveState)
              : markdown.length === 0
                ? "0 characters loaded"
                : `${markdown.length} characters loaded`}
          </div>
        </header>

        {desktopError ? (
          <div className="desktop-workspace-error" role="alert">
            <span>{desktopError}</span>
            <div className="desktop-workspace-error__actions">
              {desktopSaveState === "error" && desktopView?.type === "markdown" ? (
                <button
                  className="desktop-workspace-error__reload"
                  onClick={() => void handleDiscardAndReloadDesktopMarkdown()}
                  type="button"
                >
                  Discard &amp; reload
                </button>
              ) : null}
              <button aria-label="Dismiss error" onClick={() => setDesktopError(undefined)} type="button">
                ×
              </button>
            </div>
          </div>
        ) : null}

        <section className="editor-stage">
          {desktopApi && !desktopView ? (
            <section className="desktop-welcome" aria-label="Markflow desktop welcome">
              <div className="desktop-welcome__icon" aria-hidden="true">
                M↓
              </div>
              <h1>Open a folder to start</h1>
              <p>Choose a Markdown or media file from the Explorer. Markdown changes are saved automatically.</p>
            </section>
          ) : desktopView?.type === "media" ? (
            <DesktopMediaPreview document={desktopView.document} />
          ) : (
            editorSurface
          )}
        </section>
      </section>
    </main>
  );
}

function DesktopMediaPreview({ document }: { document: DesktopMediaDocument }): JSX.Element {
  let preview: ReactNode;

  switch (document.kind) {
    case "image":
      preview = <img alt={document.name} src={document.url} />;
      break;

    case "audio":
      preview = <audio aria-label={`Audio preview of ${document.name}`} controls src={document.url} />;
      break;

    case "video":
      preview = <video aria-label={`Video preview of ${document.name}`} controls src={document.url} />;
      break;

    case "pdf":
      preview = <iframe src={document.url} title={`PDF preview of ${document.name}`} />;
  }

  return (
    <section className={`desktop-media-viewer desktop-media-viewer--${document.kind}`} aria-label={document.name}>
      <header>
        <h1>{document.name}</h1>
        <p title={document.displayPath}>{document.displayPath}</p>
      </header>
      <div className="desktop-media-viewer__canvas">{preview}</div>
    </section>
  );
}

function getDesktopStatusLabel(view: DesktopView | undefined, saveState: DesktopSaveState): string {
  if (!view) {
    return "No file open";
  }

  if (view.type === "media") {
    return view.document.name;
  }

  switch (saveState) {
    case "loading":
      return `${view.document.name} · Reloading…`;
    case "saving":
      return `${view.document.name} · Saving…`;
    case "error":
      return `${view.document.name} · Save failed`;
    case "saved":
      return `${view.document.name} · Saved`;
    default:
      return view.document.name;
  }
}

function getDesktopErrorMessage(error: DesktopSaveFailure | Error): string {
  return error instanceof Error ? error.message : error.message;
}

function areCodexSelectionsEqual(
  previousSelection: CodexSelectionPayload | undefined,
  nextSelection: CodexSelectionPayload | undefined
): boolean {
  if (!previousSelection || !nextSelection) {
    return previousSelection === nextSelection;
  }

  return (
    previousSelection.text === nextSelection.text &&
    previousSelection.source === nextSelection.source &&
    previousSelection.startIndex === nextSelection.startIndex &&
    previousSelection.endIndex === nextSelection.endIndex
  );
}
