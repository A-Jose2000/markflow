"use strict";

class PublicError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicError";
    this.code = code;
  }
}

function publicMessage(error, fallback) {
  return error instanceof PublicError ? error.message : fallback;
}

function hasFileSystemErrorCode(error, code) {
  return Boolean(error && typeof error === "object" && error.code === code);
}

module.exports = {
  PublicError,
  hasFileSystemErrorCode,
  publicMessage
};
