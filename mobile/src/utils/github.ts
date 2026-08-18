const REMOTE_URL_PATTERN = /^https?:\/\//i;

export interface GitHubFileReference {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  apiUrl: string;
  htmlUrl: string;
  rawUrl: string;
}

export function normalizeMarkdownUrl(input: string): string {
  const parsedUrl = parseRemoteUrl(input);
  const githubFile = parseGitHubFileReference(parsedUrl.toString());

  return githubFile?.rawUrl ?? parsedUrl.toString();
}

export function parseGitHubFileReference(input: string): GitHubFileReference | undefined {
  let parsedUrl: URL;

  try {
    parsedUrl = parseRemoteUrl(input);
  } catch {
    return undefined;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathParts = splitPathname(parsedUrl);

  if (hostname === "github.com" || hostname === "www.github.com") {
    const [owner, repo, mode, ref, ...fileParts] = pathParts;

    if (!owner || !repo || !mode || !ref || fileParts.length === 0 || (mode !== "blob" && mode !== "raw")) {
      return undefined;
    }

    return createGitHubFileReference(owner, repo, ref, fileParts);
  }

  if (hostname === "raw.githubusercontent.com") {
    const [owner, repo, ref, ...fileParts] = pathParts;

    if (!owner || !repo || !ref || fileParts.length === 0) {
      return undefined;
    }

    return createGitHubFileReference(owner, repo, ref, fileParts);
  }

  return undefined;
}

export function titleFromGitHubFileReference(reference: GitHubFileReference): string {
  return titleFromUri(reference.path);
}

function parseRemoteUrl(input: string): URL {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    throw new Error("Enter a Markdown URL.");
  }

  const withProtocol = trimmedInput.startsWith("github.com/")
    ? `https://${trimmedInput}`
    : trimmedInput.startsWith("raw.githubusercontent.com/")
      ? `https://${trimmedInput}`
      : trimmedInput;

  if (!REMOTE_URL_PATTERN.test(withProtocol)) {
    throw new Error("Use an https:// URL or a github.com Markdown link.");
  }

  return new URL(withProtocol);
}

export function titleFromUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const lastPathPart = parsedUrl.pathname.split("/").filter(Boolean).at(-1);

    return lastPathPart ? safeDecode(lastPathPart) : parsedUrl.hostname;
  } catch {
    return titleFromUri(url);
  }
}

export function titleFromUri(uri: string): string {
  const withoutQuery = uri.split("?")[0] ?? uri;
  const lastPathPart = withoutQuery.split("/").filter(Boolean).at(-1);

  return lastPathPart ? safeDecode(lastPathPart) : "Markdown document";
}

export function resolveAgainstDocumentOrigin(url: string, origin?: string): string {
  if (!origin || REMOTE_URL_PATTERN.test(url) || url.startsWith("mailto:") || url.startsWith("tel:")) {
    return url;
  }

  try {
    return new URL(url, origin).toString();
  } catch {
    return url;
  }
}

export function isLikelyMarkdownUrl(url: string): boolean {
  const normalizedUrl = url.toLowerCase();

  return (
    normalizedUrl.endsWith(".md") ||
    normalizedUrl.endsWith(".markdown") ||
    normalizedUrl.includes("github.com/") ||
    normalizedUrl.includes("raw.githubusercontent.com/")
  );
}

function createGitHubFileReference(owner: string, repo: string, ref: string, fileParts: string[]): GitHubFileReference {
  const path = fileParts.join("/");
  const rawUrl = createUrl("https://raw.githubusercontent.com", [owner, repo, ref, ...fileParts]);
  const htmlUrl = createUrl("https://github.com", [owner, repo, "blob", ref, ...fileParts]);
  const apiUrl = createContentsApiUrl(owner, repo, ref, fileParts);

  return {
    owner,
    repo,
    ref,
    path,
    apiUrl,
    htmlUrl,
    rawUrl
  };
}

function createContentsApiUrl(owner: string, repo: string, ref: string, fileParts: string[]): string {
  const path = [owner, repo, "contents", ...fileParts].map(encodePathSegment).join("/");
  const apiUrl = new URL(`https://api.github.com/repos/${path}`);

  apiUrl.searchParams.set("ref", ref);

  return apiUrl.toString();
}

function createUrl(origin: string, pathParts: string[]): string {
  return `${origin}/${pathParts.map(encodePathSegment).join("/")}`;
}

function splitPathname(parsedUrl: URL): string[] {
  return parsedUrl.pathname.split("/").filter(Boolean).map(safeDecode);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
