import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from "react";

import type { MarkdownMessagePort } from "./useMarkdownSession";

export type CodexSelectionSource = "raw" | "rich";

export interface CodexSelectionPayload {
  text: string;
  source: CodexSelectionSource;
  startIndex?: number;
  endIndex?: number;
}

interface UseCodexSelectionBridgeOptions {
  appShellRef: RefObject<HTMLElement | null>;
  editorMode: CodexSelectionSource;
  markdown: string;
  port: MarkdownMessagePort;
  rawEditorRef: RefObject<HTMLTextAreaElement | null>;
  richSelectionEnabled: boolean;
}

interface CodexSelectionBridge {
  publishCurrentSelection(): void;
  vscodeContext: string;
}

export function useCodexSelectionBridge({
  appShellRef,
  editorMode,
  markdown,
  port,
  rawEditorRef,
  richSelectionEnabled
}: UseCodexSelectionBridgeOptions): CodexSelectionBridge {
  const lastSelectionRef = useRef<CodexSelectionPayload | undefined>(undefined);
  const [hasSelection, setHasSelection] = useState(false);
  const vscodeContext = useMemo(
    () => JSON.stringify({ markflowHasSelection: hasSelection }),
    [hasSelection]
  );

  const updateContext = useCallback((nextHasSelection: boolean) => {
    const nextContext = JSON.stringify({ markflowHasSelection: nextHasSelection });
    appShellRef.current?.setAttribute("data-vscode-context", nextContext);
    setHasSelection((current) => current === nextHasSelection ? current : nextHasSelection);
  }, [appShellRef]);

  const readCurrentSelection = useCallback((): CodexSelectionPayload | undefined => {
    const rawEditor = rawEditorRef.current;

    if (rawEditor && document.activeElement === rawEditor) {
      const startIndex = Math.min(rawEditor.selectionStart, rawEditor.selectionEnd);
      const endIndex = Math.max(rawEditor.selectionStart, rawEditor.selectionEnd);

      if (startIndex !== endIndex) {
        const selectedText = markdown.slice(startIndex, endIndex);

        if (selectedText.trim().length > 0) {
          return { text: selectedText, source: "raw", startIndex, endIndex };
        }
      }
    }

    if (!richSelectionEnabled) {
      return undefined;
    }

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
    return selectedText.trim().length > 0
      ? { text: selectedText, source: "rich" }
      : undefined;
  }, [markdown, rawEditorRef, richSelectionEnabled]);

  const publishCurrentSelection = useCallback(() => {
    const selection = readCurrentSelection();
    const nextSelection = selection && selection.text.trim().length > 0 ? selection : undefined;

    if (areCodexSelectionsEqual(lastSelectionRef.current, nextSelection)) {
      updateContext(Boolean(nextSelection));
      return;
    }

    lastSelectionRef.current = nextSelection;
    updateContext(Boolean(nextSelection));
    port.postMessage(
      nextSelection
        ? { type: "codexSelection", ...nextSelection }
        : { type: "codexSelection", text: "", source: editorMode }
    );
  }, [editorMode, port, readCurrentSelection, updateContext]);

  useEffect(() => {
    document.addEventListener("selectionchange", publishCurrentSelection);
    window.addEventListener("keyup", publishCurrentSelection, true);
    window.addEventListener("mouseup", publishCurrentSelection, true);

    return () => {
      document.removeEventListener("selectionchange", publishCurrentSelection);
      window.removeEventListener("keyup", publishCurrentSelection, true);
      window.removeEventListener("mouseup", publishCurrentSelection, true);
    };
  }, [publishCurrentSelection]);

  return { publishCurrentSelection, vscodeContext };
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
