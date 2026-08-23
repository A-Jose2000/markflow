import { useMemo, type RefObject } from "react";

import type { DesktopEditorPort } from "../desktop/useDesktopWorkspace";
import type { MarkdownSession } from "./useMarkdownSession";

interface UseDesktopEditorPortOptions {
  appShellRef: RefObject<HTMLElement | null>;
  rawEditorRef: RefObject<HTMLTextAreaElement | null>;
  session: Pick<MarkdownSession, "clearMarkdown" | "presentMarkdown">;
}

export function useDesktopEditorPort({
  appShellRef,
  rawEditorRef,
  session
}: UseDesktopEditorPortOptions): DesktopEditorPort {
  return useMemo(() => ({
    clearMarkdown: session.clearMarkdown,
    getScrollElement(): HTMLElement | null {
      if (rawEditorRef.current) {
        return rawEditorRef.current;
      }

      const mediaScroller = appShellRef.current?.querySelector<HTMLElement>(".desktop-media-viewer__canvas");

      if (mediaScroller) {
        return mediaScroller;
      }

      const richEditor = appShellRef.current?.querySelector<HTMLElement>(
        ".rich-editor-shell .markflow-editor"
      );
      return richEditor?.parentElement ?? null;
    },
    presentMarkdown: session.presentMarkdown
  }), [appShellRef, rawEditorRef, session.clearMarkdown, session.presentMarkdown]);
}
