import { RequestCard } from "./RequestCard";
import type { MarkflowRequest } from "./types";

interface RequestPanelProps {
  id: string;
  openRequests: MarkflowRequest[];
  readonly: boolean;
  onCloseRequest: (requestId: string) => void;
  onCopyRequestReference: (request: MarkflowRequest) => void;
  onDeleteRequest: (requestId: string) => void;
  onDismiss: () => void;
}

export function RequestPanel({
  id,
  openRequests,
  readonly,
  onCloseRequest,
  onCopyRequestReference,
  onDeleteRequest,
  onDismiss
}: RequestPanelProps): JSX.Element {
  return (
    <div className="request-modal-backdrop" onClick={onDismiss}>
      <aside
        aria-labelledby={`${id}-title`}
        aria-modal="true"
        className="request-panel"
        id={id}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="request-panel-header">
          <h2 id={`${id}-title`}>Open Requests</h2>
          <span aria-label={`${openRequests.length} open requests`}>{openRequests.length}</span>
          <button aria-label="Close Open Requests" className="request-panel-close-button" onClick={onDismiss} type="button">
            ×
          </button>
        </header>

        {openRequests.length === 0 ? (
          <p className="request-panel-empty">No open requests</p>
        ) : (
          <ol className="request-list">
            {openRequests.map((request) => (
              <RequestCard
                key={`${request.id}-${request.startIndex ?? 0}`}
                request={request}
                readonly={readonly}
                onCloseRequest={onCloseRequest}
                onCopyRequestReference={onCopyRequestReference}
                onDeleteRequest={onDeleteRequest}
              />
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
