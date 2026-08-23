"use strict";

const path = require("node:path");

const BUNDLED_CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"]
]);

const FILE_TYPES = new Map([
  [".md", { kind: "markdown", mimeType: "text/markdown; charset=utf-8" }],
  [".markdown", { kind: "markdown", mimeType: "text/markdown; charset=utf-8" }],
  [".png", { kind: "image", mimeType: "image/png" }],
  [".jpg", { kind: "image", mimeType: "image/jpeg" }],
  [".jpeg", { kind: "image", mimeType: "image/jpeg" }],
  [".gif", { kind: "image", mimeType: "image/gif" }],
  [".webp", { kind: "image", mimeType: "image/webp" }],
  [".bmp", { kind: "image", mimeType: "image/bmp" }],
  [".avif", { kind: "image", mimeType: "image/avif" }],
  [".ico", { kind: "image", mimeType: "image/x-icon" }],
  [".svg", { kind: "image", mimeType: "image/svg+xml" }],
  [".mp3", { kind: "audio", mimeType: "audio/mpeg" }],
  [".wav", { kind: "audio", mimeType: "audio/wav" }],
  [".ogg", { kind: "audio", mimeType: "audio/ogg" }],
  [".oga", { kind: "audio", mimeType: "audio/ogg" }],
  [".m4a", { kind: "audio", mimeType: "audio/mp4" }],
  [".aac", { kind: "audio", mimeType: "audio/aac" }],
  [".flac", { kind: "audio", mimeType: "audio/flac" }],
  [".opus", { kind: "audio", mimeType: "audio/opus" }],
  [".mp4", { kind: "video", mimeType: "video/mp4" }],
  [".webm", { kind: "video", mimeType: "video/webm" }],
  [".ogv", { kind: "video", mimeType: "video/ogg" }],
  [".mov", { kind: "video", mimeType: "video/quicktime" }],
  [".m4v", { kind: "video", mimeType: "video/x-m4v" }],
  [".pdf", { kind: "pdf", mimeType: "application/pdf" }]
]);

function classifyFile(fileName) {
  return FILE_TYPES.get(path.extname(fileName).toLowerCase());
}

module.exports = {
  BUNDLED_CONTENT_TYPES,
  classifyFile
};
