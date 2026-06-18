import * as vscode from "vscode";
import { getWebviewHtml } from "./webviewHtml";

export const VIEW_TYPE = "ajose.markflow.markdownEditor";

type WebviewToExtensionMessage =
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

type ExtensionToWebviewMessage =
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

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "webview", "dist")]
    };

    let isApplyingWebviewEdit = false;
    let isDisposed = false;
    let lastMarkdownFromWebview = document.getText();

    const postMessage = (message: ExtensionToWebviewMessage) => {
      void webviewPanel.webview.postMessage(message);
    };

    const sendInitialDocument = () => {
      postMessage({
        type: "init",
        markdown: document.getText(),
        readonly: false,
        debounceMs: getDebounceMs()
      });
    };

    const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      if (isApplyingWebviewEdit) {
        return;
      }

      const markdown = event.document.getText();
      if (markdown === lastMarkdownFromWebview) {
        return;
      }

      postMessage({
        type: "update",
        markdown
      });
    });

    const messageSubscription = webviewPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case "ready":
          sendInitialDocument();
          return;

        case "edit":
          if (typeof message.markdown !== "string") {
            return;
          }

          await this.applyMarkdownEdit(document, message.markdown, {
            onBeforeApply: () => {
              isApplyingWebviewEdit = true;
              lastMarkdownFromWebview = message.markdown;
            },
            onAfterApply: () => {
              isApplyingWebviewEdit = false;
            }
          });
          return;

        case "requestOpenSource":
          await vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
          return;
      }
    });

    webviewPanel.onDidDispose(() => {
      isDisposed = true;
      documentChangeSubscription.dispose();
      messageSubscription.dispose();
    });

    webviewPanel.webview.html = getWebviewHtml(webviewPanel.webview, this.context.extensionUri);

    for (const delayMs of [100, 500, 1_000, 2_000]) {
      setTimeout(() => {
        if (!isDisposed) {
          sendInitialDocument();
        }
      }, delayMs);
    }
  }

  private async applyMarkdownEdit(
    document: vscode.TextDocument,
    nextMarkdown: string,
    hooks: {
      onBeforeApply: () => void;
      onAfterApply: () => void;
    }
  ): Promise<void> {
    if (nextMarkdown === document.getText()) {
      return;
    }

    hooks.onBeforeApply();

    try {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );

      edit.replace(document.uri, fullRange, nextMarkdown);

      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        await vscode.window.showErrorMessage("Markflow could not apply the Markdown edit.");
      }
    } finally {
      hooks.onAfterApply();
    }
  }
}

function getDebounceMs(): number {
  const configuredValue = vscode.workspace.getConfiguration("markflow").get<number>("debounceMs", 250);

  if (typeof configuredValue !== "number" || Number.isNaN(configuredValue)) {
    return 250;
  }

  return Math.max(0, configuredValue);
}
