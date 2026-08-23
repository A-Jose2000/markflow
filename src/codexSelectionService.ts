import * as vscode from "vscode";

import {
  createCodexSelectionState,
  resolveCodexSelectionRange,
  type CodexSelectionPayload,
  type CodexSelectionState
} from "./codexSelectionModel";
import {
  createSelectionSnapshot,
  createSelectionSnapshotFileName
} from "./codexSelectionSnapshotModel";

const CODEX_ADD_TO_THREAD_COMMAND = "chatgpt.addToThread";
const CODEX_ADD_FILE_TO_THREAD_COMMAND = "chatgpt.addFileToThread";

interface CodexSelectionSession {
  readonly document: vscode.TextDocument;
  selection?: CodexSelectionState;
  viewColumn?: vscode.ViewColumn;
}

export class CodexSelectionService {
  private readonly sessions = new Map<symbol, CodexSelectionSession>();
  private activeSessionId: symbol | undefined;

  public constructor(
    private readonly globalStorageUri: vscode.Uri,
    private readonly viewType: string
  ) {}

  public registerDocument(document: vscode.TextDocument, panel: vscode.WebviewPanel): symbol {
    const sessionId = Symbol(document.uri.toString());
    this.sessions.set(sessionId, { document });
    this.updatePanelState(sessionId, panel);
    return sessionId;
  }

  public updatePanelState(sessionId: symbol, panel: vscode.WebviewPanel): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    if (panel.viewColumn !== undefined) {
      session.viewColumn = panel.viewColumn;
    }

    if (panel.active) {
      this.activeSessionId = sessionId;
    }
  }

  public updateSelection(sessionId: symbol, payload: CodexSelectionPayload): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    const selection = createCodexSelectionState(payload);

    if (selection) {
      session.selection = selection;
      this.activeSessionId = sessionId;
    } else {
      session.selection = undefined;
    }
  }

  public unregisterDocument(sessionId: symbol): void {
    this.sessions.delete(sessionId);

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = undefined;
    }
  }

  public async addActiveSelectionToThread(): Promise<void> {
    const session = this.activeSessionId
      ? this.sessions.get(this.activeSessionId)
      : undefined;
    const document = session?.document;
    const selection = session?.selection;

    if (!document || !selection) {
      await vscode.window.showWarningMessage("Select text in Markflow before adding it to a Codex thread.");
      return;
    }

    const sourceRange = getSourceRange(document, selection);

    if (sourceRange) {
      if (!(await commandExists(CODEX_ADD_TO_THREAD_COMMAND))) {
        await showCodexMissingMessage();
        return;
      }

      await this.addSourceRangeToThread(document, sourceRange, session.viewColumn);
      return;
    }

    if (!(await commandExists(CODEX_ADD_FILE_TO_THREAD_COMMAND))) {
      await showCodexMissingMessage();
      return;
    }

    await this.addSelectionSnapshotToThread(document, selection);
  }

  private async addSourceRangeToThread(
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
      await vscode.commands.executeCommand("vscode.openWith", document.uri, this.viewType, {
        preserveFocus: true,
        preview: false,
        viewColumn: viewColumn ?? vscode.ViewColumn.Active
      });
    }
  }

  private async addSelectionSnapshotToThread(
    document: vscode.TextDocument,
    selection: CodexSelectionState
  ): Promise<void> {
    const selectionDirectory = vscode.Uri.joinPath(this.globalStorageUri, "codex-selections");
    await vscode.workspace.fs.createDirectory(selectionDirectory);

    const capturedAt = new Date();
    const fileName = createSelectionSnapshotFileName(document.uri.path, capturedAt);
    const selectionUri = vscode.Uri.joinPath(selectionDirectory, fileName);
    const snapshot = createSelectionSnapshot({
      capturedAt,
      selection,
      sourcePath: document.uri.fsPath
    });

    await vscode.workspace.fs.writeFile(selectionUri, Buffer.from(snapshot, "utf8"));
    await vscode.commands.executeCommand(CODEX_ADD_FILE_TO_THREAD_COMMAND, selectionUri);
  }
}

function getSourceRange(
  document: vscode.TextDocument,
  selection: CodexSelectionState
): vscode.Range | undefined {
  const sourceRange = resolveCodexSelectionRange(document.getText(), selection);

  if (!sourceRange) {
    return undefined;
  }

  return new vscode.Range(document.positionAt(sourceRange.startIndex), document.positionAt(sourceRange.endIndex));
}

async function commandExists(command: string): Promise<boolean> {
  const commands = await vscode.commands.getCommands(true);
  return commands.includes(command);
}

async function showCodexMissingMessage(): Promise<void> {
  await vscode.window.showWarningMessage("Install or enable the Codex extension before adding Markflow selections to a thread.");
}
