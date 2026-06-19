import { MARKFLOW_REQUEST_DIRECTIVE_NAME, type MarkflowRequestStatus, type MarkflowRequestType } from "./types";

const DEFAULT_REQUEST_BODY = "**You:** Write your request here.";

export function createMarkflowRequestId(date = new Date()): string {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("");
  const timePart = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ].join("");
  const entropy = Math.random().toString(36).slice(2, 7);

  return `mf_req_${datePart}_${timePart}_${entropy}`;
}

export function createMarkflowRequestBlock(options: {
  id?: string;
  status?: MarkflowRequestStatus;
  type?: MarkflowRequestType;
  body?: string;
} = {}): string {
  const id = options.id ?? createMarkflowRequestId();
  const status = options.status ?? "open";
  const type = options.type ?? "question";
  const body = options.body ?? DEFAULT_REQUEST_BODY;

  return `:::${MARKFLOW_REQUEST_DIRECTIVE_NAME}{id="${id}" status="${status}" type="${type}"}\n${body}\n:::`;
}

export function appendMarkflowRequestBlock(markdown: string, block = createMarkflowRequestBlock()): string {
  const separator = markdown.length === 0 ? "" : markdown.endsWith("\n\n") ? "" : markdown.endsWith("\n") ? "\n" : "\n\n";
  return `${markdown}${separator}${block}\n`;
}
