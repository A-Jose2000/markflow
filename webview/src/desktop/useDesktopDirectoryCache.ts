import { useRef, useState } from "react";

import type {
  DesktopEntryMutationResult,
  DesktopFolderEntry,
  DesktopFolderRoot,
  MarkflowDesktopApi
} from "../desktopApi";
import { getDesktopParentPath, isDesktopPathWithinOrEqual } from "./pathModel";

export type DesktopExplorerDirectoryLoadStatus = "idle" | "loading" | "loaded" | "error";

export interface DesktopExplorerDirectoryState {
  readonly expanded: boolean;
  readonly status: DesktopExplorerDirectoryLoadStatus;
  readonly entries: DesktopFolderEntry[];
  readonly error?: string;
}

export interface UseDesktopDirectoryCacheOptions {
  readonly api?: Pick<MarkflowDesktopApi, "listDirectory">;
  readonly onLoadStart: () => void;
  readonly onError: (error: unknown) => void;
}

export interface UseDesktopDirectoryCacheResult {
  readonly root?: DesktopFolderRoot;
  readonly directories: Readonly<Record<string, DesktopExplorerDirectoryState>>;
  readonly activateRoot: (root: DesktopFolderRoot) => void;
  readonly loadDirectory: (rootId: string, relativePath: string) => Promise<void>;
  readonly primeEmptyDirectory: (relativePath: string) => void;
  readonly refreshAfterMutation: (result: DesktopEntryMutationResult) => Promise<void>;
  readonly refreshRoot: () => void;
  readonly removeCachedDirectorySubtree: (relativePath: string) => void;
  readonly toggleDirectory: (relativePath: string) => void;
}

export function useDesktopDirectoryCache({
  api,
  onLoadStart,
  onError
}: UseDesktopDirectoryCacheOptions): UseDesktopDirectoryCacheResult {
  const activeRootIdRef = useRef<string | undefined>(undefined);
  const [root, setRoot] = useState<DesktopFolderRoot | undefined>();
  const [directories, setDirectories] = useState<Record<string, DesktopExplorerDirectoryState>>({});

  async function loadDirectory(rootId: string, relativePath: string): Promise<void> {
    if (!api) {
      return;
    }

    onLoadStart();
    setDirectories((current) => ({
      ...current,
      [relativePath]: {
        expanded: true,
        status: "loading",
        entries: current[relativePath]?.entries ?? []
      }
    }));

    try {
      const entries = await api.listDirectory({ rootId, relativePath });

      if (activeRootIdRef.current !== rootId) {
        return;
      }

      setDirectories((current) => ({
        ...current,
        [relativePath]: {
          expanded: current[relativePath]?.expanded ?? true,
          status: "loaded",
          entries
        }
      }));
    } catch (error) {
      if (activeRootIdRef.current !== rootId) {
        return;
      }

      const message = error instanceof Error ? error.message : "This folder could not be read.";
      setDirectories((current) => ({
        ...current,
        [relativePath]: {
          expanded: true,
          status: "error",
          entries: current[relativePath]?.entries ?? [],
          error: message
        }
      }));
      onError(error);
    }
  }

  function activateRoot(nextRoot: DesktopFolderRoot): void {
    activeRootIdRef.current = nextRoot.id;
    setRoot(nextRoot);
    setDirectories({
      "": {
        expanded: true,
        status: "loading",
        entries: []
      }
    });
  }

  function toggleDirectory(relativePath: string): void {
    if (!root) {
      return;
    }

    const state = directories[relativePath];

    if (state?.expanded) {
      setDirectories((current) => ({
        ...current,
        [relativePath]: {
          ...state,
          expanded: false
        }
      }));
      return;
    }

    if (state?.status === "loaded") {
      setDirectories((current) => ({
        ...current,
        [relativePath]: {
          ...state,
          expanded: true
        }
      }));
      return;
    }

    void loadDirectory(root.id, relativePath);
  }

  function refreshRoot(): void {
    if (!root) {
      return;
    }

    setDirectories({
      "": {
        expanded: true,
        status: "loading",
        entries: []
      }
    });
    void loadDirectory(root.id, "");
  }

  function primeEmptyDirectory(relativePath: string): void {
    setDirectories((current) => ({
      ...current,
      [relativePath]: {
        expanded: true,
        status: "loaded",
        entries: []
      }
    }));
  }

  function removeCachedDirectorySubtree(relativePath: string): void {
    setDirectories((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([cachedPath]) => !isDesktopPathWithinOrEqual(relativePath, cachedPath))
      )
    );
  }

  async function refreshAfterMutation(result: DesktopEntryMutationResult): Promise<void> {
    if (!root || !result.changed) {
      return;
    }

    removeCachedDirectorySubtree(result.previousRelativePath);
    const parentPaths = new Set([
      getDesktopParentPath(result.previousRelativePath),
      getDesktopParentPath(result.entry.relativePath)
    ]);
    await Promise.all(Array.from(parentPaths, (relativePath) => loadDirectory(root.id, relativePath)));
  }

  return {
    root,
    directories,
    activateRoot,
    loadDirectory,
    primeEmptyDirectory,
    refreshAfterMutation,
    refreshRoot,
    removeCachedDirectorySubtree,
    toggleDirectory
  };
}
