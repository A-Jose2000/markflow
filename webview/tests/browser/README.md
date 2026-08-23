# Browser regression harness

This harness drives an already-open Markflow page through the Chromium DevTools
Protocol. It is intentionally separate from the default unit test command.

## Prerequisites

- Node.js 22 or newer, providing global `fetch` and `WebSocket`.
- A Vite development page serving the webview.
- A Chromium-based browser started with remote debugging and a disposable,
  non-default profile.

From the repository root, start the Vite page:

```sh
npm --prefix webview exec vite -- --host 127.0.0.1 --port 5181
```

In another terminal, launch Chrome, Chromium, or Edge by replacing the
placeholders with paths appropriate for your operating system:

```sh
<chromium-executable> \
  --remote-debugging-port=9223 \
  --user-data-dir=<temporary-profile-directory> \
  http://127.0.0.1:5181
```

Confirm that `http://127.0.0.1:9223/json/list` exposes a page whose URL uses
port `5181`.

## Run

The arguments are `[debug-url] [page-port] [mode]`. The first two default to
`http://127.0.0.1:9223` and `5181`.

Run the complete matrix:

```sh
npm --prefix webview run test:browser
```

Pass explicit connection values when using different ports:

```sh
npm --prefix webview run test:browser -- http://127.0.0.1:9333 5190
```

Run the focused numbering path:

```sh
npm --prefix webview run test:browser -- http://127.0.0.1:9223 5181 number
```

Run the focused toggle path:

```sh
npm --prefix webview run test:browser -- http://127.0.0.1:9223 5181 toggle
```

The harness reloads and mutates the selected page, so use a dedicated browser
profile and do not point it at a working document.
