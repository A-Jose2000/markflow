export type DocumentSource = "local" | "remote";

export interface MarkdownDocument {
  id: string;
  title: string;
  source: DocumentSource;
  origin: string;
  markdown: string;
  loadedAt: string;
}

export type LoadStatus =
  | {
      kind: "idle";
      message?: undefined;
    }
  | {
      kind: "loading";
      message: string;
    }
  | {
      kind: "error";
      message: string;
    }
  | {
      kind: "success";
      message: string;
    };

export type ReaderMode = "rendered" | "source";
