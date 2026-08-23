import { useEffect, useRef } from "react";

import type {
  DesktopSaveResult,
  MarkflowDesktopApi
} from "./contracts";

export interface UseDesktopCloseHandshakeOptions {
  readonly api: MarkflowDesktopApi | undefined;
  readonly flush: () => Promise<DesktopSaveResult | undefined>;
  readonly hasPendingChanges: () => boolean;
  readonly normalizeError: (error: unknown) => string;
  readonly onError: (message: string) => void;
  readonly onSaved: () => void;
  readonly onSaving: () => void;
}

export function useDesktopCloseHandshake(options: UseDesktopCloseHandshakeOptions): void {
  const activeRequestRef = useRef<string | undefined>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!options.api) {
      return;
    }

    return options.api.onBeforeClose((request) => {
      if (activeRequestRef.current) {
        return;
      }

      activeRequestRef.current = request.requestId;

      void (async () => {
        const current = optionsRef.current;
        let completion:
          | { requestId: string; ok: true }
          | { requestId: string; ok: false; message: string };

        try {
          if (current.hasPendingChanges()) {
            current.onSaving();
          }

          const result = await current.flush();

          if (result && !result.ok) {
            current.onError(result.message);
            completion = {
              requestId: request.requestId,
              ok: false,
              message: result.message.slice(0, 1_000) || "Markflow could not save pending changes."
            };
          } else {
            current.onSaved();
            completion = { requestId: request.requestId, ok: true };
          }
        } catch (error) {
          const message = current.normalizeError(error);
          current.onError(message);
          completion = {
            requestId: request.requestId,
            ok: false,
            message: message.slice(0, 1_000) || "Markflow could not save pending changes."
          };
        }

        try {
          await current.api?.completeClose(completion);
        } catch (error) {
          console.error("Markflow Desktop could not complete the close handshake.", error);
        } finally {
          if (activeRequestRef.current === request.requestId) {
            activeRequestRef.current = undefined;
          }
        }
      })();
    });
  }, [options.api]);
}
