import type { FormEvent, JSX } from "react";

import type { DesktopFolderEntry } from "./contracts";

export type DesktopCreateMode = "file" | "folder";

export interface DesktopCreateFormProps {
  readonly mode: DesktopCreateMode;
  readonly name: string;
  readonly selectedDirectoryLabel: string;
  readonly selectedDirectoryPath: string;
  readonly submitting: boolean;
  readonly onCancel: () => void;
  readonly onNameChange: (name: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function DesktopCreateForm({
  mode,
  name,
  selectedDirectoryLabel,
  selectedDirectoryPath,
  submitting,
  onCancel,
  onNameChange,
  onSubmit
}: DesktopCreateFormProps): JSX.Element {
  return (
    <form className="desktop-sidebar__create-form" onSubmit={onSubmit}>
      <label htmlFor="desktop-sidebar-create-name">
        <strong>{mode === "file" ? "New Markdown file" : "New folder"}</strong>
        <span title={selectedDirectoryPath}>in {selectedDirectoryLabel}</span>
      </label>
      <input
        id="desktop-sidebar-create-name"
        autoFocus
        disabled={submitting}
        onChange={(event) => onNameChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder={mode === "file" ? "notes.md" : "Folder name"}
        spellCheck={false}
        value={name}
      />
      <div>
        <button disabled={submitting || name.trim().length === 0} type="submit">
          {submitting ? "Creating…" : "Create"}
        </button>
        <button disabled={submitting} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}

export interface DesktopRenameFormProps {
  readonly name: string;
  readonly submitting: boolean;
  readonly target: DesktopFolderEntry;
  readonly onCancel: () => void;
  readonly onNameChange: (name: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function DesktopRenameForm({
  name,
  submitting,
  target,
  onCancel,
  onNameChange,
  onSubmit
}: DesktopRenameFormProps): JSX.Element {
  return (
    <form className="desktop-sidebar__create-form" onSubmit={onSubmit}>
      <label htmlFor="desktop-sidebar-rename-name">
        <strong>Rename {target.kind === "directory" ? "folder" : "file"}</strong>
        <span title={target.relativePath}>{target.relativePath}</span>
      </label>
      <input
        id="desktop-sidebar-rename-name"
        autoFocus
        disabled={submitting}
        onChange={(event) => onNameChange(event.currentTarget.value)}
        onFocus={(event) => {
          const extensionIndex = target.kind === "directory" ? -1 : target.name.lastIndexOf(".");
          event.currentTarget.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : target.name.length);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        spellCheck={false}
        value={name}
      />
      <div>
        <button disabled={submitting || name.trim().length === 0} type="submit">
          {submitting ? "Renaming…" : "Rename"}
        </button>
        <button disabled={submitting} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}
