"use strict";

const path = require("node:path");
const { promises: defaultFileSystem } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { BUNDLED_CONTENT_TYPES, classifyFile } = require("../fileCatalog.cjs");
const { decodeMediaPath, readRelativePath } = require("../requestValidation.cjs");
const { assertContained, resolveExistingPath } = require("../workspacePaths.cjs");

const APP_SCHEME = "markflow-app";
const MEDIA_SCHEME = "markflow-media";

function registerProtocolHandlers({
  protocol,
  netFetch,
  rendererRootPath,
  rendererContentSecurityPolicy,
  getRootById,
  fileSystem = defaultFileSystem,
  logger = console
}) {
  protocol.handle(APP_SCHEME, createApplicationProtocolHandler({
    fileSystem,
    logger,
    netFetch,
    rendererContentSecurityPolicy,
    rendererRootPath
  }));
  protocol.handle(MEDIA_SCHEME, createMediaProtocolHandler({
    fileSystem,
    getRootById,
    logger,
    netFetch
  }));
}

function createApplicationProtocolHandler({
  fileSystem = defaultFileSystem,
  logger = console,
  netFetch,
  rendererContentSecurityPolicy,
  rendererRootPath
}) {
  return async function handleApplicationRequest(request) {
    try {
      const url = new URL(request.url);

      if (
        url.hostname !== "bundle" ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== "" ||
        (request.method !== "GET" && request.method !== "HEAD")
      ) {
        return protocolErrorResponse(404, "Application resource unavailable");
      }

      const relativePath = decodeMediaPath(url.pathname);
      const candidatePath = path.resolve(rendererRootPath, ...readRelativePath(relativePath));
      assertContained(rendererRootPath, candidatePath);

      const [realRendererRoot, realResourcePath] = await Promise.all([
        fileSystem.realpath(rendererRootPath),
        fileSystem.realpath(candidatePath)
      ]);
      assertContained(realRendererRoot, realResourcePath);

      const stats = await fileSystem.stat(realResourcePath);

      if (!stats.isFile()) {
        return protocolErrorResponse(404, "Application resource unavailable");
      }

      const extension = path.extname(realResourcePath).toLowerCase();
      const contentType = BUNDLED_CONTENT_TYPES.get(extension);

      if (!contentType) {
        return protocolErrorResponse(415, "Unsupported application resource");
      }

      const response = await netFetch(pathToFileURL(realResourcePath).toString(), {
        method: request.method,
        headers: request.headers,
        bypassCustomProtocolHandlers: true
      });
      const headers = new Headers(response.headers);
      headers.set("Content-Type", contentType);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cache-Control", "no-store");

      if (extension === ".html") {
        headers.set("Content-Security-Policy", rendererContentSecurityPolicy);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      logger.error("Markflow Desktop application protocol rejected a request.", error);
      return protocolErrorResponse(404, "Application resource unavailable");
    }
  };
}

function createMediaProtocolHandler({
  fileSystem = defaultFileSystem,
  getRootById,
  logger = console,
  netFetch
}) {
  return async function handleMediaRequest(request) {
    try {
      const url = new URL(request.url);
      const root = getRootById(url.hostname);

      if (!root) {
        return protocolErrorResponse(404, "Folder unavailable");
      }

      const relativePath = decodeMediaPath(url.pathname);
      const fileType = classifyFile(relativePath);

      if (!fileType || fileType.kind === "markdown") {
        return protocolErrorResponse(415, "Unsupported media type");
      }

      const realPath = await resolveExistingPath(root, relativePath);
      const stats = await fileSystem.stat(realPath);

      if (!stats.isFile()) {
        return protocolErrorResponse(404, "Media unavailable");
      }

      const response = await netFetch(pathToFileURL(realPath).toString(), {
        headers: request.headers,
        bypassCustomProtocolHandlers: true
      });
      const headers = new Headers(response.headers);
      headers.set("Content-Type", fileType.mimeType);
      headers.set("Content-Disposition", "inline");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cache-Control", "no-store");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      logger.error("Markflow Desktop media protocol rejected a request.", error);
      return protocolErrorResponse(404, "Media unavailable");
    }
  };
}

function protocolErrorResponse(status, message) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

module.exports = {
  APP_SCHEME,
  MEDIA_SCHEME,
  createApplicationProtocolHandler,
  createMediaProtocolHandler,
  registerProtocolHandlers
};
