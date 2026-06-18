export type ExtensionToWebviewMessage =
  | {
      type: "init";
      markdown: string;
      readonly: boolean;
      debounceMs: number;
    }
  | {
      type: "update";
      markdown: string;
    };

export type WebviewToExtensionMessage =
  | {
      type: "ready";
    }
  | {
      type: "edit";
      markdown: string;
    }
  | {
      type: "requestOpenSource";
    };
