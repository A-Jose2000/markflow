import { useCallback, useEffect, useRef, useState } from "react";

import { clearGitHubToken, loadGitHubToken, saveGitHubToken } from "../storage/githubAuth";
import type { LoadStatus } from "../types";
import { messageFromError } from "../utils/errors";
import { validateGitHubToken } from "../utils/githubAuth";

export interface GitHubCredentialsSession {
  readonly input: string;
  readonly panelOpen: boolean;
  readonly ready: boolean;
  readonly status: LoadStatus;
  readonly token?: string;
  clear(): Promise<void>;
  getToken(): string | undefined;
  save(): Promise<void>;
  setInput(value: string): void;
  togglePanel(): void;
}

export function useGitHubCredentials(): GitHubCredentialsSession {
  const tokenRef = useRef<string | undefined>(undefined);
  const operationRef = useRef(0);
  const [token, setToken] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<LoadStatus>({ kind: "idle" });

  useEffect(() => {
    let disposed = false;

    void loadGitHubToken()
      .then((storedToken) => {
        if (!disposed) {
          tokenRef.current = storedToken;
          setToken(storedToken);
        }
      })
      .catch(() => {
        if (!disposed) {
          tokenRef.current = undefined;
          setToken(undefined);
        }
      })
      .finally(() => {
        if (!disposed) {
          setReady(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  const getToken = useCallback(() => tokenRef.current, []);

  async function save(): Promise<void> {
    const trimmedToken = input.trim();

    if (!trimmedToken) {
      setStatus({ kind: "error", message: "Paste a GitHub token first." });
      return;
    }

    const operation = ++operationRef.current;
    setStatus({ kind: "loading", message: "Validating GitHub token..." });

    try {
      const validation = await validateGitHubToken(trimmedToken);
      await saveGitHubToken(trimmedToken);

      if (operation !== operationRef.current) {
        return;
      }

      tokenRef.current = trimmedToken;
      setToken(trimmedToken);
      setInput("");
      setPanelOpen(false);
      setStatus({ kind: "success", message: `GitHub token saved for @${validation.login}.` });
    } catch (error) {
      if (operation === operationRef.current) {
        setStatus({ kind: "error", message: messageFromError(error) });
      }
    }
  }

  async function clear(): Promise<void> {
    const operation = ++operationRef.current;
    setStatus({ kind: "loading", message: "Clearing GitHub token..." });

    try {
      await clearGitHubToken();

      if (operation !== operationRef.current) {
        return;
      }

      tokenRef.current = undefined;
      setToken(undefined);
      setInput("");
      setStatus({ kind: "success", message: "GitHub token cleared." });
    } catch (error) {
      if (operation === operationRef.current) {
        setStatus({ kind: "error", message: messageFromError(error) });
      }
    }
  }

  return {
    input,
    panelOpen,
    ready,
    status,
    token,
    clear,
    getToken,
    save,
    setInput,
    togglePanel: () => setPanelOpen((open) => !open)
  };
}
