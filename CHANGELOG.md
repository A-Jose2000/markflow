# Changelog

## 0.1.8

- Open Markflow in Rich mode by default.
- Added explicit height constraints for MDXEditor's diff/source plugin wrappers so Rich mode content can scroll.

## 0.1.7

- Moved Rich Markdown scrolling to MDXEditor's bounded content wrapper so rich documents can scroll correctly.

## 0.1.6

- Added dedicated scroll containers and dark scrollbar styling for Raw Markdown and Rich Markdown content.

## 0.1.5

- Moved the Raw/Rich switch into a dedicated top bar to prevent overlap with the rich editor toolbar.
- Added stronger dark theme overrides for MDXEditor toolbar buttons, select triggers, icons, and dropdown items.

## 0.1.4

- Open in raw Markdown mode by default with a Raw/Rich mode switch, so file contents remain visible while rich editing is debugged.

## 0.1.3

- Lazy-load the rich MDXEditor bundle so the raw Markdown editor can render if rich-editor startup fails.
- Re-send the initial document from the extension host after webview startup to make the document handshake more reliable.

## 0.1.2

- Added startup diagnostics and a raw Markdown fallback when rich Markdown parsing fails.
- Avoided saving MDXEditor's initial normalization callback back to the source document.

## 0.1.1

- Fixed a webview startup race that could make non-empty Markdown files appear blank when opened with Markflow.

## 0.1.0

- Initial Markflow MVP scaffold.
- Added a VS Code custom text editor for Markdown files.
- Added a bundled React webview powered by MDXEditor.
- Added dark styling, toolbar controls, Markdown shortcuts, and source/diff mode.
- Added local VSIX packaging support.
