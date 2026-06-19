export type ExtensionToWebviewMessage =
  | {
      type: "init";
      markdown: string;
      resourcePath: string;
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
      type: "copyText";
      text: string;
    }
  | {
      type: "requestOpenSource";
    };
