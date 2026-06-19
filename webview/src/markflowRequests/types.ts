export const MARKFLOW_REQUEST_DIRECTIVE_NAME = "markflow-request";

export type MarkflowRequestStatus = "open" | "closed";
export type MarkflowRequestType = "question" | "request" | "todo" | "note";

export type MarkflowRequest = {
  id: string;
  status: MarkflowRequestStatus;
  type: MarkflowRequestType;
  body: string;
  startIndex?: number;
  endIndex?: number;
};

export const MARKFLOW_REQUEST_STATUSES: readonly MarkflowRequestStatus[] = ["open", "closed"];
export const MARKFLOW_REQUEST_TYPES: readonly MarkflowRequestType[] = ["question", "request", "todo", "note"];

export function normalizeMarkflowRequestStatus(value: unknown): MarkflowRequestStatus {
  return value === "closed" ? "closed" : "open";
}

export function normalizeMarkflowRequestType(value: unknown): MarkflowRequestType {
  return typeof value === "string" && MARKFLOW_REQUEST_TYPES.includes(value as MarkflowRequestType)
    ? (value as MarkflowRequestType)
    : "question";
}
