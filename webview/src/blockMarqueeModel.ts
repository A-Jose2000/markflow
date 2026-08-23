export interface MarqueePoint {
  x: number;
  y: number;
}

export interface MarqueeViewport {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface MarqueeBounds {
  bottom: number;
  currentX: number;
  currentY: number;
  left: number;
  right: number;
  top: number;
}

export function getMarqueeBounds(
  start: MarqueePoint,
  pointer: MarqueePoint,
  viewport: MarqueeViewport
): MarqueeBounds {
  const currentX = clamp(pointer.x, viewport.left, viewport.right);
  const currentY = clamp(pointer.y, viewport.top, viewport.bottom);

  return {
    bottom: Math.max(start.y, currentY),
    currentX,
    currentY,
    left: Math.min(start.x, currentX),
    right: Math.max(start.x, currentX),
    top: Math.min(start.y, currentY)
  };
}

export function hasMarqueeMoved(
  start: MarqueePoint,
  current: MarqueePoint,
  threshold = 4
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
