import "@mdxeditor/editor/style.css";
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import type { ExtensionToWebviewMessage } from "./markdownMessages";
import { getVsCodeApi } from "./vscodeApi";

const DEFAULT_DEBOUNCE_MS = 250;

type MdxEditorModule = typeof import("@mdxeditor/editor");
type EditorMode = "raw" | "rich";

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
  const editorRef = useRef<MDXEditorMethods>(null);
  const debounceTimerRef = useRef<number | undefined>();
  const applyingExternalUpdateRef = useRef(false);
  const composingRef = useRef(false);
  const isReadyRef = useRef(false);
  const pendingExternalMarkdownRef = useRef<string | undefined>();
  const debounceMsRef = useRef(DEFAULT_DEBOUNCE_MS);
  const [markdown, setMarkdown] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [readonly, setReadonly] = useState(false);
  const [editorError, setEditorError] = useState<string | undefined>();
  const [editorMode, setEditorMode] = useState<EditorMode>("rich");
  const [richEditorModule, setRichEditorModule] = useState<MdxEditorModule | undefined>();
  const [richEditorLoadError, setRichEditorLoadError] = useState<string | undefined>();

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

  const RichMarkdownEditor = richEditorModule?.MDXEditor;

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;

      if (message.type === "init") {
        if (isReadyRef.current) {
          return;
        }

        isReadyRef.current = true;
        debounceMsRef.current = message.debounceMs;
        setReadonly(message.readonly);
        setEditorError(undefined);
        setMarkdown(message.markdown);
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
  }, [vscode]);

  function clearPendingEdit(): void {
    if (debounceTimerRef.current !== undefined) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
  }

  function applyExternalMarkdown(nextMarkdown: string): void {
    if (composingRef.current) {
      pendingExternalMarkdownRef.current = nextMarkdown;
      return;
    }

    applyingExternalUpdateRef.current = true;
    setEditorError(undefined);
    setMarkdown(nextMarkdown);
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
    setMarkdown(nextMarkdown);

    if (readonly || applyingExternalUpdateRef.current || initialMarkdownNormalize) {
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

  function handleEditorError(payload: { error: string; source: string }): void {
    console.error("Markflow could not parse Markdown for the rich editor.", payload);
    setEditorError(payload.error);
    setEditorMode("raw");
    setMarkdown(payload.source);
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

  return (
    <main
      className="app-shell"
      onCompositionEnd={() => {
        composingRef.current = false;
        flushPendingExternalMarkdown();
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
    >
      <header className="app-topbar">
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

        <div className="document-status" aria-live="polite">
          {markdown.length === 0 ? "0 characters loaded" : `${markdown.length} characters loaded`}
        </div>
      </header>

      <section className="editor-stage">
        {editorMode === "raw" || editorError || richEditorLoadError || !RichMarkdownEditor ? (
          <section className="fallback-shell" aria-label="Raw Markdown fallback editor">
            <div className="fallback-banner">
              <strong>{RichMarkdownEditor ? "Raw Markdown" : "Loading rich editor"}</strong>
              <span>{editorError ?? richEditorLoadError ?? "The raw editor is available while Markflow starts."}</span>
            </div>
            <textarea
              className="raw-markdown-editor"
              onChange={(event) => handleMarkdownChange(event.currentTarget.value)}
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
                trim={false}
              />
            </RichEditorBoundary>
          </section>
        )}
      </section>
    </main>
  );
}
