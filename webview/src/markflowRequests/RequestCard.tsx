import type { MarkflowRequest } from "./types";

interface RequestCardProps {
  request: MarkflowRequest;
  readonly: boolean;
  onCloseRequest: (requestId: string) => void;
  onCopyRequestReference: (request: MarkflowRequest) => void;
  onDeleteRequest: (requestId: string) => void;
}

export function RequestCard({
  request,
  readonly,
  onCloseRequest,
  onCopyRequestReference,
  onDeleteRequest
}: RequestCardProps): JSX.Element {
  const preview = getRequestPreview(request.body);
  const canClose = !readonly && request.id.length > 0;
  const canDelete = !readonly && request.id.length > 0;

  return (
    <li className="request-list-item">
      <article className="request-list-card">
        <div className="request-list-card-header">
          <span className="request-type">{request.type}</span>
          <code>{request.id || "missing-id"}</code>
        </div>
        <p>{preview}</p>
        <div className="request-list-card-actions">
          <button onClick={() => onCopyRequestReference(request)} type="button">
            Copy ref
          </button>
          <button disabled={!canClose} onClick={() => onCloseRequest(request.id)} type="button">
            Mark closed
          </button>
          <button
            className="request-delete-button"
            disabled={!canDelete}
            onClick={() => onDeleteRequest(request.id)}
            type="button"
          >
            Delete
          </button>
        </div>
      </article>
    </li>
  );
}

function getRequestPreview(body: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstLine = lines.find((line) => !isEmptyRoleLabel(line)) ?? lines[0];

  if (!firstLine) {
    return "Empty request";
  }

  const preview = firstLine.replace(/^\*\*(You|Assistant):\*\*\s*/, "$1: ");

  return preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;
}

function isEmptyRoleLabel(line: string): boolean {
  return /^\*\*(You|Assistant):\*\*$/.test(line);
}
