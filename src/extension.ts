import * as vscode from "vscode";
import { MarkdownEditorProvider, VIEW_TYPE } from "./markdownEditorProvider";

const COMMAND_OPEN_AS_RICH_MARKDOWN = "markflow.openAsRichMarkdown";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MarkdownEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN_AS_RICH_MARKDOWN, async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor || !isMarkdownDocument(editor.document)) {
        await vscode.window.showWarningMessage("Open a Markdown file before launching Markflow.");
        return;
      }

      await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, VIEW_TYPE);
    })
  );
}

export function deactivate(): void {
  // No extension-level resources need explicit cleanup.
}

function isMarkdownDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === "markdown") {
    return true;
  }

  const path = document.uri.path.toLowerCase();
  return path.endsWith(".md") || path.endsWith(".markdown");
}
