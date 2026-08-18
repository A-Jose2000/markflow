import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import type { MarkdownDocument } from "../types";
import {
  type GitHubFileReference,
  normalizeMarkdownUrl,
  parseGitHubFileReference,
  titleFromGitHubFileReference,
  titleFromUri,
  titleFromUrl
} from "./github";

const MARKDOWN_PICKER_TYPES = [
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "application/octet-stream",
  "*/*"
];
const GITHUB_API_VERSION = "2022-11-28";

interface RemoteMarkdownOptions {
  githubToken?: string;
}

interface MarkdownDocumentInput {
  title: string;
  source: MarkdownDocument["source"];
  origin: string;
  markdown: string;
}

export async function pickMarkdownDocument(): Promise<MarkdownDocument | undefined> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: MARKDOWN_PICKER_TYPES
  });

  if (result.canceled) {
    return undefined;
  }

  const asset = result.assets[0];

  if (!asset) {
    throw new Error("No document was returned by Android.");
  }

  const markdown = await readTextFile(asset.uri);

  return createMarkdownDocument({
    title: asset.name || titleFromUri(asset.uri),
    source: "local",
    origin: asset.uri,
    markdown
  });
}

export async function loadRemoteMarkdown(rawInput: string, options: RemoteMarkdownOptions = {}): Promise<MarkdownDocument> {
  const githubFile = parseGitHubFileReference(rawInput);
  const githubToken = options.githubToken?.trim();

  if (githubFile && githubToken) {
    return loadGitHubMarkdown(githubFile, githubToken);
  }

  const url = normalizeMarkdownUrl(rawInput);
  const response = await fetch(url, {
    headers: {
      Accept: "text/markdown,text/plain,*/*"
    }
  });

  if (!response.ok) {
    if (githubFile && response.status === 404) {
      throw new Error("Private GitHub files need a token with Contents: read access.");
    }

    throw new Error(`Could not load Markdown (${response.status} ${response.statusText}).`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const markdown = await response.text();

  if (looksLikeHtml(markdown, contentType)) {
    throw new Error("That link returned a web page. Try a raw Markdown URL or a GitHub file link.");
  }

  return createMarkdownDocument({
    title: titleFromUrl(url),
    source: "remote",
    origin: url,
    markdown
  });
}

export async function loadMarkdownFromIncomingUrl(input: string, options: RemoteMarkdownOptions = {}): Promise<MarkdownDocument> {
  const trimmedInput = input.trim();

  if (/^(content|file):\/\//i.test(trimmedInput)) {
    return loadLocalMarkdownUri(trimmedInput);
  }

  if (/^markflow:\/\//i.test(trimmedInput)) {
    const nestedUrl = readMarkflowNestedUrl(trimmedInput);

    if (!nestedUrl) {
      throw new Error("The Markflow link did not include a Markdown URL.");
    }

    return loadMarkdownFromIncomingUrl(nestedUrl, options);
  }

  return loadRemoteMarkdown(trimmedInput, options);
}

export async function loadLocalMarkdownUri(uri: string): Promise<MarkdownDocument> {
  const markdown = await readTextFile(uri);

  return createMarkdownDocument({
    title: titleFromUri(uri),
    source: "local",
    origin: uri,
    markdown
  });
}

export async function readTextFile(uri: string): Promise<string> {
  const file = new File(uri);

  return file.text();
}

async function loadGitHubMarkdown(reference: GitHubFileReference, token: string): Promise<MarkdownDocument> {
  const response = await fetch(reference.apiUrl, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION
    }
  });

  if (!response.ok) {
    throw new Error(messageFromGitHubResponse(response));
  }

  const contentType = response.headers.get("content-type") ?? "";
  const markdown = await response.text();

  if (looksLikeHtml(markdown, contentType)) {
    throw new Error("GitHub returned a web page instead of raw Markdown.");
  }

  return createMarkdownDocument({
    title: titleFromGitHubFileReference(reference),
    source: "remote",
    origin: reference.rawUrl,
    markdown
  });
}

function createMarkdownDocument(input: MarkdownDocumentInput): MarkdownDocument {
  return {
    id: `${input.source}:${input.origin}:${Date.now()}`,
    title: input.title,
    source: input.source,
    origin: input.origin,
    markdown: input.markdown,
    loadedAt: new Date().toISOString()
  };
}

function messageFromGitHubResponse(response: Response): string {
  if (response.status === 401) {
    return "GitHub rejected the token. Save a valid token and try again.";
  }

  if (response.status === 403) {
    return "GitHub blocked the request. Check that the token has Contents: read access.";
  }

  if (response.status === 404) {
    return "GitHub could not find that file. Check the path, branch, and token repository access.";
  }

  return `Could not load private GitHub Markdown (${response.status} ${response.statusText}).`;
}

function readMarkflowNestedUrl(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.searchParams.get("url") ?? undefined;
  } catch {
    return undefined;
  }
}

function looksLikeHtml(content: string, contentType: string): boolean {
  const trimmedContent = content.trimStart().slice(0, 120).toLowerCase();

  return contentType.includes("text/html") || trimmedContent.startsWith("<!doctype html") || trimmedContent.startsWith("<html");
}
