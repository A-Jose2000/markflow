# Portable VS Code Markdown Editor Extension Brief

This document describes a portable VS Code extension project for editing local Markdown files with a polished, Notion-like writing experience while keeping Markdown as the source of truth.

Use this as the project brief for a new standalone repository. Replace placeholder names such as `<extension-name>`, `<publisher>`, and `<display-name>` before publishing or packaging.

## Project Goal

Build a standalone, exportable VS Code extension that opens local `.md` files in a rich Markdown editor.

The extension should be:

- Portable across future computers.
- Usable from any VS Code project.
- Installable as a `.vsix` without depending on this repository.
- Publishable later to the VS Code Marketplace if desired.
- Markdown-first, so files remain readable and editable in any plain text editor.
- Dark-themed by default.

This should feel inspired by Notion's easy writing flow, but it should not become a proprietary document format. Markdown on disk is the durable truth.

## Core Product Principles

1. Markdown files are the source of truth.
2. The extension must not require project-specific setup to work.
3. The editor should save back to the actual local `.md` file.
4. The extension should not patch VS Code internals.
5. The MVP should prioritize reliable Markdown round-tripping over fancy block behavior.
6. Formatting changes should be predictable and should avoid unnecessary rewrites.
7. The user should always be able to reopen the same file in VS Code's default text editor.

## Recommended Technical Direction

Build a VS Code extension using `CustomTextEditorProvider`.

Why:

- Markdown is a text format.
- VS Code handles the underlying `TextDocument`, save lifecycle, dirty state, hot exit, undo integration, and file watching better with custom text editors than with a fully custom document model.
- The extension can provide a React webview for the rich editor while still writing edits into the normal VS Code document.

Use a bundled React webview for the editor UI.

Use `MDXEditor` for the first implementation.

Why MDXEditor:

- It accepts Markdown directly.
- It exposes change callbacks and methods such as `getMarkdown` and `setMarkdown`.
- It supports plugins for headings, lists, quotes, tables, code blocks, frontmatter, source/diff mode, toolbar actions, and Markdown shortcuts.
- It is more Markdown-native than a block editor that treats Markdown export as lossy.

Avoid BlockNote for the MVP unless the project later chooses to accept lossy Markdown export. BlockNote is more visually Notion-like, but its Markdown export/import model is not ideal when Markdown files must remain clean and dependable.

## Initial Feature Set

The first usable version should support:

- Open `.md` files with the custom editor.
- Reopen files with the default text editor.
- Edit Markdown visually.
- Save changes back to the same local file.
- Dark-only UI.
- Toolbar controls:
  - Undo
  - Redo
  - Heading level
  - Bold
  - Italic
  - Inline code
  - Link
  - Bulleted list
  - Numbered list
  - Task list
  - Blockquote
  - Code block
  - Table
  - Horizontal rule
  - Source/diff toggle
- Markdown shortcuts:
  - `#` for headings
  - `-` or `*` for lists
  - `>` for blockquotes
  - Triple backticks for code blocks
  - `Ctrl+B` / `Cmd+B` for bold
  - `Ctrl+I` / `Cmd+I` for italic
  - `Ctrl+K` / `Cmd+K` for links
- Preserve frontmatter.
- Preserve fenced code blocks.
- Preserve links and images as Markdown.
- Preserve tables as Markdown.
- Preserve task lists as Markdown.

## Non-Goals For MVP

Do not build these in the first version:

- Cloud sync.
- Accounts.
- Collaboration.
- AI writing tools.
- Database views.
- Kanban boards.
- Backlinks graph.
- Full Notion block database behavior.
- Proprietary JSON document storage.
- Cross-file knowledge base indexing.

These can come later after the editor is stable.

## Repository Structure

Recommended standalone repo layout:

```text
<extension-name>/
  README.md
  CHANGELOG.md
  LICENSE
  package.json
  tsconfig.json
  .vscode/
    launch.json
    tasks.json
    extensions.json
  src/
    extension.ts
    markdownEditorProvider.ts
    webviewHtml.ts
  webview/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      App.tsx
      main.tsx
      editorTheme.css
      vscodeApi.ts
      markdownMessages.ts
  scripts/
    package-extension.mjs
  package/
    .gitkeep
```

