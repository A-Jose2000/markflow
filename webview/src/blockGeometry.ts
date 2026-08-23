import type { LexicalEditor } from "lexical";

import type {
  LogicalBlockTree,
  LogicalBlockUnit
} from "./blockLogicalTree";

export const BLOCK_HANDLE_HEIGHT = 20;
export const BLOCK_NESTING_INDENT_WIDTH = 40;

export function getBrowserCaretRect(): DOMRect | undefined {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(false);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();

  return rect.width > 0 || rect.height > 0 ? rect : undefined;
}

export function clampMenuLeft(left: number, layerWidth: number): number {
  const estimatedMenuWidth = Math.min(320, Math.max(0, window.innerWidth - 32));
  return Math.max(8, Math.min(left, Math.max(8, layerWidth - estimatedMenuWidth - 8)));
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

export function getMenuTop(anchorRect: DOMRect): number {
  const viewportGap = 8;
  const estimatedMenuHeight = Math.min(400, Math.max(0, window.innerHeight - viewportGap * 2));
  const belowTop = anchorRect.bottom + viewportGap;
  const aboveTop = anchorRect.top - viewportGap - estimatedMenuHeight;

  if (window.innerHeight - belowTop >= estimatedMenuHeight) {
    return belowTop;
  }

  if (aboveTop >= viewportGap) {
    return aboveTop;
  }

  const spaceBelow = window.innerHeight - belowTop;
  const spaceAbove = anchorRect.top - viewportGap;
  return spaceBelow >= spaceAbove
    ? Math.max(viewportGap, window.innerHeight - estimatedMenuHeight - viewportGap)
    : viewportGap;
}

export function getLogicalBlockUnitRect(
  editor: LexicalEditor,
  tree: LogicalBlockTree,
  unit: LogicalBlockUnit
): DOMRect | undefined {
  const rects = unit.nodeKeys.flatMap((key): DOMRect[] => {
    const element = editor.getElementByKey(key);
    return element && !element.hidden ? [getIndentedBlockRect(element, tree.units.get(key))] : [];
  });
  const childScope = tree.scopes.get(unit.key);

  for (const child of unit.toggle === "closed" ? [] : childScope?.units ?? []) {
    const childRect = getLogicalBlockUnitRect(editor, tree, child);

    if (childRect) {
      rects.push(childRect);
    }
  }

  const rect = unionClientRects(rects);

  if (!rect || unit.kind !== "list-item") {
    return rect;
  }

  const rowElement = editor.getElementByKey(unit.rowKey);
  const listElement = rowElement?.parentElement;

  if (listElement?.tagName !== "UL" && listElement?.tagName !== "OL") {
    return rect;
  }

  const listRect = listElement.getBoundingClientRect();
  const left = Math.min(rect.left, listRect.left);
  return new DOMRect(left, rect.top, rect.right - left, rect.height);
}

export function getFirstLineRect(element: HTMLElement, fallbackRect: DOMRect): DOMRect {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();

  while (textNode) {
    if (textNode.textContent?.trim()) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = Array.from(range.getClientRects()).find(
        (candidate) =>
          candidate.height > 0 &&
          candidate.bottom > fallbackRect.top &&
          candidate.top < fallbackRect.bottom
      );

      if (rect) {
        return rect;
      }
    }

    textNode = walker.nextNode();
  }

  const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight) || fallbackRect.height;
  return new DOMRect(fallbackRect.left, fallbackRect.top, fallbackRect.width, Math.min(fallbackRect.height, lineHeight));
}

export function getOuterBlockFirstLineRect(element: HTMLElement, fallbackRect: DOMRect): DOMRect {
  const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight) || BLOCK_HANDLE_HEIGHT;
  return new DOMRect(
    fallbackRect.left,
    fallbackRect.top,
    fallbackRect.width,
    Math.min(fallbackRect.height, Math.max(BLOCK_HANDLE_HEIGHT, lineHeight))
  );
}

export function getBlockControlAnchorLeft(element: HTMLElement, fallbackRect: DOMRect): number {
  const quote = element.closest("blockquote");

  if (quote) {
    if (element.tagName !== "LI") {
      const quoteRect = quote.getBoundingClientRect();
      const quotePadding = Number.parseFloat(window.getComputedStyle(quote).paddingInlineStart) || 0;
      return quoteRect.left + quotePadding;
    }

    const lists: HTMLElement[] = [];
    let ancestor = element.parentElement;

    while (ancestor && ancestor !== quote) {
      if (ancestor.tagName === "UL" || ancestor.tagName === "OL") {
        lists.push(ancestor);
      }

      ancestor = ancestor.parentElement;
    }

    const innerListRect = lists[0]?.getBoundingClientRect();
    const outerListRect = lists.at(-1)?.getBoundingClientRect();

    if (innerListRect && outerListRect) {
      return quote.getBoundingClientRect().left + Math.max(0, innerListRect.left - outerListRect.left);
    }

    return quote.getBoundingClientRect().left;
  }

  if (element.tagName === "LI") {
    if (element.dataset.markflowOutlineOffset === "true") {
      return fallbackRect.left;
    }

    const list = element.parentElement;

    if (list?.tagName === "UL" || list?.tagName === "OL") {
      return list.getBoundingClientRect().left;
    }
  }

  return fallbackRect.left;
}

export function getBlockNestingIndentWidth(root: HTMLElement | null): number {
  if (!root) {
    return BLOCK_NESTING_INDENT_WIDTH;
  }

  return Number.parseFloat(
    window.getComputedStyle(root).getPropertyValue("--markflow-block-indent-width")
  ) || BLOCK_NESTING_INDENT_WIDTH;
}

export function getEditorContentHorizontalBounds(
  root: HTMLElement,
  rect = root.getBoundingClientRect()
): { left: number; right: number } {
  const style = window.getComputedStyle(root);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  return {
    left: rect.left + paddingLeft,
    right: rect.right - paddingRight
  };
}

export function getVisualBlockRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();

  if (element.tagName !== "LI") {
    return rect;
  }

  const nestedList = Array.from(element.children).find(
    (child): child is HTMLElement => child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL")
  );

  if (!nestedList) {
    return rect;
  }

  const nestedRect = nestedList.getBoundingClientRect();
  return new DOMRect(rect.left, rect.top, rect.width, Math.max(1, nestedRect.top - rect.top));
}

export function distanceFromYToRect(y: number, rect: DOMRect): number {
  if (y < rect.top) {
    return rect.top - y;
  }

  if (y > rect.bottom) {
    return y - rect.bottom;
  }

  return 0;
}

function getIndentedBlockRect(
  element: HTMLElement,
  unit: LogicalBlockUnit | undefined
): DOMRect {
  const rect = element.getBoundingClientRect();

  if (!unit?.outlineUsesElementIndent || !unit.outlineDepth) {
    return rect;
  }

  const padding = Number.parseFloat(window.getComputedStyle(element).paddingInlineStart) || 0;
  return new DOMRect(rect.left + padding, rect.top, Math.max(0, rect.width - padding), rect.height);
}

function unionClientRects(rects: DOMRect[]): DOMRect | undefined {
  if (rects.length === 0) {
    return undefined;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}
