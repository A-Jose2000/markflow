export type DesktopMediaKind = "image" | "audio" | "video" | "pdf";
export type DesktopFileKind = "markdown" | DesktopMediaKind;

export interface DesktopFolderRoot {
  readonly id: string;
  readonly name: string;
  readonly displayPath: string;
}

export interface DesktopDirectoryEntry {
  readonly kind: "directory";
  readonly name: string;
  readonly relativePath: string;
}

export interface DesktopFileEntry {
  readonly kind: DesktopFileKind;
  readonly name: string;
  readonly relativePath: string;
  readonly mimeType: string;
}

export type DesktopFolderEntry = DesktopDirectoryEntry | DesktopFileEntry;

export interface DesktopFileTarget {
  readonly rootId: string;
  readonly name: string;
  readonly relativePath: string;
  readonly kind: DesktopFileKind;
  readonly mimeType: string;
}

export interface DesktopPathRequest {
  readonly rootId: string;
  readonly relativePath: string;
}

export interface DesktopCreateEntryRequest {
  readonly rootId: string;
  readonly parentRelativePath: string;
  readonly name: string;
}

export interface DesktopDroppedFilesRequest {
  readonly rootId: string;
  readonly parentRelativePath: string;
}

export interface DesktopImportResult {
  readonly imported: DesktopFileEntry[];
  readonly rejected: string[];
}

export interface DesktopMoveEntryRequest {
  readonly rootId: string;
  readonly sourceRelativePath: string;
  readonly destinationParentRelativePath: string;
}

export interface DesktopRenameEntryRequest {
  readonly rootId: string;
  readonly relativePath: string;
  readonly name: string;
}

export interface DesktopEntryMutationResult {
  readonly changed: boolean;
  readonly previousRelativePath: string;
  readonly entry: DesktopFolderEntry;
}

export interface DesktopTrashResult {
  readonly relativePath: string;
  readonly name: string;
}

export interface DesktopMarkdownDocument {
  readonly rootId: string;
  readonly relativePath: string;
  readonly name: string;
  readonly displayPath: string;
  readonly markdown: string;
  readonly revision: string;
  readonly eol: "lf" | "crlf";
  readonly hasBom: boolean;
}

export interface DesktopMediaDocument {
  readonly rootId: string;
  readonly relativePath: string;
  readonly name: string;
  readonly displayPath: string;
  readonly kind: DesktopMediaKind;
  readonly mimeType: string;
  readonly url: string;
}

export interface DesktopAutosaveRequest extends DesktopPathRequest {
  readonly markdown: string;
  readonly expectedRevision: string;
}

export interface DesktopSaveSuccess {
  readonly ok: true;
  readonly revision: string;
  readonly savedAt: string;
}

export interface DesktopSaveFailure {
  readonly ok: false;
  readonly code:
    | "no_current_document"
    | "stale_document"
    | "conflict"
    | "invalid_markdown"
    | "io_error";
  readonly message: string;
  readonly diskRevision?: string;
}

export type DesktopSaveResult = DesktopSaveSuccess | DesktopSaveFailure;

export interface DesktopCloseRequest {
  readonly requestId: string;
}

export type DesktopCloseResult =
  | { readonly requestId: string; readonly ok: true }
  | { readonly requestId: string; readonly ok: false; readonly message: string };

export interface MarkflowDesktopApi {
  chooseFolder(): Promise<DesktopFolderRoot | null>;
  listDirectory(request: DesktopPathRequest): Promise<DesktopFolderEntry[]>;
  createMarkdownFile(request: DesktopCreateEntryRequest): Promise<DesktopFileEntry>;
  createFolder(request: DesktopCreateEntryRequest): Promise<DesktopDirectoryEntry>;
  importDroppedFiles(request: DesktopDroppedFilesRequest, files: File[]): Promise<DesktopImportResult>;
  moveEntry(request: DesktopMoveEntryRequest): Promise<DesktopEntryMutationResult>;
  renameEntry(request: DesktopRenameEntryRequest): Promise<DesktopEntryMutationResult>;
  trashEntry(request: DesktopPathRequest): Promise<DesktopTrashResult>;
  openMarkdown(request: DesktopPathRequest): Promise<DesktopMarkdownDocument>;
  openMedia(request: DesktopPathRequest): Promise<DesktopMediaDocument>;
  autosaveCurrentMarkdown(request: DesktopAutosaveRequest): Promise<DesktopSaveResult>;
  onBeforeClose(listener: (request: DesktopCloseRequest) => void): () => void;
  completeClose(result: DesktopCloseResult): Promise<void>;
}