The root package owns the VS Code extension host code.

The `webview/` package owns the React editor UI bundle.

The `package/` folder stores generated `.vsix` files if you want local artifacts in the repo. Do not commit every generated package forever unless you intentionally want that history.

## Package Metadata

The extension `package.json` should include:

```json
{
  "name": "<extension-name>",
  "displayName": "<display-name>",
  "description": "A portable rich Markdown editor for local files in VS Code.",
  "version": "0.1.0",
  "publisher": "<publisher>",
  "engines": {
    "vscode": "^1.90.0"
  },
  "categories": ["Other", "Formatters"],
  "activationEvents": [
    "onCustomEditor:<publisher>.<extension-name>.markdownEditor"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "customEditors": [
      {
        "viewType": "<publisher>.<extension-name>.markdownEditor",
        "displayName": "<display-name>",
        "selector": [
          {
            "filenamePattern": "*.md"
          },
          {
            "filenamePattern": "*.markdown"
          }
        ],
        "priority": "option"
      }
    ],
    "commands": [
      {
        "command": "<extension-name>.openAsRichMarkdown",
        "title": "Open as Rich Markdown"
      }
    ],
    "configuration": {
      "title": "<display-name>",
      "properties": {
        "<extension-name>.defaultTheme": {
          "type": "string",
          "default": "dark",
          "enum": ["dark"],
          "description": "Theme used by the rich Markdown editor."
        },
        "<extension-name>.debounceMs": {
          "type": "number",
          "default": 250,
          "description": "Delay before sending editor changes back to VS Code."
        }
      }
    }
  },
  "scripts": {
    "build": "npm run build:webview && npm run build:extension",
    "build:extension": "tsc -p tsconfig.json",
    "build:webview": "npm --prefix webview run build",
    "watch": "concurrently \"tsc -watch -p tsconfig.json\" \"npm --prefix webview run dev\"",
    "package": "vsce package --out package",
    "check": "npm run build"
  },
  "devDependencies": {
    "@types/node": "latest",
    "@types/vscode": "latest",
    "@vscode/vsce": "latest",
    "concurrently": "latest",
    "typescript": "latest"
  }
}
```

Use `priority: "option"` at first so the extension does not aggressively take over every Markdown file. The user can choose it with **Reopen Editor With...** and later configure it as default.

After the editor is stable, consider changing to `priority: "default"` only if you truly want it to open automatically.

## Extension Host Responsibilities

The VS Code extension host code should:

- Register a `CustomTextEditorProvider`.
- Load the compiled webview assets.
- Send the initial Markdown text to the webview.
- Receive edited Markdown from the webview.
- Apply edits to the backing `TextDocument`.
- Listen for external document changes and update the webview.
- Avoid edit loops when the webview caused the change.
- Respect VS Code workspace trust and webview security.
- Restrict `localResourceRoots` to the extension's bundled assets.
- Use a Content Security Policy in the webview HTML.

Suggested files:

- `src/extension.ts`
- `src/markdownEditorProvider.ts`
- `src/webviewHtml.ts`

## Webview Message Protocol

Use a small typed message protocol.

Extension to webview:

```ts
type ExtensionToWebviewMessage =
  | {
      type: "init";
      markdown: string;
      readonly: boolean;
    }
  | {
      type: "update";
      markdown: string;
    };
```

Webview to extension:

```ts
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
```

Keep the protocol boring. It should be easy to debug in five minutes six months from now.

## Applying Edits

For MVP, replace the full document text on each debounced edit.

This is simpler and acceptable for ordinary Markdown notes.

Later, improve this with minimal diffs if:

- Undo behavior feels too coarse.
- Large files become slow.
- Cursor synchronization becomes annoying.

Full replacement example:

