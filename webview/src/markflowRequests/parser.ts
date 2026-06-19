import {
  MARKFLOW_REQUEST_DIRECTIVE_NAME,
  type MarkflowRequest,
  type MarkflowRequestStatus,
  normalizeMarkflowRequestStatus,
  normalizeMarkflowRequestType
} from "./types";

const OPENING_DIRECTIVE_PATTERN = /^:::markflow-request(?:\{([^}]*)\})?[ \t]*$/gm;
const CLOSING_DIRECTIVE_PATTERN = /^:::[ \t]*$/gm;

type DirectiveAttributes = Record<string, string>;

export function parseMarkflowRequests(markdown: string): MarkflowRequest[] {
  const requests: MarkflowRequest[] = [];
  OPENING_DIRECTIVE_PATTERN.lastIndex = 0;

  let openingMatch: RegExpExecArray | null;
  while ((openingMatch = OPENING_DIRECTIVE_PATTERN.exec(markdown)) !== null) {
    const openingLineStart = openingMatch.index;
    const bodyStart = getNextLineStart(markdown, OPENING_DIRECTIVE_PATTERN.lastIndex);

    CLOSING_DIRECTIVE_PATTERN.lastIndex = bodyStart;
    const closingMatch = CLOSING_DIRECTIVE_PATTERN.exec(markdown);

    if (!closingMatch) {
      break;
    }

    const attributes = parseDirectiveAttributes(openingMatch[1] ?? "");
    const body = trimSingleTrailingLineEnding(markdown.slice(bodyStart, closingMatch.index));
    const endIndex = closingMatch.index + closingMatch[0].length;

    requests.push({
      id: attributes.id ?? "",
      status: normalizeMarkflowRequestStatus(attributes.status),
      type: normalizeMarkflowRequestType(attributes.type),
      body,
      startIndex: openingLineStart,
      endIndex
    });

    OPENING_DIRECTIVE_PATTERN.lastIndex = endIndex;
  }

  return requests;
}

export function updateMarkflowRequestStatus(
  markdown: string,
  requestId: string,
  status: MarkflowRequestStatus
): string {
  const request = parseMarkflowRequests(markdown).find((candidate) => candidate.id === requestId);

  if (request?.startIndex === undefined) {
    return markdown;
  }

  const openingLineEnd = findLineEnd(markdown, request.startIndex);
  const openingLine = markdown.slice(request.startIndex, openingLineEnd);
  const updatedOpeningLine = setDirectiveAttribute(openingLine, "status", status);

  if (updatedOpeningLine === openingLine) {
    return markdown;
  }

  return `${markdown.slice(0, request.startIndex)}${updatedOpeningLine}${markdown.slice(openingLineEnd)}`;
}

export function deleteMarkflowRequest(markdown: string, requestId: string): string {
  const request = parseMarkflowRequests(markdown).find((candidate) => candidate.id === requestId);

  if (request?.startIndex === undefined || request.endIndex === undefined) {
    return markdown;
  }

  const removeEnd = advancePastLineEnding(markdown, request.endIndex);

  return `${markdown.slice(0, request.startIndex)}${markdown.slice(removeEnd)}`;
}

export function parseDirectiveAttributes(source: string): DirectiveAttributes {
  const attributes: DirectiveAttributes = {};
  const idShortcut = /(?:^|\s)#([A-Za-z0-9_.:-]+)/.exec(source);

  const attributePattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g;
  let attributeMatch: RegExpExecArray | null;
  while ((attributeMatch = attributePattern.exec(source)) !== null) {
    attributes[attributeMatch[1]] = attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? "";
  }

  if (attributes.id === undefined && idShortcut) {
    attributes.id = idShortcut[1];
  }

  return attributes;
}

function setDirectiveAttribute(openingLine: string, name: string, value: string): string {
  const quotedValue = `${name}="${escapeAttributeValue(value)}"`;
  const braceStart = openingLine.indexOf("{");
  const braceEnd = openingLine.lastIndexOf("}");

  if (braceStart === -1 || braceEnd === -1 || braceEnd < braceStart) {
    return `${openingLine}{${quotedValue}}`;
  }

  const attributes = openingLine.slice(braceStart + 1, braceEnd);
  const attributePattern = new RegExp(`(^|\\s)${escapeRegExp(name)}=(?:"[^"]*"|'[^']*'|[^\\s}]+)`);

  if (attributePattern.test(attributes)) {
    return `${openingLine.slice(0, braceStart + 1)}${attributes.replace(
      attributePattern,
      (_match, prefix: string) => `${prefix}${quotedValue}`
    )}${openingLine.slice(braceEnd)}`;
  }

  const separator = attributes.trim().length > 0 ? " " : "";
  return `${openingLine.slice(0, braceEnd)}${separator}${quotedValue}${openingLine.slice(braceEnd)}`;
}

function getNextLineStart(markdown: string, index: number): number {
  if (markdown[index] === "\r" && markdown[index + 1] === "\n") {
    return index + 2;
  }

  if (markdown[index] === "\n") {
    return index + 1;
  }

  return index;
}

function findLineEnd(markdown: string, lineStart: number): number {
  const nextLineBreak = markdown.indexOf("\n", lineStart);
  if (nextLineBreak === -1) {
    return markdown.length;
  }

  return markdown[nextLineBreak - 1] === "\r" ? nextLineBreak - 1 : nextLineBreak;
}

function trimSingleTrailingLineEnding(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }

  if (value.endsWith("\n")) {
    return value.slice(0, -1);
  }

  return value;
}

function advancePastLineEnding(markdown: string, index: number): number {
  if (markdown[index] === "\r" && markdown[index + 1] === "\n") {
    return index + 2;
  }

  if (markdown[index] === "\n") {
    return index + 1;
  }

  return index;
}

function escapeAttributeValue(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isMarkflowRequestDirectiveName(name: string): boolean {
  return name === MARKFLOW_REQUEST_DIRECTIVE_NAME;
}
