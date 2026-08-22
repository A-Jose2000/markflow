import * as path from "path";
import * as vscode from "vscode";
import { getWebviewHtml } from "./webviewHtml";

export const VIEW_TYPE = "ajose.markflow.markdownEditor";
const CODEX_ADD_TO_THREAD_COMMAND = "chatgpt.addToThread";
const CODEX_ADD_FILE_TO_THREAD_COMMAND = "chatgpt.addFileToThread";

interface CodexSelectionState {
  text: string;
  source: "raw" | "rich";
  startIndex?: number;
  endIndex?: number;
}

type WebviewToExtensionMessage =
  | {
      type: "ready";
    }
  | {
      type: "edit";
      markdown: string;
    }
  | {
      type: "codexSelection";
      text: string;
      source: "raw" | "rich";
      startIndex?: number;
      endIndex?: number;
    }
  | {
      type: "copyText";
      text: string;
    }
  | {
      type: "requestOpenSource";
    };

type ExtensionToWebviewMessage =
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

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly codexSelectionsByDocument = new Map<string, CodexSelectionState>();
  private readonly documentsByKey = new Map<string, vscode.TextDocument>();
  private readonly viewColumnsByDocument = new Map<string, vscode.ViewColumn>();
  private activeDocumentKey: string | undefined;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async addSelectionToCodexThread(): Promise<void> {
    const documentKey = this.activeDocumentKey;
    const document = documentKey ? this.documentsByKey.get(documentKey) : undefined;
    const selection = documentKey ? this.codexSelectionsByDocument.get(documentKey) : undefined;

    if (!documentKey || !document || !selection) {
      await vscode.window.showWarningMessage("Select text in Markflow before adding it to a Codex thread.");
      return;
    }

    const sourceRange = getSourceRangeForCodexSelection(document, selection);

    if (sourceRange) {
      if (!(await commandExists(CODEX_ADD_TO_THREAD_COMMAND))) {
        await showCodexMissingMessage();
        return;
      }

      await this.addSourceRangeToCodexThread(document, sourceRange, this.viewColumnsByDocument.get(documentKey));
      return;
    }

    if (!(await commandExists(CODEX_ADD_FILE_TO_THREAD_COMMAND))) {
      await showCodexMissingMessage();
      return;
    }

    await this.addSelectionSnapshotToCodexThread(document, selection);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "images", "markflow-icon.png");
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "webview", "dist")]
    };

    let isApplyingWebviewEdit = false;
    let isDisposed = false;
    const documentKey = document.uri.toString();

    this.documentsByKey.set(documentKey, document);
    this.updateActiveDocument(documentKey, webviewPanel);

    const postMessage = (message: ExtensionToWebviewMessage) => {
      void webviewPanel.webview.postMessage(message);
    };

    const readDiskMarkdown = async (): Promise<string | undefined> => {
      if (document.uri.scheme !== "file") {
        return undefined;
      }

      try {
        const fileContents = await vscode.workspace.fs.readFile(document.uri);
        return Buffer.from(fileContents).toString("utf8");
      } catch (error) {
        console.error("Markflow could not read the Markdown file from disk.", error);
        return undefined;
      }
    };

    const readFreshMarkdown = async (): Promise<string> => {
      if (document.isDirty) {
        return document.getText();
      }

      return (await readDiskMarkdown()) ?? document.getText();
    };

    const sendInitialDocument = async () => {
      postMessage({
        type: "init",
        markdown: await readFreshMarkdown(),
        resourcePath: document.uri.fsPath,
        readonly: false,
        debounceMs: getDebounceMs()
      });
    };

    const sendDocumentUpdate = () => {
      postMessage({
        type: "update",
        markdown: document.getText()
      });
    };

    const sendFreshDocumentUpdate = async () => {
      postMessage({
        type: "update",
        markdown: await readFreshMarkdown()
      });
    };

    const fileWatcher =
      document.uri.scheme === "file"
        ? vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(path.dirname(document.uri.fsPath), path.basename(document.uri.fsPath))
          )
        : undefined;

    const fileWatcherChangeSubscription = fileWatcher?.onDidChange(() => {
      if (!isDisposed) {
        void sendFreshDocumentUpdate();
      }
    });

    const fileWatcherCreateSubscription = fileWatcher?.onDidCreate(() => {
      if (!isDisposed) {
        void sendFreshDocumentUpdate();
      }
    });

    const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      if (isApplyingWebviewEdit) {
        return;
      }

      sendDocumentUpdate();
    });

    const messageSubscription = webviewPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case "ready":
          await sendInitialDocument();
          return;

        case "edit":
          if (typeof message.markdown !== "string") {
            return;
          }

          await this.applyMarkdownEdit(document, message.markdown, {
            onBeforeApply: () => {
              isApplyingWebviewEdit = true;
            },
            onAfterApply: () => {
              isApplyingWebviewEdit = false;
            }
          });
          return;

        case "codexSelection":
          this.activeDocumentKey = documentKey;
          this.updateCodexSelection(documentKey, message);
          return;

        case "copyText":
          if (typeof message.text !== "string") {
            return;
          }

          await vscode.env.clipboard.writeText(message.text);
          return;

        case "requestOpenSource":
          await vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
          return;
      }
    });

    const viewStateSubscription = webviewPanel.onDidChangeViewState((event) => {
      this.updateActiveDocument(documentKey, event.webviewPanel);

      if (event.webviewPanel.visible) {
        void sendFreshDocumentUpdate();
      }
    });

    webviewPanel.onDidDispose(() => {
      isDisposed = true;
      this.codexSelectionsByDocument.delete(documentKey);
      this.documentsByKey.delete(documentKey);
      this.viewColumnsByDocument.delete(documentKey);
      if (this.activeDocumentKey === documentKey) {
        this.activeDocumentKey = undefined;
      }
      documentChangeSubscription.dispose();
      fileWatcherChangeSubscription?.dispose();
      fileWatcherCreateSubscription?.dispose();
      fileWatcher?.dispose();
      messageSubscription.dispose();
      viewStateSubscription.dispose();
    });

    webviewPanel.webview.html = getWebviewHtml(webviewPanel.webview, this.context.extensionUri);

    for (const delayMs of [100, 500, 1_000, 2_000]) {
      setTimeout(() => {
        if (!isDisposed) {
          void sendInitialDocument();
        }
      }, delayMs);
    }
  }

  private updateActiveDocument(documentKey: string, webviewPanel: vscode.WebviewPanel): void {
    if (webviewPanel.viewColumn !== undefined) {
      this.viewColumnsByDocument.set(documentKey, webviewPanel.viewColumn);
    }

    if (webviewPanel.active) {
      this.activeDocumentKey = documentKey;
    }
  }

  private updateCodexSelection(documentKey: string, message: WebviewToExtensionMessage): void {
    if (message.type !== "codexSelection" || typeof message.text !== "string" || message.text.trim().length === 0) {
      this.codexSelectionsByDocument.delete(documentKey);
      return;
    }

    const selection: CodexSelectionState = {
      text: message.text,
      source: message.source === "raw" ? "raw" : "rich"
    };

    if (
      typeof message.startIndex === "number" &&
      typeof message.endIndex === "number" &&
      Number.isInteger(message.startIndex) &&
      Number.isInteger(message.endIndex) &&
      message.startIndex >= 0 &&
      message.endIndex > message.startIndex
    ) {
      selection.startIndex = message.startIndex;
      selection.endIndex = message.endIndex;
    }

    this.codexSelectionsByDocument.set(documentKey, selection);
  }

  private async addSourceRangeToCodexThread(
    document: vscode.TextDocument,
    range: vscode.Range,
    viewColumn: vscode.ViewColumn | undefined
  ): Promise<void> {
    const editor = await vscode.window.showTextDocument(document, {
      preview: true,
      preserveFocus: false,
      selection: range,
      viewColumn: viewColumn ?? vscode.ViewColumn.Active
    });

    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

    try {
      await vscode.commands.executeCommand(CODEX_ADD_TO_THREAD_COMMAND);
    } finally {
      await vscode.commands.executeCommand("vscode.openWith", document.uri, VIEW_TYPE, {
        preserveFocus: true,
        preview: false,
        viewColumn: viewColumn ?? vscode.ViewColumn.Active
      });
    }
  }

  private async addSelectionSnapshotToCodexThread(
    document: vscode.TextDocument,
    selection: CodexSelectionState
  ): Promise<void> {
    const selectionDirectory = vscode.Uri.joinPath(this.context.globalStorageUri, "codex-selections");
    await vscode.workspace.fs.createDirectory(selectionDirectory);

    const fileName = createSelectionSnapshotFileName(document.uri);
    const selectionUri = vscode.Uri.joinPath(selectionDirectory, fileName);
    const snapshot = createSelectionSnapshot(document, selection);

    await vscode.workspace.fs.writeFile(selectionUri, Buffer.from(snapshot, "utf8"));
    await vscode.commands.executeCommand(CODEX_ADD_FILE_TO_THREAD_COMMAND, selectionUri);
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

function getSourceRangeForCodexSelection(
  document: vscode.TextDocument,
  selection: CodexSelectionState
): vscode.Range | undefined {
  const markdown = document.getText();
  const sourceRange = getValidatedSourceRange(markdown, selection) ?? findUniqueSelectionTextRange(markdown, selection.text);

  if (!sourceRange) {
    return undefined;
  }

  return new vscode.Range(document.positionAt(sourceRange.startIndex), document.positionAt(sourceRange.endIndex));
}

function getValidatedSourceRange(
  markdown: string,
  selection: CodexSelectionState
): { startIndex: number; endIndex: number } | undefined {
  if (selection.startIndex === undefined || selection.endIndex === undefined) {
    return undefined;
  }

  if (selection.startIndex < 0 || selection.endIndex > markdown.length || selection.startIndex >= selection.endIndex) {
    return undefined;
  }

  if (markdown.slice(selection.startIndex, selection.endIndex) !== selection.text) {
    return undefined;
  }

  return {
    startIndex: selection.startIndex,
    endIndex: selection.endIndex
  };
}

function findUniqueSelectionTextRange(
  markdown: string,
  selectedText: string
): { startIndex: number; endIndex: number } | undefined {
  const normalizedSelectedText = selectedText.replace(/\u00a0/g, " ");
  const directRange = findUniqueRange(markdown, normalizedSelectedText);

  if (directRange) {
    return directRange;
  }

  return findUniqueRangeWithNormalizedLineEndings(markdown, normalizedSelectedText);
}

function findUniqueRange(source: string, needle: string): { startIndex: number; endIndex: number } | undefined {
  if (needle.length === 0) {
    return undefined;
  }

  const startIndex = source.indexOf(needle);

  if (startIndex === -1) {
    return undefined;
  }

  const secondMatchIndex = source.indexOf(needle, startIndex + needle.length);

  if (secondMatchIndex !== -1) {
    return undefined;
  }

  return {
    startIndex,
    endIndex: startIndex + needle.length
  };
}

function findUniqueRangeWithNormalizedLineEndings(
  source: string,
  needle: string
): { startIndex: number; endIndex: number } | undefined {
  const normalizedNeedle = needle.replace(/\r\n?/g, "\n");

  if (normalizedNeedle === needle && !source.includes("\r")) {
    return undefined;
  }

  const { normalizedSource, indexMap } = normalizeLineEndingsWithIndexMap(source);
  const normalizedStartIndex = normalizedSource.indexOf(normalizedNeedle);

  if (normalizedStartIndex === -1) {
    return undefined;
  }

  const secondMatchIndex = normalizedSource.indexOf(normalizedNeedle, normalizedStartIndex + normalizedNeedle.length);

  if (secondMatchIndex !== -1) {
    return undefined;
  }

  const normalizedEndIndex = normalizedStartIndex + normalizedNeedle.length;

  return {
    startIndex: indexMap[normalizedStartIndex],
    endIndex: normalizedEndIndex < indexMap.length ? indexMap[normalizedEndIndex] : source.length
  };
}

function normalizeLineEndingsWithIndexMap(source: string): { normalizedSource: string; indexMap: number[] } {
  const normalizedCharacters: string[] = [];
  const indexMap: number[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === "\r") {
      normalizedCharacters.push("\n");
      indexMap.push(index);

      if (source[index + 1] === "\n") {
        index += 1;
      }

      continue;
    }

    normalizedCharacters.push(character);
    indexMap.push(index);
  }

  return {
    normalizedSource: normalizedCharacters.join(""),
    indexMap
  };
}

async function commandExists(command: string): Promise<boolean> {
  const commands = await vscode.commands.getCommands(true);
  return commands.includes(command);
}

async function showCodexMissingMessage(): Promise<void> {
  await vscode.window.showWarningMessage("Install or enable the Codex extension before adding Markflow selections to a thread.");
}

function createSelectionSnapshotFileName(documentUri: vscode.Uri): string {
  const sourceName = documentUri.path.split("/").at(-1)?.replace(/[^a-zA-Z0-9._-]/g, "-") || "selection.md";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `${timestamp}-${sourceName}`;
}

function createSelectionSnapshot(document: vscode.TextDocument, selection: CodexSelectionState): string {
  return [
    "# Markflow Selection",
    "",
    `Source file: ${document.uri.fsPath}`,
    `Selection source: ${selection.source}`,
    `Captured at: ${new Date().toISOString()}`,
    "",
    fencedMarkdown(selection.text),
    ""
  ].join("\n");
}

function fencedMarkdown(value: string): string {
  const longestFenceLength = Math.max(3, ...Array.from(value.matchAll(/`+/g)).map((match) => match[0].length + 1));
  const fence = "`".repeat(longestFenceLength);

  return `${fence}markdown\n${value}\n${fence}`;
}