```ts
const edit = new vscode.WorkspaceEdit();
const fullRange = new vscode.Range(
  document.positionAt(0),
  document.positionAt(document.getText().length)
);
edit.replace(document.uri, fullRange, nextMarkdown);
await vscode.workspace.applyEdit(edit);
```

Avoid applying an edit if the incoming Markdown equals `document.getText()`.

Use an `isApplyingEdit` flag to prevent feedback loops.

## Webview UI Responsibilities

The React webview should:

- Initialize the editor with Markdown from the extension.
- Render a dark-only editing surface.
- Provide a compact toolbar.
- Send debounced Markdown changes back to the extension.
- Accept external updates from the extension.
- Avoid overwriting local edits if the editor is actively composing text.
- Support source/diff mode through MDXEditor plugins.

Suggested MDXEditor plugins:

- `headingsPlugin`
- `listsPlugin`
- `quotePlugin`
- `thematicBreakPlugin`
- `linkPlugin`
- `linkDialogPlugin`
- `tablePlugin`
- `codeBlockPlugin`
- `codeMirrorPlugin`
- `frontmatterPlugin`
- `diffSourcePlugin`
- `toolbarPlugin`
- `markdownShortcutPlugin`

## Webview Styling

The design should feel like a quiet writing tool, not a marketing page.

Use:

- Dark-only theme.
- Full editor canvas.
- Compact top toolbar.
- Subtle borders.
- High contrast Markdown content.
- No decorative backgrounds.
- No nested cards.
- No landing page.

Suggested color tokens:

```css
:root {
  --app-bg: #0d1117;
  --panel-bg: #111827;
  --panel-border: #30363d;
  --text-main: #e6edf3;
  --text-muted: #8b949e;
  --accent: #58a6ff;
  --code-text: #ffb86c;
  --code-bg: #161b22;
  --danger: #f85149;
}
```

The editor should look good in a VS Code webview, including WSL/Remote windows.

## Commands

Add at least one command:

```text
Open as Rich Markdown
```

Behavior:

- If the active file is Markdown, reopen it with the custom editor.
- If no Markdown file is active, show a friendly warning.

Optional later commands:

- Toggle source mode.
- Export current file to HTML.
- Insert table.
- Insert callout.
- Create linked note.

## Portability Plan

The project should be portable in three ways.

### Local VSIX

Build a `.vsix`:

```bash
npm run build
npm run package
```

Install it on another computer:

```bash
code --install-extension package/<extension-name>-0.1.0.vsix
```

You can also install from VS Code with:

```text
Extensions: Install from VSIX...
```

### GitHub Releases

For each version:

1. Update `CHANGELOG.md`.
2. Bump `package.json` version.
3. Run `npm run build`.
4. Run `npm run package`.
5. Create a GitHub release.
6. Attach the generated `.vsix`.

This is the simplest private distribution path.

### Marketplace Later

Later, publish with:

```bash
vsce publish
```

Only do this after:

- The extension has a stable name.
- The publisher ID is chosen.
- The README is polished.
- The icon is not SVG.
- The extension has been tested on at least two machines.

## Recommended Workspace Integration

Once published or installed globally, any project can recommend it with:

```json
{
  "recommendations": [
    "<publisher>.<extension-name>"
  ]
}
```

Put that in:

```text
.vscode/extensions.json
```

This should be optional. The extension must still work without project-specific files.

## Remote, WSL, And Dev Container Notes

VS Code extensions may need to be installed separately in remote environments such as WSL, SSH, or dev containers.

Document this clearly:

```bash
code --install-extension package/<extension-name>-0.1.0.vsix
```

If using WSL, run the install command from the environment where VS Code is actually hosting the extension.

The extension should avoid absolute local paths so the same `.vsix` works on Linux, macOS, Windows, WSL, and remote workspaces.

## Security Requirements

The webview must use a strict Content Security Policy.

Do:

- Use `webview.asWebviewUri` for local bundled assets.
- Use a nonce for scripts.
- Keep `localResourceRoots` narrow.
- Avoid remote scripts.
- Avoid inline scripts unless nonce-protected.
- Sanitize or carefully handle any rendered HTML.

