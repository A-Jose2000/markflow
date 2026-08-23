import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import type { DesktopFileTarget } from "./desktopApi";
import { desktopTabId } from "./desktop/tabModel";

export { desktopTabId } from "./desktop/tabModel";

const TAB_DRAG_THRESHOLD = 5;

export interface DesktopTabsProps {
  readonly activeTabId?: string;
  readonly disabled?: boolean;
  readonly tabs: readonly DesktopFileTarget[];
  readonly onActivate: (target: DesktopFileTarget) => void;
  readonly onClose: (tabId: string) => void;
  readonly onReorder: (sourceTabId: string, insertionIndex: number) => void;
}

export function DesktopTabs({
  activeTabId,
  disabled = false,
  tabs,
  onActivate,
  onClose,
  onReorder
}: DesktopTabsProps): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | undefined>();
  const suppressClickRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const activeTab = Array.from(
      scrollerRef.current?.querySelectorAll<HTMLElement>("[data-desktop-tab-id]") ?? []
    ).find((element) => element.dataset.desktopTabId === activeTabId);

    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>, target: DesktopFileTarget): void {
    if (
      disabled ||
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target instanceof Element && event.target.closest(".desktop-tab__close"))
    ) {
      return;
    }

    const sourceTabId = desktopTabId(target);
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;

    const removeListeners = () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("blur", handleWindowBlur);
    };

    const finish = () => {
      removeListeners();

      if (!started) {
        return;
      }

      suppressClickRef.current = sourceTabId;
      window.setTimeout(() => {
        if (suppressClickRef.current === sourceTabId) {
          suppressClickRef.current = undefined;
        }
      }, 0);
      document.body.classList.remove("desktop-tabs-is-dragging");
      setDraggedTabId(undefined);
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      if (!started) {
        const distance = Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY);

        if (distance < TAB_DRAG_THRESHOLD) {
          return;
        }

        started = true;
        document.body.classList.add("desktop-tabs-is-dragging");
        setDraggedTabId(sourceTabId);
      }

      pointerEvent.preventDefault();
      const otherTabs = Array.from(document.querySelectorAll<HTMLElement>("[data-desktop-tab-id]"))
        .filter((element) => element.dataset.desktopTabId !== sourceTabId)
        .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);
      let insertionIndex = otherTabs.length;

      for (let index = 0; index < otherTabs.length; index += 1) {
        const bounds = otherTabs[index].getBoundingClientRect();

        if (pointerEvent.clientX < bounds.left + bounds.width / 2) {
          insertionIndex = index;
          break;
        }
      }

      onReorder(sourceTabId, insertionIndex);
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      if (started) {
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
      }

      finish();
    };

    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === pointerId) {
        finish();
      }
    };

    const handleWindowBlur = () => finish();

    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("blur", handleWindowBlur);
  }

  return (
    <div className="desktop-tabs" aria-label="Open files" role="tablist">
      <div className="desktop-tabs__scroller" ref={scrollerRef}>
        {tabs.map((target) => {
          const tabId = desktopTabId(target);
          const isActive = tabId === activeTabId;

          return (
            <div
              className="desktop-tab"
              data-active={isActive}
              data-desktop-tab-id={tabId}
              data-dragging={draggedTabId === tabId}
              key={tabId}
              onPointerDown={(event) => handlePointerDown(event, target)}
            >
              <button
                aria-selected={isActive}
                className="desktop-tab__activate"
                disabled={disabled}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    onClose(tabId);
                  }
                }}
                onClick={() => {
                  if (suppressClickRef.current !== tabId) {
                    onActivate(target);
                  }
                }}
                role="tab"
                title={target.relativePath}
                type="button"
              >
                <span aria-hidden="true" className={`desktop-tab__kind desktop-tab__kind--${target.kind}`}>
                  {tabKindLabel(target.kind)}
                </span>
                <span className="desktop-tab__name">{target.name}</span>
              </button>
              <button
                aria-label={`Close ${target.name}`}
                className="desktop-tab__close"
                disabled={disabled}
                onClick={() => onClose(tabId)}
                onPointerDown={(event) => event.stopPropagation()}
                title="Close tab"
                type="button"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tabKindLabel(kind: DesktopFileTarget["kind"]): string {
  switch (kind) {
    case "markdown":
      return "M↓";
    case "image":
      return "▧";
    case "audio":
      return "♫";
    case "video":
      return "▶";
    case "pdf":
      return "PDF";
  }
}
