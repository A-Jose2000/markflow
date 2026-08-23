import type { ReactNode } from "react";

import type { DesktopMediaDocument } from "../desktopApi";

export function DesktopMediaPreview({ document }: { document: DesktopMediaDocument }) {
  let preview: ReactNode;

  switch (document.kind) {
    case "image":
      preview = <img alt={document.name} src={document.url} />;
      break;
    case "audio":
      preview = <audio aria-label={`Audio preview of ${document.name}`} controls src={document.url} />;
      break;
    case "video":
      preview = <video aria-label={`Video preview of ${document.name}`} controls src={document.url} />;
      break;
    case "pdf":
      preview = <iframe src={document.url} title={`PDF preview of ${document.name}`} />;
  }

  return (
    <section className={`desktop-media-viewer desktop-media-viewer--${document.kind}`} aria-label={document.name}>
      <header>
        <h1>{document.name}</h1>
        <p title={document.displayPath}>{document.displayPath}</p>
      </header>
      <div className="desktop-media-viewer__canvas">{preview}</div>
    </section>
  );
}
