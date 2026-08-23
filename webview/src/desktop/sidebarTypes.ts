import type {
  DesktopEntryMutationResult,
  DesktopFileTarget,
  DesktopFolderEntry,
  DesktopFolderRoot,
  MarkflowDesktopApi
} from "./contracts";

export interface DesktopSidebarProps {
  readonly api?: MarkflowDesktopApi;
  readonly activeTarget?: DesktopFileTarget;
  readonly onBeforeChooseFolder?: () => void | Promise<void>;
  readonly onBeforeCreate?: () => void | Promise<void>;
  readonly onBeforeMutate?: () => void | Promise<void>;
  readonly onEntryDeleted?: (rootId: string, entry: DesktopFolderEntry) => void;
  readonly onEntryRelocated?: (
    rootId: string,
    result: DesktopEntryMutationResult
  ) => void | Promise<void>;
  readonly onFolderChanged?: (root: DesktopFolderRoot) => void;
  readonly onOpenMarkdown: (target: DesktopFileTarget) => void | Promise<void>;
  readonly onOpenMedia: (target: DesktopFileTarget) => void | Promise<void>;
  readonly onError?: (error: Error) => void;
}

export type DesktopSidebarControllerOptions = Omit<DesktopSidebarProps, "api"> & {
  readonly api: MarkflowDesktopApi | undefined;
};
