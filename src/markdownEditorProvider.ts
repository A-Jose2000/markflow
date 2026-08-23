import * as vscode from "vscode";

import { CodexSelectionService } from "./codexSelectionService";
import { CustomEditorSession } from "./customEditorSession";

export const VIEW_TYPE = "ajose.markflow.markdownEditor";

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly codexSelections: CodexSelectionService;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.codexSelections = new CodexSelectionService(context.globalStorageUri, VIEW_TYPE);
  }

  public async addSelectionToCodexThread(): Promise<void> {
    await this.codexSelections.addActiveSelectionToThread();
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    new CustomEditorSession({
      codexSelections: this.codexSelections,
      document,
      extensionUri: this.context.extensionUri,
      panel: webviewPanel
    }).start();
  }
}
