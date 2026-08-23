"use strict";

const { randomUUID } = require("node:crypto");
const { PublicError } = require("../publicErrors.cjs");
const { readCloseResult } = require("../requestValidation.cjs");

const DEFAULT_RESPONSE_TIMEOUT_MS = 15_000;

function createCloseCoordinator({
  beforeCloseChannel,
  dialog,
  logger = console,
  randomId = randomUUID,
  responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
  defer = setImmediate
}) {
  /** @type {Map<number, CloseState>} */
  const pendingByOwner = new Map();

  function handleWindowClose(window, event) {
    const ownerId = window.webContents.id;
    const closeState = pendingByOwner.get(ownerId);

    if (closeState?.status === "allowing") {
      clearOwner(ownerId);
      return;
    }

    event.preventDefault();

    if (!closeState) {
      begin(window, ownerId);
    }
  }

  function begin(window, ownerId) {
    const requestId = randomId();
    /** @type {CloseState} */
    const closeState = {
      ownerId,
      requestId,
      status: "waiting",
      timeout: undefined,
      window
    };

    closeState.timeout = scheduleTimeout(() => {
      const currentState = pendingByOwner.get(ownerId);

      if (currentState === closeState && currentState.status === "waiting") {
        void resolve(closeState, {
          requestId,
          ok: false,
          message: "Markflow timed out while waiting for pending changes to save."
        });
      }
    }, responseTimeoutMs);

    pendingByOwner.set(ownerId, closeState);

    try {
      window.webContents.send(beforeCloseChannel, { requestId });
    } catch (error) {
      logger.error("Markflow Desktop could not request a final autosave.", error);
      void resolve(closeState, {
        requestId,
        ok: false,
        message: "The editor could not be reached to save its pending changes."
      });
    }
  }

  async function complete(event, payload) {
    const result = readCloseResult(payload);
    const closeState = pendingByOwner.get(event.sender.id);

    if (
      !closeState ||
      closeState.status !== "waiting" ||
      closeState.requestId !== result.requestId
    ) {
      throw new PublicError("INVALID_CLOSE_REQUEST", "That close request is no longer active.");
    }

    await resolve(closeState, result);
  }

  async function resolve(closeState, result) {
    if (
      pendingByOwner.get(closeState.ownerId) !== closeState ||
      closeState.status !== "waiting"
    ) {
      return;
    }

    cancelTimeout(closeState.timeout);

    if (result.ok) {
      closeState.status = "allowing";
      closeAfterReply(closeState);
      return;
    }

    closeState.status = "prompting";

    if (closeState.window.isDestroyed()) {
      clearOwner(closeState.ownerId);
      return;
    }

    let response;

    try {
      response = await dialog.showMessageBox(closeState.window, {
        type: "warning",
        title: "Unsaved changes",
        message: "Markflow could not save your latest changes.",
        detail: result.message,
        buttons: ["Keep editing", "Quit without saving"],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
    } catch (error) {
      logger.error("Markflow Desktop could not show the unsaved-changes dialog.", error);
      clearOwner(closeState.ownerId);
      return;
    }

    if (pendingByOwner.get(closeState.ownerId) !== closeState) {
      return;
    }

    if (response.response === 1) {
      closeState.status = "allowing";
      closeAfterReply(closeState);
      return;
    }

    clearOwner(closeState.ownerId);

    if (!closeState.window.isDestroyed()) {
      closeState.window.show();
      closeState.window.focus();
    }
  }

  function handleRendererGone(ownerId) {
    const closeState = pendingByOwner.get(ownerId);

    if (closeState?.status === "waiting") {
      void resolve(closeState, {
        requestId: closeState.requestId,
        ok: false,
        message: "The editor stopped responding before its pending changes could be saved."
      });
    }
  }

  function closeAfterReply(closeState) {
    defer(() => {
      if (
        pendingByOwner.get(closeState.ownerId) === closeState &&
        closeState.status === "allowing" &&
        !closeState.window.isDestroyed()
      ) {
        closeState.window.close();
      }
    });
  }

  function clearOwner(ownerId) {
    const closeState = pendingByOwner.get(ownerId);

    if (closeState) {
      cancelTimeout(closeState.timeout);
      pendingByOwner.delete(ownerId);
    }
  }

  return {
    clearOwner,
    complete,
    handleRendererGone,
    handleWindowClose
  };
}

/**
 * @typedef {object} CloseState
 * @property {number} ownerId
 * @property {string} requestId
 * @property {"waiting" | "prompting" | "allowing"} status
 * @property {*} timeout
 * @property {Electron.BrowserWindow} window
 */

module.exports = {
  DEFAULT_RESPONSE_TIMEOUT_MS,
  createCloseCoordinator
};
