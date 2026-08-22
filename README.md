<p align="center">
  <img src="images/markflow-icon.png" alt="Markflow logo" width="144" />
</p>

<h1 align="center">Markflow</h1>

A portable rich Markdown editor for local files in VS Code.

Markflow keeps Markdown as the source of truth. It opens `.md` and `.markdown` files in a dark, visual editor while saving changes back to the same local text file.

## Features

- Visual Markdown editing
- Dark editor theme
- Compact toolbar controls
- Markdown shortcuts
- Source/diff mode
- Frontmatter support
- Tables, task lists, links, images, quotes, and fenced code blocks
- Saves to normal `.md` files

## Install From VSIX

Build the package first:

```bash
npm install
npm --prefix webview install
npm run package
```

Then install the generated VSIX:

```bash
code --install-extension package/markflow-0.1.13.vsix
```

You can also install it from VS Code with:

```text
Extensions: Install from VSIX...
```

## Usage

Open a Markdown file, then run:

```text
Reopen Editor With... -> Markflow
```

Or use the command:

```text
Open as Rich Markdown
```

Markflow uses `priority: "option"`, so it will not aggressively take over every Markdown file. You can still reopen the same file in VS Code's default text editor at any time.

## Build

```bash
npm install
npm --prefix webview install
npm run build
npm run package
```

## Windows Desktop App

The Windows app uses the same rich editor as the VS Code extension and adds a native folder explorer. It shows folders plus supported Markdown, image, audio, video, and PDF files. Markdown opens in the editor with automatic saving; media opens in an in-app preview.

Install the desktop dependencies and run it locally:

```bash
npm install
npm --prefix webview install
npm --prefix desktop install
npm run desktop
```

Build both an x64 NSIS installer and a portable `.exe` from Windows:

```bash
npm run package:windows
```

The Windows artifacts are written to `desktop/release/`. Unsigned local builds may trigger a Microsoft SmartScreen warning.

## Android Reader

The Android React Native reader lives in `mobile/`. It opens Markdown from the Android document picker or from raw/GitHub Markdown links, and its EAS `preview` profile builds an installable APK.
The APK build uses EAS Build, so you will need to be logged in to Expo.

```bash
cd mobile
pnpm install
pnpm build:apk
```

## Development

Use the VS Code launch configuration named `Run Extension` to open an Extension Development Host.

```bash
npm run watch
```

## Limitations

- Some Markdown may be normalized by the rich editor.
- Very large files may be slower in this first version.
- Remote VS Code environments such as WSL, SSH, and dev containers may need the VSIX installed separately.
- The first version applies full-document edits on each debounced change.

## Project Brief

The original implementation brief is kept in `portable-markdown-editor-extension-brief.md`.
