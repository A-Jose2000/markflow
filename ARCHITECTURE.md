# Markflow Architecture

Markflow shares one Markdown editing experience across VS Code and the Windows
desktop app. Markdown remains the source of truth; host-specific code supplies
files, navigation, persistence, and native capabilities around the shared
webview editor.

## Dependency Direction

Code should depend in one direction:

```text
contracts and pure models
          -> host adapters and persistence
          -> hooks and controllers
          -> components
          -> app and plugin composition roots
```

Composition roots wire behavior together. They should not own parsing,
validation, filesystem policy, hierarchy algorithms, or other reusable domain
rules.

## Packages

- `webview/` contains the shared React and MDXEditor experience used by VS Code
  and desktop.
- `src/` contains the VS Code extension host and its custom-editor provider.
- `desktop/` contains the Electron main process and preload bridge.
- `mobile/` contains the Android reader.
- `shared/` contains type-only contracts shared across application hosts. The
  VS Code custom-editor message protocol has one owner at
  `shared/markdownMessages.d.ts`.

## Block Editor

The block feature is divided into layers:

- Pure models own metadata encoding, hierarchy planning, selection planning,
  numbering, and command catalog filtering. They do not import React, Lexical,
  MDXEditor, or browser APIs.
- Lexical adapters own node state, Markdown visitors, logical-tree projection,
  canonical rewrites, and block mutations. Lexical `$` functions only run in a
  Lexical read or update transaction.
- Geometry and drag modules may read the DOM and logical tree, but do not own
  persistence policy.
- The React controller owns event registration and transient UI state. The
  plugin entrypoint only composes visitors and the controls layer.

The three Lexical `createState` values are module-level singletons. Markdown
visitor import state is created per plugin instance so documents cannot leak
metadata into one another.

## Desktop Renderer

Desktop IPC/domain contracts live under `webview/src/desktop/`. Bridge
discovery, autosave, path rules, tabs, and workspace state have separate
owners. React views receive these capabilities through typed props rather than
discovering globals themselves.

Renderer path logic must use `desktop/pathModel.ts`; do not recreate path
containment or relocation rules in `App.tsx` or explorer components.

## Mobile Reader

`mobile/App.tsx` is a composition root. Document/deep-link persistence lives
in `useMobileDocumentSession`, GitHub credential lifecycle lives in
`useGitHubCredentials`, and native controls remain presentation-only
components. Remote URL parsing, document loading, and storage policy stay in
their existing utility and storage modules rather than moving back into the
screen component.

Long-running document and credential operations use independent status and
generation state. A slower request must not overwrite the result of a newer
request, and GitHub status must not hide document-loading status.

## VS Code Host

`markdownEditorProvider.ts` is the custom-editor composition facade. Each open
panel gets a `CustomEditorSession`, which owns its watcher, message transport,
retry timers, document synchronization, and disposal. `CodexSelectionService`
owns active-document tracking and the Codex command adapter. Selection parsing,
range recovery, line-ending mapping, and snapshot formatting remain in pure
models with Node tests and do not import VS Code.

Webview messages cross a trust boundary and must pass through
`markdownMessageParser.ts`. Editor sessions serialize incoming edits, discard
stale asynchronous reads, and register Codex state by unique panel identity so
disposing an older panel cannot erase a newer panel's state.

## Electron Main

`desktop/main.cjs` is the Electron composition root. Supporting CommonJS
modules own:

- IPC channel names
- supported file and content types
- Markdown encoding, revisions, reads, and atomic writes
- public errors
- request validation
- workspace path containment

The sandboxed preload cannot require local CommonJS modules, so its channel
literals are mirrored from `channels.cjs`; `desktop/tests/channels.test.cjs`
guards that exception against drift. Every new packaged main-process module
must also be listed in `desktop/package.json`.

## Styles

`webview/src/editorTheme.css` is an ordered manifest. Its imports are arranged
from global shell styles through feature styles and responsive overrides.
Preserve that order when adding or moving rules; do not turn the manifest back
into an application-wide stylesheet.

## Testing

Pure policies receive Node unit tests next to the owning package. Stateful
block behavior is characterized by
`webview/tests/browser/markflow-unified-block-regression.mjs`; its README
documents the Vite and Chromium CDP prerequisites.

Before merging structural changes, run:

```bash
npm run check
```

The check inventories authored source, tests, configuration, and repository
scripts with POSIX-normalized file keys. It enforces an 800-line default cap,
tighter ratchets for composition roots and lifecycle facades, a shrinking cap
for the remaining browser characterization file, application-layer direction,
pure-model isolation, allowed composition-root importers, and an acyclic
internal module graph. It also runs the mobile typecheck when the mobile
workspace dependencies are installed; CI installs them before running the
same check.

Both extension and Windows packaging commands run the complete check before
creating an artifact.

For block interaction changes, also run the checked-in browser harness.

## Boundary Rules

- Do not import a React component to reuse a model or identity helper.
- Do not declare the same IPC channel, message contract, or path rule in two
  hosts.
- Prefer a pure model plus a thin host adapter over embedding policy in an
  effect or event handler.
- Extract cohesive ownership, not arbitrary line ranges.
- Preserve behavioral tests before moving stateful Lexical or Electron code.
