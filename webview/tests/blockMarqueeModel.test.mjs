import assert from "node:assert/strict";
import test from "node:test";

import {
  getMarqueeBounds,
  hasMarqueeMoved
} from "../src/blockMarqueeModel.ts";

const viewport = { left: 10, top: 20, right: 110, bottom: 120 };

test("marquee bounds clamp the pointer and preserve reverse drags", () => {
  assert.deepEqual(
    getMarqueeBounds({ x: 80, y: 90 }, { x: -5, y: 150 }, viewport),
    {
      bottom: 120,
      currentX: 10,
      currentY: 120,
      left: 10,
      right: 80,
      top: 90
    }
  );
});

test("marquee movement begins at the four-pixel threshold", () => {
  assert.equal(hasMarqueeMoved({ x: 0, y: 0 }, { x: 3, y: 0 }), false);
  assert.equal(hasMarqueeMoved({ x: 0, y: 0 }, { x: 0, y: 4 }), true);
  assert.equal(hasMarqueeMoved({ x: 0, y: 0 }, { x: 3, y: 4 }), true);
});
