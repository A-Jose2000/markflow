import "@mdxeditor/editor/style.css";
import "katex/dist/katex.min.css";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type JSX
} from "react";

import { getDesktopApi } from "./desktopApi";
import { useDesktopWorkspace } from "./desktop/useDesktopWorkspace";
import {
  EditorSurface,
  type EditorMode
} from "./editor/EditorSurface";
import { useRichEditorRuntime } from "./editor/useRichEditorRuntime";
import { useCodexSelectionBridge } from "./host/useCodexSelectionBridge";
import { useDesktopEditorPort } from "./host/useDesktopEditorPort";
import {
  useMarkdownSession,
  type MarkdownHost
} from "./host/useMarkdownSession";
import { MarkflowShell } from "./shell/MarkflowShell";
import { getVsCodeApi } from "./vscodeApi";

export function App(): JSX.Element {
  const vscode = useMemo(() => getVsCodeApi(), []);
  const desktopApi = useMemo(() => getDesktopApi(), []);
  const appShellRef = useRef<HTMLElement>(null);
  const rawEditorRef = useRef<HTMLTextAreaElement>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("rich");
  const [editorError, setEditorError] = useState<string | undefined>();
  const richEditor = useRichEditorRuntime();
  const host = useMemo<MarkdownHost>(
    () => desktopApi ? { kind: "desktop" } : { kind: "extension", port: vscode },
    [desktopApi, vscode]
  );
  const clearEditorError = useCallback(() => setEditorError(undefined), []);
  const markdownSession = useMarkdownSession({
    host,
    onExternalMarkdownPresented: clearEditorError
  });
  const desktopEditorPort = useDesktopEditorPort({
    appShellRef,
    rawEditorRef,
    session: markdownSession
  });
  const desktopWorkspace = useDesktopWorkspace({ api: desktopApi, editor: desktopEditorPort });
  const resourcePath = desktopApi ? desktopWorkspace.resourcePath : markdownSession.resourcePath;
  const codexSelection = useCodexSelectionBridge({
    appShellRef,
    editorMode,
    markdown: markdownSession.markdown,
    port: vscode,
    rawEditorRef,
    richSelectionEnabled: editorMode === "rich" && !editorError && !richEditor.loadError
  });

  const handleMarkdownChange = useCallback((
    markdown: string,
    initialMarkdownNormalize = false
  ) => {
    markdownSession.handleEditorChange(
      markdown,
      initialMarkdownNormalize,
      desktopWorkspace.scheduleMarkdown
    );
  }, [desktopWorkspace.scheduleMarkdown, markdownSession.handleEditorChange]);

  const handleEditorParseError = useCallback((payload: { error: string; source: string }) => {
    console.error("Markflow could not parse Markdown for the rich editor.", payload);
    setEditorError(payload.error);
    setEditorMode("raw");
    markdownSession.commitMarkdown(payload.source);
  }, [markdownSession.commitMarkdown]);

  const handleEditorRenderError = useCallback((error: Error) => {
    setEditorError(error.message);
    setEditorMode("raw");
  }, []);

  const handleEditorModeChange = useCallback((mode: EditorMode) => {
    if (mode === "rich") {
      setEditorError(undefined);
    }
    setEditorMode(mode);
  }, []);

  if (!markdownSession.isReady) {
    return (
      <main className="app-shell app-shell--loading" aria-busy="true">
        <div className="loading-line" />
        <p className="loading-copy">Waiting for the Markdown document...</p>
      </main>
    );
  }

  const editorSurface = (
    <EditorSurface
      editorError={editorError}
      editorMode={editorMode}
      editorRef={markdownSession.editorRef}
      markdown={markdownSession.markdown}
      onChange={handleMarkdownChange}
      onParseError={handleEditorParseError}
      onRawSelection={codexSelection.publishCurrentSelection}
      onRenderError={handleEditorRenderError}
      rawEditorRef={rawEditorRef}
      readonly={markdownSession.readonly}
      runtime={richEditor}
      suppressHtmlProcessing={Boolean(desktopApi)}
    />
  );

  return (
    <MarkflowShell
      appShellRef={appShellRef}
      desktopApi={desktopApi}
      editorMode={editorMode}
      editorSurface={editorSurface}
      markdownLength={markdownSession.markdown.length}
      onCompositionEnd={markdownSession.endComposition}
      onCompositionStart={markdownSession.beginComposition}
      onContextMenuCapture={codexSelection.publishCurrentSelection}
      onEditorModeChange={handleEditorModeChange}
      resourcePath={resourcePath}
      richEditorAvailable={Boolean(richEditor.editorModule?.MDXEditor)}
      richEditorLoadError={richEditor.loadError}
      vscodeContext={codexSelection.vscodeContext}
      workspace={desktopWorkspace}
    />
  );
}
