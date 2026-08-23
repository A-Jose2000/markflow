import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from "../../../shared/markdownMessages";

const DEFAULT_DEBOUNCE_MS = 250;

export interface MarkdownMessagePort {
  postMessage(message: WebviewToExtensionMessage): void;
}

export type MarkdownHost =
  | { kind: "desktop" }
  | { kind: "extension"; port: MarkdownMessagePort };

export interface MarkdownSession {
  readonly editorRef: RefObject<MDXEditorMethods | null>;
  readonly isReady: boolean;
  readonly markdown: string;
  readonly readonly: boolean;
  readonly resourcePath?: string;
  beginComposition(): void;
  clearMarkdown(): void;
  commitMarkdown(markdown: string): void;
  endComposition(): void;
  handleEditorChange(
    markdown: string,
    initialMarkdownNormalize?: boolean,
    persistDesktop?: (markdown: string) => void
  ): void;
  presentMarkdown(markdown: string): void;
}

interface UseMarkdownSessionOptions {
  host: MarkdownHost;
  onExternalMarkdownPresented: () => void;
}

export function useMarkdownSession({
  host,
  onExternalMarkdownPresented
}: UseMarkdownSessionOptions): MarkdownSession {
  const editorRef = useRef<MDXEditorMethods>(null);
  const debounceTimerRef = useRef<number | undefined>(undefined);
  const applyingExternalUpdateRef = useRef(false);
  const composingRef = useRef(false);
  const isReadyRef = useRef(false);
  const markdownRef = useRef("");
  const pendingExternalMarkdownRef = useRef<string | undefined>(undefined);
  const debounceMsRef = useRef(DEFAULT_DEBOUNCE_MS);
  const [markdown, setMarkdown] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [readonly, setReadonly] = useState(false);
  const [resourcePath, setResourcePath] = useState<string | undefined>();

  const clearPendingEdit = useCallback(() => {
    if (debounceTimerRef.current !== undefined) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
  }, []);

  const commitMarkdown = useCallback((nextMarkdown: string) => {
    markdownRef.current = nextMarkdown;
    setMarkdown(nextMarkdown);
  }, []);

  const presentMarkdown = useCallback((nextMarkdown: string) => {
    applyingExternalUpdateRef.current = true;
    onExternalMarkdownPresented();
    commitMarkdown(nextMarkdown);
    editorRef.current?.setMarkdown(nextMarkdown);

    window.requestAnimationFrame(() => {
      applyingExternalUpdateRef.current = false;
    });
  }, [commitMarkdown, onExternalMarkdownPresented]);

  const applyExternalMarkdown = useCallback((nextMarkdown: string) => {
    if (nextMarkdown === markdownRef.current) {
      return;
    }

    if (composingRef.current) {
      pendingExternalMarkdownRef.current = nextMarkdown;
      return;
    }

    presentMarkdown(nextMarkdown);
  }, [presentMarkdown]);

  const clearMarkdown = useCallback(() => {
    clearPendingEdit();
    commitMarkdown("");
  }, [clearPendingEdit, commitMarkdown]);

  const endComposition = useCallback(() => {
    composingRef.current = false;
    const pendingMarkdown = pendingExternalMarkdownRef.current;
    pendingExternalMarkdownRef.current = undefined;

    if (pendingMarkdown !== undefined) {
      applyExternalMarkdown(pendingMarkdown);
    }
  }, [applyExternalMarkdown]);

  const beginComposition = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleEditorChange = useCallback((
    nextMarkdown: string,
    initialMarkdownNormalize = false,
    persistDesktop?: (markdown: string) => void
  ) => {
    commitMarkdown(nextMarkdown);

    if (readonly || applyingExternalUpdateRef.current || initialMarkdownNormalize) {
      return;
    }

    if (host.kind === "desktop") {
      persistDesktop?.(nextMarkdown);
      return;
    }

    clearPendingEdit();
    debounceTimerRef.current = window.setTimeout(() => {
      host.port.postMessage({ type: "edit", markdown: nextMarkdown });
    }, debounceMsRef.current);
  }, [clearPendingEdit, commitMarkdown, host, readonly]);

  useEffect(() => {
    if (host.kind === "desktop") {
      isReadyRef.current = true;
      debounceMsRef.current = DEFAULT_DEBOUNCE_MS;
      setReadonly(false);
      setIsReady(true);

      return clearPendingEdit;
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
        onExternalMarkdownPresented();
        commitMarkdown(message.markdown);
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
        host.port.postMessage({ type: "ready" });
      }
    };

    requestInitialDocument();
    const readyRetryTimer = window.setInterval(requestInitialDocument, 500);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(readyRetryTimer);
      clearPendingEdit();
    };
  }, [applyExternalMarkdown, clearPendingEdit, commitMarkdown, host, onExternalMarkdownPresented]);

  return {
    editorRef,
    isReady,
    markdown,
    readonly,
    resourcePath,
    beginComposition,
    clearMarkdown,
    commitMarkdown,
    endComposition,
    handleEditorChange,
    presentMarkdown
  };
}