Do not:

- Load arbitrary remote JavaScript.
- Evaluate Markdown content as script.
- Give the webview broad file access.
- Store document contents outside the Markdown file unless explicitly requested.

## Testing Checklist

Before calling v0.1 usable, test:

- Open a simple `.md` file.
- Edit text and save.
- Close and reopen file.
- Reopen with default text editor and verify Markdown is correct.
- Reopen with rich editor and verify content is correct.
- Undo and redo basic edits.
- Edit from default text editor while rich editor is open.
- Edit from rich editor while default text editor is open.
- Headings round-trip.
- Lists round-trip.
- Task lists round-trip.
- Links round-trip.
- Images round-trip.
- Tables round-trip.
- Fenced code blocks round-trip.
- Frontmatter round-trips.
- Source/diff mode works.
- VSIX installs on a clean VS Code profile.
- Extension works in WSL or a remote VS Code window.

## Acceptance Criteria For MVP

The MVP is complete when:

- A `.vsix` can be produced with `npm run package`.
- The `.vsix` can be installed on another machine or clean VS Code profile.
- `.md` files can be opened with the custom editor.
- Editing visually updates the real Markdown file.
- Saving uses normal VS Code save behavior.
- The same file remains readable in any normal Markdown editor.
- The editor has a dark theme and usable toolbar.
- The README explains install, usage, packaging, and limitations.

## Known Risks

### Markdown Reformatting

Rich editors often normalize Markdown. This may rewrite spacing, table formatting, list markers, or link syntax.

Mitigation:

- Keep plugins focused.
- Test round-tripping with real files.
- Provide source mode.
- Avoid features that require proprietary data.

### Large Files

Full-document replacement can be slow for very large Markdown files.

Mitigation:

- Start with full replacement.
- Add diff-based edits later if needed.

### Conflicting Editors

Users may open the same file in the rich editor and plain text editor.

Mitigation:

- Listen to `onDidChangeTextDocument`.
- Push external changes into the webview.
- Avoid edit loops.

### Extension Host Location

Remote VS Code windows may require separate extension installation.

Mitigation:

- Document VSIX install clearly.
- Avoid platform-specific paths.

## README Outline

The extension README should include:

```markdown
# <display-name>

A portable rich Markdown editor for local files in VS Code.

## Features

- Visual Markdown editing
- Dark theme
- Toolbar controls
- Markdown shortcuts
- Source/diff mode
- Saves to normal `.md` files

## Install From VSIX

\`\`\`bash
code --install-extension package/<extension-name>-0.1.0.vsix
\`\`\`

## Usage

Open a Markdown file, then run:

\`\`\`text
Reopen Editor With... -> <display-name>
\`\`\`

## Build

\`\`\`bash
npm install
npm run build
npm run package
\`\`\`

## Limitations

- Some Markdown may be normalized by the rich editor.
- Very large files may be slower in the first version.
- Remote VS Code environments may need separate VSIX installation.
\`\`\`
```

## Suggested First Build Plan

1. Scaffold the VS Code extension.
2. Add a minimal custom text editor that displays raw Markdown in a webview.
3. Add message passing between extension and webview.
4. Replace raw textarea with MDXEditor.
5. Add toolbar and core plugins.
6. Add dark styling.
7. Add source/diff mode.
8. Add package script for `.vsix`.
9. Test install on a clean VS Code profile.
10. Create the first GitHub release with the `.vsix`.

## Helpful Official References

- VS Code Custom Editor API: https://code.visualstudio.com/api/extension-guides/custom-editors
- VS Code Publishing Extensions: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- VS Code Extension Marketplace and VSIX install: https://code.visualstudio.com/docs/configure/extensions/extension-marketplace
- MDXEditor Getting Started: https://mdxeditor.dev/editor/docs/getting-started
- MDXEditor Toolbar: https://mdxeditor.dev/editor/docs/customizing-toolbar
- MDXEditor Markdown Shortcuts: https://mdxeditor.dev/editor/docs/markdown-shortcuts
