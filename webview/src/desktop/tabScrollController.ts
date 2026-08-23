export interface DesktopScrollPort {
  getScrollElement(): HTMLElement | null;
}

interface DesktopScrollPosition {
  readonly left: number;
  readonly top: number;
}

export interface DesktopTabScrollController {
  clear(): void;
  dispose(): void;
  forget(tabId: string): void;
  relocate(previousTabId: string, nextTabId: string): void;
  remember(tabId: string | undefined): void;
  restore(tabId: string, isActive: () => boolean): void;
}

export function createDesktopTabScrollController(
  port: DesktopScrollPort
): DesktopTabScrollController {
  const positions = new Map<string, DesktopScrollPosition>();
  let restoreFrames: number[] = [];

  const cancelRestore = () => {
    for (const frame of restoreFrames) {
      window.cancelAnimationFrame(frame);
    }

    restoreFrames = [];
  };

  return {
    clear(): void {
      cancelRestore();
      positions.clear();
    },
    dispose: cancelRestore,
    forget(tabId): void {
      positions.delete(tabId);
    },
    relocate(previousTabId, nextTabId): void {
      const position = positions.get(previousTabId);

      if (!position) {
        return;
      }

      positions.delete(previousTabId);
      positions.set(nextTabId, position);
    },
    remember(tabId): void {
      const scrollElement = port.getScrollElement();

      if (!tabId || !scrollElement) {
        return;
      }

      positions.set(tabId, {
        left: scrollElement.scrollLeft,
        top: scrollElement.scrollTop
      });
    },
    restore(tabId, isActive): void {
      cancelRestore();
      const firstFrame = window.requestAnimationFrame(() => {
        const secondFrame = window.requestAnimationFrame(() => {
          restoreFrames = [];

          if (!isActive()) {
            return;
          }

          const scrollElement = port.getScrollElement();
          const position = positions.get(tabId) ?? { left: 0, top: 0 };

          if (scrollElement) {
            scrollElement.scrollLeft = position.left;
            scrollElement.scrollTop = position.top;
          }
        });

        restoreFrames.push(secondFrame);
      });

      restoreFrames.push(firstFrame);
    }
  };
}
