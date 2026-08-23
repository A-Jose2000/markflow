import * as path from "node:path";
import * as vscode from "vscode";

import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from "../shared/markdownMessages";
import type { CodexSelectionService } from "./codexSelectionService";
import { parseWebviewMessage } from "./markdownMessageParser";
import { getWebviewHtml } from "./webviewHtml";

interface CustomEditorSessionOptions {
  readonly codexSelections: CodexSelectionService;
  readonly document: vscode.TextDocument;
  readonly extensionUri: vscode.Uri;
  readonly panel: vscode.WebviewPanel;
}

export class CustomEditorSession {
  private readonly codexSelections: CodexSelectionService;
  private readonly document: vscode.TextDocument;
  private readonly extensionUri: vscode.Uri;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly retryTimers: Array<ReturnType<typeof setTimeout>> = [];
  private applyingWebviewMarkdown: string | undefined;
  private documentReadGeneration = 0;
  private editQueue: Promise<void> = Promise.resolve();
  private isDisposed = false;
  private isStarted = false;
  private selectionSessionId: symbol | undefined;

  public constructor(options: CustomEditorSessionOptions) {
    this.codexSelections = options.codexSelections;
    this.document = options.document;
    this.extensionUri = options.extensionUri;
    this.panel = options.panel;
  }

  public start(): void {
    if (this.isStarted) {
      return;
    }

    this.isStarted = true;
    this.configurePanel();
    this.selectionSessionId = this.codexSelections.registerDocument(this.document, this.panel);
    this.registerFileWatcher();
    this.registerDocumentListener();
    this.registerMessageListener();
    this.registerViewStateListener();
    this.disposables.push(this.panel.onDidDispose(() => this.dispose()));
    this.panel.webview.html = getWebviewHtml(this.panel.webview, this.extensionUri);
    this.scheduleInitialDocumentRetries();
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.documentReadGeneration += 1;

    if (this.selectionSessionId) {
      this.codexSelections.unregisterDocument(this.selectionSessionId);
      this.selectionSessionId = undefined;
    }

    this.clearInitialDocumentRetries();

    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private configurePanel(): void {
    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "images", "markflow-icon.png");
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "webview", "dist")]
    };
  }

  private registerFileWatcher(): void {
    if (this.document.uri.scheme !== "file") {
      return;
    }

    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        path.dirname(this.document.uri.fsPath),
        path.basename(this.document.uri.fsPath)
      )
    );

    this.disposables.push(
      fileWatcher.onDidChange(() => {
        void this.sendFreshDocumentUpdate();
      }),
      fileWatcher.onDidCreate(() => {
        void this.sendFreshDocumentUpdate();
      }),
      fileWatcher
    );
  }

  private registerDocumentListener(): void {
    const documentKey = this.document.uri.toString();

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== documentKey) {
          return;
        }

        const markdown = this.document.getText();

        if (markdown === this.applyingWebviewMarkdown) {
          return;
        }

        this.postMessage({
          type: "update",
          markdown
        });
      })
    );
  }

  private registerMessageListener(): void {
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((value: unknown) => {
        const message = parseWebviewMessage(value);

        if (!message) {
          return;
        }

        void this.handleMessage(message).catch((error: unknown) => {
          console.error("Markflow could not handle a webview message.", error);
        });
      })
    );
  }

  private registerViewStateListener(): void {
    this.disposables.push(
      this.panel.onDidChangeViewState((event) => {
        if (this.selectionSessionId) {
          this.codexSelections.updatePanelState(this.selectionSessionId, event.webviewPanel);
        }

        if (event.webviewPanel.visible) {
          void this.sendFreshDocumentUpdate();
        }
      })
    );
  }

  private scheduleInitialDocumentRetries(): void {
    for (const delayMs of [100, 500, 1_000, 2_000]) {
      this.retryTimers.push(
        setTimeout(() => {
          void this.sendInitialDocument();
        }, delayMs)
      );
    }
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.clearInitialDocumentRetries();
        await this.sendInitialDocument();
        return;

      case "edit":
        await this.enqueueMarkdownEdit(message.markdown);
        return;

      case "codexSelection":
        if (this.selectionSessionId) {
          this.codexSelections.updateSelection(this.selectionSessionId, message);
        }
        return;

      case "copyText":
        await vscode.env.clipboard.writeText(message.text);
        return;

      case "requestOpenSource":
        await vscode.commands.executeCommand("vscode.openWith", this.document.uri, "default");
        return;
    }
  }

  private async sendInitialDocument(): Promise<void> {
    const generation = ++this.documentReadGeneration;
    const markdown = await this.readFreshMarkdown();

    if (this.isDisposed || generation !== this.documentReadGeneration) {
      return;
    }

    this.postMessage({
      type: "init",
      markdown,
      resourcePath: this.document.uri.fsPath,
      readonly: false,
      debounceMs: getDebounceMs()
    });
  }

  private async sendFreshDocumentUpdate(): Promise<void> {
    const generation = ++this.documentReadGeneration;
    const markdown = await this.readFreshMarkdown();

    if (this.isDisposed || generation !== this.documentReadGeneration) {
      return;
    }

    this.postMessage({
      type: "update",
      markdown
    });
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    if (!this.isDisposed) {
      void this.panel.webview.postMessage(message).then(
        undefined,
        (error: unknown) => {
          if (!this.isDisposed) {
            console.error("Markflow could not deliver a webview message.", error);
          }
        }
      );
    }
  }

  private clearInitialDocumentRetries(): void {
    for (const timer of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.length = 0;
  }

  private async readFreshMarkdown(): Promise<string> {
    if (this.document.isDirty) {
      return this.document.getText();
    }

    return (await this.readDiskMarkdown()) ?? this.document.getText();
  }

  private async readDiskMarkdown(): Promise<string | undefined> {
    if (this.document.uri.scheme !== "file") {
      return undefined;
    }

    try {
      const fileContents = await vscode.workspace.fs.readFile(this.document.uri);
      return Buffer.from(fileContents).toString("utf8");
    } catch (error) {
      console.error("Markflow could not read the Markdown file from disk.", error);
      return undefined;
    }
  }

  private enqueueMarkdownEdit(nextMarkdown: string): Promise<void> {
    const pendingEdit = this.editQueue.then(() => this.applyMarkdownEdit(nextMarkdown));
    this.editQueue = pendingEdit.catch(() => undefined);
    return pendingEdit;
  }

  private async applyMarkdownEdit(nextMarkdown: string): Promise<void> {
    if (nextMarkdown === this.document.getText()) {
      return;
    }

    this.applyingWebviewMarkdown = nextMarkdown;

    try {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        this.document.positionAt(0),
        this.document.positionAt(this.document.getText().length)
      );

      edit.replace(this.document.uri, fullRange, nextMarkdown);

      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        await vscode.window.showErrorMessage("Markflow could not apply the Markdown edit.");
      }
    } finally {
      if (this.applyingWebviewMarkdown === nextMarkdown) {
        this.applyingWebviewMarkdown = undefined;
      }
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
