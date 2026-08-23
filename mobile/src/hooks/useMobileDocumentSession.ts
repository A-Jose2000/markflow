import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Linking, Share } from "react-native";

import {
  clearDocumentSnapshots,
  loadLastDocument,
  loadRecentDocuments,
  saveDocumentSnapshot
} from "../storage/recentDocuments";
import type { LoadStatus, MarkdownDocument, ReaderMode } from "../types";
import {
  loadMarkdownFromIncomingUrl,
  loadRemoteMarkdown,
  pickMarkdownDocument
} from "../utils/documents";
import { messageFromError } from "../utils/errors";

export interface UseMobileDocumentSessionOptions {
  readonly credentialsReady: boolean;
  readonly getGitHubToken: () => string | undefined;
}

export interface MobileDocumentSession {
  readonly document?: MarkdownDocument;
  readonly documentStatus: string;
  readonly isLoading: boolean;
  readonly readerMode: ReaderMode;
  readonly recentDocuments: readonly MarkdownDocument[];
  readonly status: LoadStatus;
  readonly urlInput: string;
  clearRecents(): Promise<void>;
  loadRemote(url?: string): Promise<void>;
  openIncomingUrl(url: string): Promise<void>;
  pickLocal(): Promise<void>;
  refresh(): Promise<void>;
  selectRecent(document: MarkdownDocument): Promise<void>;
  setReaderMode(mode: ReaderMode): void;
  setUrlInput(value: string): void;
  share(): Promise<void>;
}

export function useMobileDocumentSession({
  credentialsReady,
  getGitHubToken
}: UseMobileDocumentSessionOptions): MobileDocumentSession {
  const operationRef = useRef(0);
  const [document, setDocument] = useState<MarkdownDocument | undefined>();
  const [recentDocuments, setRecentDocuments] = useState<MarkdownDocument[]>([]);
  const [readerMode, setReaderMode] = useState<ReaderMode>("rendered");
  const [status, setStatus] = useState<LoadStatus>({ kind: "idle" });
  const [urlInput, setUrlInput] = useState("");

  const commitDocument = useCallback(async (
    nextDocument: MarkdownDocument,
    operation: number
  ): Promise<void> => {
    if (operation !== operationRef.current) {
      return;
    }

    setDocument(nextDocument);
    setReaderMode("rendered");
    setStatus({ kind: "idle" });

    if (nextDocument.source === "remote") {
      setUrlInput(nextDocument.origin);
    }

    try {
      const nextRecentDocuments = await saveDocumentSnapshot(nextDocument);

      if (operation === operationRef.current) {
        setRecentDocuments(nextRecentDocuments);
      }
    } catch {
      // Recent-document storage is optional; opening the document still succeeded.
    }
  }, []);

  const runDocumentLoad = useCallback(async (
    message: string,
    load: () => Promise<MarkdownDocument | null | undefined>
  ): Promise<void> => {
    const operation = ++operationRef.current;
    setStatus({ kind: "loading", message });

    try {
      const nextDocument = await load();

      if (operation !== operationRef.current) {
        return;
      }

      if (!nextDocument) {
        setStatus({ kind: "idle" });
        return;
      }

      await commitDocument(nextDocument, operation);
    } catch (error) {
      if (operation === operationRef.current) {
        setStatus({ kind: "error", message: messageFromError(error) });
      }
    }
  }, [commitDocument]);

  const openIncomingUrl = useCallback(async (url: string): Promise<void> => {
    await runDocumentLoad("Opening Markdown...", () =>
      loadMarkdownFromIncomingUrl(url, { githubToken: getGitHubToken() })
    );
  }, [getGitHubToken, runDocumentLoad]);

  useEffect(() => {
    if (!credentialsReady) {
      return;
    }

    let mounted = true;
    const restoreOperation = ++operationRef.current;

    void Promise.all([
      loadLastDocument(),
      loadRecentDocuments(),
      Linking.getInitialURL()
    ]).then(async ([lastDocument, storedRecentDocuments, initialUrl]) => {
      if (!mounted || restoreOperation !== operationRef.current) {
        return;
      }

      setRecentDocuments(storedRecentDocuments);

      if (lastDocument) {
        setDocument(lastDocument);
        setUrlInput(lastDocument.source === "remote" ? lastDocument.origin : "");
      }

      if (initialUrl) {
        await openIncomingUrl(initialUrl);
      }
    }).catch(() => {
      if (mounted && restoreOperation === operationRef.current) {
        setStatus({ kind: "idle" });
      }
    });

    const subscription = Linking.addEventListener("url", (event) => {
      void openIncomingUrl(event.url);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [credentialsReady, openIncomingUrl]);

  async function pickLocal(): Promise<void> {
    await runDocumentLoad("Opening local document...", pickMarkdownDocument);
  }

  async function loadRemote(url = urlInput): Promise<void> {
    Keyboard.dismiss();
    await runDocumentLoad("Loading Markdown link...", () =>
      loadRemoteMarkdown(url, { githubToken: getGitHubToken() })
    );
  }

  async function refresh(): Promise<void> {
    if (document?.source === "remote") {
      await loadRemote(document.origin);
    }
  }

  async function share(): Promise<void> {
    if (!document) {
      return;
    }

    await Share.share({
      message: document.source === "remote" ? document.origin : document.title,
      title: document.title
    });
  }

  async function clearRecents(): Promise<void> {
    operationRef.current += 1;
    await clearDocumentSnapshots();
    setRecentDocuments([]);
    setDocument(undefined);
    setStatus({ kind: "idle" });
    setUrlInput("");
  }

  async function selectRecent(nextDocument: MarkdownDocument): Promise<void> {
    const operation = ++operationRef.current;
    await commitDocument(nextDocument, operation);
  }

  const documentStatus = useMemo(() => {
    if (!document) {
      return "Ready to open Markdown";
    }

    const sourceLabel = document.source === "remote" ? "Link" : "Local";
    return `${sourceLabel} - ${document.markdown.length.toLocaleString()} characters`;
  }, [document]);

  return {
    document,
    documentStatus,
    isLoading: status.kind === "loading",
    readerMode,
    recentDocuments,
    status,
    urlInput,
    clearRecents,
    loadRemote,
    openIncomingUrl,
    pickLocal,
    refresh,
    selectRecent,
    setReaderMode,
    setUrlInput,
    share
  };
}
