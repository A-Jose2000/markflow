import { useEffect, useRef } from "react";

import { resolveDesktopShortcut } from "./shortcutModel";

export interface UseDesktopShortcutsOptions {
  readonly enabled: boolean;
  readonly onCloseActiveTab: () => boolean;
  readonly onCycleTab: (direction: -1 | 1) => boolean;
  readonly onSave: () => void;
}

export function useDesktopShortcuts(options: UseDesktopShortcutsOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveDesktopShortcut(event);

      if (!action) {
        return;
      }

      const current = optionsRef.current;
      let handled = true;

      switch (action.type) {
        case "save":
          current.onSave();
          break;
        case "close-active-tab":
          handled = current.onCloseActiveTab();
          break;
        case "cycle-tab":
          handled = current.onCycleTab(action.direction);
          break;
      }

      if (handled) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [options.enabled]);
}
