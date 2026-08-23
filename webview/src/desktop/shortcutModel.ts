export type DesktopShortcutAction =
  | { readonly type: "save" }
  | { readonly type: "close-active-tab" }
  | { readonly type: "cycle-tab"; readonly direction: -1 | 1 };

export interface DesktopShortcutInput {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export function resolveDesktopShortcut(
  input: DesktopShortcutInput
): DesktopShortcutAction | undefined {
  if ((!input.ctrlKey && !input.metaKey) || input.altKey) {
    return undefined;
  }

  switch (input.key.toLocaleLowerCase()) {
    case "s":
      return { type: "save" };
    case "w":
      return { type: "close-active-tab" };
    case "tab":
      return input.ctrlKey
        ? { type: "cycle-tab", direction: input.shiftKey ? -1 : 1 }
        : undefined;
    default:
      return undefined;
  }
}
