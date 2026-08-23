"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { promises: fs } = require("node:fs");

const { PublicError } = require("./publicErrors.cjs");

const MAX_MARKDOWN_BYTES = 32 * 1024 * 1024;

async function readMarkdownFile(realPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const beforeStats = await fs.stat(realPath, { bigint: true });

    if (!beforeStats.isFile()) {
      throw new PublicError("NOT_A_FILE", "That explorer item is not a file.");
    }

    if (beforeStats.size > BigInt(MAX_MARKDOWN_BYTES)) {
      throw new PublicError("FILE_TOO_LARGE", "This Markdown file is too large to edit safely.");
    }

    const contents = await fs.readFile(realPath);
    const afterStats = await fs.stat(realPath, { bigint: true });

    if (revisionFromStats(beforeStats) !== revisionFromStats(afterStats) && attempt === 0) {
      continue;
    }

    if (revisionFromStats(beforeStats) !== revisionFromStats(afterStats)) {
      throw new PublicError("FILE_CHANGED", "The Markdown file kept changing while it was being opened.");
    }

    if (contents.includes(0)) {
      throw new PublicError("BINARY_FILE", "This file appears to contain binary data.");
    }

    const hasBom = contents.length >= 3 && contents[0] === 0xef && contents[1] === 0xbb && contents[2] === 0xbf;
    const body = hasBom ? contents.subarray(3) : contents;
    let markdown;

    try {
      markdown = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      throw new PublicError("INVALID_ENCODING", "Markflow currently supports UTF-8 Markdown files.");
    }

    const eol = detectEol(markdown);

    return {
      markdown: markdown.replace(/\r\n?/g, "\n"),
      revision: revisionFromStats(afterStats),
      eol,
      hasBom
    };
  }

  throw new PublicError("FILE_CHANGED", "The Markdown file could not be read consistently.");
}

async function writeFileAtomically(targetPath, contents, mode) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    await fs.writeFile(temporaryPath, contents, {
      flag: "wx",
      mode
    });

    const handle = await fs.open(temporaryPath, "r+");

    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

/** @returns {"lf" | "crlf"} */
function detectEol(markdown) {
  let crlfCount = 0;
  let lfCount = 0;

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "\n") {
      continue;
    }

    if (index > 0 && markdown[index - 1] === "\r") {
      crlfCount += 1;
    } else {
      lfCount += 1;
    }
  }

  return crlfCount > lfCount ? "crlf" : "lf";
}

function encodeMarkdown(markdown, eol, hasBom) {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const withOriginalEol = eol === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
  const body = Buffer.from(withOriginalEol, "utf8");

  return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

function revisionFromStats(stats) {
  const mtime = "mtimeNs" in stats ? stats.mtimeNs : BigInt(Math.trunc(Number(stats.mtimeMs) * 1_000_000));
  return `${stats.dev}:${stats.ino}:${stats.size}:${mtime}`;
}

module.exports = {
  MAX_MARKDOWN_BYTES,
  detectEol,
  encodeMarkdown,
  readMarkdownFile,
  revisionFromStats,
  writeFileAtomically
};
