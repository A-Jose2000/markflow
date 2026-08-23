"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PublicError } = require("../publicErrors.cjs");
const { createCloseCoordinator } = require("../main-process/closeCoordinator.cjs");

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

function createWindow(ownerId = 17) {
  const sent = [];
  const calls = { close: 0, focus: 0, show: 0 };
  const window = {
    webContents: {
      id: ownerId,
      send(channel, payload) {
        sent.push({ channel, payload });
      }
    },
    close() { calls.close += 1; },
    focus() { calls.focus += 1; },
    isDestroyed() { return false; },
    show() { calls.show += 1; }
  };
  return { calls, sent, window };
}

test("a successful final save permits exactly the follow-up window close", async () => {
  const deferred = [];
  const { calls, sent, window } = createWindow();
  const coordinator = createCloseCoordinator({
    beforeCloseChannel: "desktop:before-close",
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    randomId: () => REQUEST_ID,
    scheduleTimeout: () => "timer",
    cancelTimeout: () => undefined,
    defer: (callback) => deferred.push(callback)
  });
  let prevented = 0;

  coordinator.handleWindowClose(window, { preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 1);
  assert.deepEqual(sent, [{
    channel: "desktop:before-close",
    payload: { requestId: REQUEST_ID }
  }]);

  await coordinator.complete({ sender: { id: 17 } }, { requestId: REQUEST_ID, ok: true });
  assert.equal(calls.close, 0);
  deferred.shift()();
  assert.equal(calls.close, 1);

  coordinator.handleWindowClose(window, { preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 1);
});

test("keeping the editor open clears the failed close request and restores focus", async () => {
  const { calls, sent, window } = createWindow();
  const coordinator = createCloseCoordinator({
    beforeCloseChannel: "desktop:before-close",
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    randomId: () => REQUEST_ID,
    scheduleTimeout: () => "timer",
    cancelTimeout: () => undefined
  });

  coordinator.handleWindowClose(window, { preventDefault() {} });
  await coordinator.complete(
    { sender: { id: 17 } },
    { requestId: REQUEST_ID, ok: false, message: "Disk full" }
  );

  assert.deepEqual(calls, { close: 0, focus: 1, show: 1 });
  coordinator.handleWindowClose(window, { preventDefault() {} });
  assert.equal(sent.length, 2);
});

test("a stale renderer response cannot complete another close request", async () => {
  const { window } = createWindow();
  const coordinator = createCloseCoordinator({
    beforeCloseChannel: "desktop:before-close",
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    randomId: () => REQUEST_ID,
    scheduleTimeout: () => "timer",
    cancelTimeout: () => undefined
  });
  coordinator.handleWindowClose(window, { preventDefault() {} });

  await assert.rejects(
    coordinator.complete(
      { sender: { id: 17 } },
      { requestId: "123e4567-e89b-42d3-a456-426614174001", ok: true }
    ),
    (error) => error instanceof PublicError && error.code === "INVALID_CLOSE_REQUEST"
  );
});
