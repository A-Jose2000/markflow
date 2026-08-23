import {
  Component,
  type ErrorInfo,
  type ReactNode,
  type RefObject
} from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";

import type { RichEditorRuntime } from "./useRichEditorRuntime";

export type EditorMode = "raw" | "rich";

interface EditorSurfaceProps {
  editorError?: string;
  editorMode: EditorMode;
  editorRef: RefObject<MDXEditorMethods | null>;
  markdown: string;
  onChange: (markdown: string, initialMarkdownNormalize?: boolean) => void;
  onParseError: (payload: { error: string; source: string }) => void;
  onRawSelection: () => void;
  onRenderError: (error: Error) => void;
  rawEditorRef: RefObject<HTMLTextAreaElement | null>;
  readonly: boolean;
  runtime: RichEditorRuntime;
  suppressHtmlProcessing: boolean;
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

export function EditorSurface({
  editorError,
  editorMode,
  editorRef,
  markdown,
  onChange,
  onParseError,
  onRawSelection,
  onRenderError,
  rawEditorRef,
  readonly,
  runtime,
  suppressHtmlProcessing
}: EditorSurfaceProps) {
  const RichMarkdownEditor = runtime.editorModule?.MDXEditor;

  if (editorMode === "raw" || editorError || runtime.loadError || !RichMarkdownEditor) {
    return (
      <section className="fallback-shell" aria-label="Raw Markdown fallback editor">
        <div className="fallback-banner">
          <strong>{RichMarkdownEditor ? "Raw Markdown" : "Loading rich editor"}</strong>
          <span>{editorError ?? runtime.loadError ?? "The raw editor is available while Markflow starts."}</span>
        </div>
        <textarea
          ref={rawEditorRef}
          className="raw-markdown-editor"
          onChange={(event) => onChange(event.currentTarget.value)}
          onSelect={onRawSelection}
          readOnly={readonly}
          spellCheck={false}
          value={markdown}
        />
      </section>
    );
  }

  return (
    <section className="rich-editor-shell" aria-label="Rich Markdown editor">
      <RichEditorBoundary onError={onRenderError}>
        <RichMarkdownEditor
          ref={editorRef}
          markdown={markdown}
          readOnly={readonly}
          plugins={runtime.plugins}
          className="markflow-rich-editor"
          contentEditableClassName="markflow-editor"
          onChange={onChange}
          onError={onParseError}
          suppressHtmlProcessing={suppressHtmlProcessing}
          trim={false}
        />
      </RichEditorBoundary>
    </section>
  );
}

interface EditorModeSwitcherProps {
  editorMode: EditorMode;
  loadError?: string;
  onChange: (mode: EditorMode) => void;
  richAvailable: boolean;
}

export function EditorModeSwitcher({
  editorMode,
  loadError,
  onChange,
  richAvailable
}: EditorModeSwitcherProps) {
  return (
    <div className="mode-switcher" role="group" aria-label="Editor mode">
      <button
        data-active={editorMode === "raw"}
        onClick={() => onChange("raw")}
        title="Raw Markdown"
        type="button"
      >
        Raw
      </button>
      <button
        data-active={editorMode === "rich"}
        disabled={!richAvailable || Boolean(loadError)}
        onClick={() => onChange("rich")}
        title={loadError ?? "Rich Markdown"}
        type="button"
      >
        Rich
      </button>
    </div>
  );
}
