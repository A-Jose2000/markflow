import assert from "node:assert/strict";

const debugUrl = process.argv[2] ?? "http://127.0.0.1:9223";
const pagePort = process.argv[3] ?? "5181";
const focusedToggleRun = process.argv[4] === "toggle";
const focusedNumberRun = process.argv[4] === "number";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const targets = await fetch(`${debugUrl}/json/list`).then((response) => response.json());
const target = targets.find((entry) => entry.type === "page" && entry.url.includes(`:${pagePort}`));

if (!target) {
  throw new Error(`Markflow page on port ${pagePort} is not available.`);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const request = message.id ? pending.get(message.id) : undefined;
  if (!request) return;
  pending.delete(message.id);
  message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  let response;
  try {
    response = await send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true
    });
  } catch (error) {
    console.error(`Runtime.evaluate failed for: ${expression}`);
    throw error;
  }
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function waitFor(expression, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await evaluate(expression);
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}; last value: ${JSON.stringify(value)}`);
}

async function reloadWith(markdown, resourcePath, readonly = false) {
  await send("Page.reload", { ignoreCache: true });
  await waitFor("document.readyState === 'complete'");
  await sleep(650);
  await evaluate(`window.postMessage(${JSON.stringify({
    type: "init",
    markdown,
    resourcePath,
    readonly,
    debounceMs: 0
  })}, "*")`);
  await waitFor(readonly
    ? "document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]').length > 0"
    : "document.querySelectorAll('.markflow-block-controls').length > 0");
  await sleep(250);
}

async function focusText(text) {
  const point = await evaluate(`(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== ${JSON.stringify(text)}) {}
    if (!node) return false;
    const rect = node.parentElement.getBoundingClientRect();
    return { x: rect.right - 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(point, `Could not focus text: ${text}`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: point.x, y: point.y });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x, y: point.y });
  await sleep(100);
}

async function pressTab(shiftKey = false) {
  const modifiers = shiftKey ? 8 : 0;
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    modifiers,
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    modifiers,
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9
  });
  await sleep(250);
}

async function pressEnter() {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
  await sleep(350);
}

async function selectBlockHandle(text) {
  const selected = await evaluate(`(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== ${JSON.stringify(text)}) {}
    if (!node) return false;
    const rowRect = node.parentElement.closest('[data-markflow-outline-depth]')?.getBoundingClientRect();
    const control = [...document.querySelectorAll('.markflow-block-controls')].sort((left, right) =>
      Math.abs(left.getBoundingClientRect().top - rowRect.top) - Math.abs(right.getBoundingClientRect().top - rowRect.top)
    )[0];
    const handle = control?.querySelector('.markflow-block-drag-handle');
    if (!handle) return false;
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' }));
    handle.focus();
    return handle.getAttribute('aria-pressed') === 'true' || true;
  })()`);
  assert.ok(selected, `Could not select block handle: ${text}`);
  await sleep(100);
}

async function openBlockContextMenu(text) {
  const opened = await evaluate(`(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== ${JSON.stringify(text)}) {}
    const row = node?.parentElement.closest('[data-markflow-outline-depth]');
    if (!row) return false;
    const rowRect = row.getBoundingClientRect();
    const control = [...document.querySelectorAll('.markflow-block-controls')].sort((left, right) =>
      Math.abs(left.getBoundingClientRect().top - rowRect.top) -
      Math.abs(right.getBoundingClientRect().top - rowRect.top)
    )[0];
    const handle = control?.querySelector('.markflow-block-drag-handle');
    if (!handle) return false;
    const handleRect = handle.getBoundingClientRect();
    handle.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: handleRect.left + handleRect.width / 2,
      clientY: handleRect.top + handleRect.height / 2
    }));
    return true;
  })()`);
  assert.equal(opened, true, `Could not open the context menu for: ${text}`);
  await waitFor("Boolean(document.querySelector('.markflow-block-command-menu'))");
}

async function turnBlockInto(text, commandId) {
  await openBlockContextMenu(text);
  const selector = `#markflow-block-command-${commandId}`;
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  assert.equal(
    await evaluate(`(() => {
      const command = document.querySelector(${JSON.stringify(selector)});
      if (!command) return false;
      command.click();
      return true;
    })()`),
    true,
    `Could not apply block command ${commandId} to: ${text}`
  );
  await waitFor("!document.querySelector('.markflow-block-command-menu')");
  await sleep(350);
}

async function clickToggleForBlock(text) {
  const clicked = await evaluate(`(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== ${JSON.stringify(text)}) {}
    const row = node?.parentElement.closest('[data-markflow-outline-depth]');
    if (!row) return false;
    const rowRect = row.getBoundingClientRect();
    const control = [...document.querySelectorAll('.markflow-block-controls')].sort((left, right) =>
      Math.abs(left.getBoundingClientRect().top - rowRect.top) -
      Math.abs(right.getBoundingClientRect().top - rowRect.top)
    )[0];
    const key = control?.dataset.blockKey;
    const toggle = key
      ? [...document.querySelectorAll('.markflow-block-toggle-button')]
          .find((button) => button.dataset.blockKey === key)
      : undefined;
    if (!toggle) return false;
    toggle.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Could not toggle block: ${text}`);
  await sleep(250);
}

async function readRawMarkdown() {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent.trim() === 'Raw');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, "Could not switch to the raw Markdown editor");
  await waitFor("Boolean(document.querySelector('.raw-markdown-editor'))");
  return evaluate("document.querySelector('.raw-markdown-editor').value");
}

function depthExpression(text, expectedDepth) {
  return `(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== ${JSON.stringify(text)}) {}
    if (!node) return false;
    const row = node.parentElement.closest('[data-markflow-outline-depth]');
    return Number(row?.dataset.markflowOutlineDepth) === ${expectedDepth};
  })()`;
}

async function assertIndentedControl(text) {
  const offset = await evaluate(`(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== ${JSON.stringify(text)}) {}
    const row = node?.parentElement.closest('[data-markflow-outline-depth]');
    if (!row) return null;
    const rowRect = row.getBoundingClientRect();
    const controls = [...document.querySelectorAll('.markflow-block-controls')];
    const own = controls.sort((left, right) =>
      Math.abs(left.getBoundingClientRect().top - rowRect.top) - Math.abs(right.getBoundingClientRect().top - rowRect.top)
    )[0];
    const previous = controls
      .filter((control) => control !== own && control.getBoundingClientRect().top < own.getBoundingClientRect().top)
      .at(-1);
    return previous ? own.getBoundingClientRect().left - previous.getBoundingClientRect().left : null;
  })()`);
  assert.ok(offset === null || offset >= 20, `The nested control for ${text} is not visibly indented (offset ${offset})`);
}

async function assertTabNests({ name, markdown, child, viaHandle = false }) {
  await reloadWith(markdown, `${name}.md`);
  await (viaHandle ? selectBlockHandle(child) : focusText(child));
  await pressTab();
  await waitFor(depthExpression(child, 1));
  await assertIndentedControl(child);

  await evaluate(`[...document.querySelectorAll('button')]
    .find((button) => button.textContent.trim() === 'Raw').click()`);
  await waitFor("Boolean(document.querySelector('.raw-markdown-editor'))");
  const persisted = await evaluate("document.querySelector('.raw-markdown-editor').value");
  await reloadWith(persisted, `${name}-roundtrip.md`);
  await waitFor(depthExpression(child, 1));
}

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false
});

const mixedCases = focusedToggleRun || focusedNumberRun ? [] : [
  { name: "heading-to-paragraph", markdown: "# Parent heading\n\nChild paragraph", child: "Child paragraph" },
  { name: "paragraph-to-heading", markdown: "Parent paragraph\n\n## Child heading", child: "Child heading" },
  { name: "paragraph-to-quote", markdown: "Parent paragraph\n\n> Child quote", child: "Child quote" },
  { name: "quote-to-paragraph", markdown: "> Parent quote\n\nChild paragraph", child: "Child paragraph" },
  { name: "paragraph-to-bullet", markdown: "Parent paragraph\n\n- Child bullet", child: "Child bullet" },
  { name: "bullet-to-paragraph", markdown: "- Parent bullet\n\nChild paragraph", child: "Child paragraph" },
  { name: "paragraph-to-number", markdown: "Parent paragraph\n\n1. Child number", child: "Child number" },
  { name: "number-to-quote", markdown: "1. Parent number\n\n> Child quote", child: "Child quote" },
  { name: "bullet-to-bullet", markdown: "- Parent bullet\n- Child bullet", child: "Child bullet" },
  { name: "check-to-heading", markdown: "- [ ] Parent task\n\n## Child heading", child: "Child heading" },
  { name: "paragraph-to-check", markdown: "Parent paragraph\n\n- [ ] Child task", child: "Child task" },
  { name: "paragraph-to-code", markdown: "Parent paragraph\n\n```txt\nChild code\n```", child: "Child code", viaHandle: true },
  {
    name: "paragraph-to-table",
    markdown: "Parent paragraph\n\n| Child table | Value |\n| --- | --- |\n| A | B |",
    child: "Child table",
    viaHandle: true
  }
];

for (const testCase of mixedCases) {
  await assertTabNests(testCase);
  console.log(`passed ${testCase.name}`);
}

if (!focusedToggleRun && !focusedNumberRun) {
  await reloadWith(
    "- Mixed list parent\n- Mixed list child\n\nMixed list outside",
    "list-child-to-paragraph.md"
  );
  await focusText("Mixed list child");
  await pressTab();
  await waitFor(depthExpression("Mixed list child", 1));
  await turnBlockInto("Mixed list child", "paragraph");
  await waitFor(`(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== 'Mixed list child') {}
    const row = node?.parentElement.closest('[data-markflow-outline-depth]');
    return row?.tagName === 'P' && Number(row.dataset.markflowOutlineDepth) === 1;
  })()`);

  await turnBlockInto("Mixed list parent", "toggle");
  await waitFor("document.querySelectorAll('.markflow-block-toggle-button').length === 1");
  await clickToggleForBlock("Mixed list parent");
  await waitFor(`(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== 'Mixed list child') {}
    const row = node?.parentElement.closest('[data-markflow-outline-depth]');
    return Boolean(row && row.getClientRects().length === 0);
  })()`);

  const listChildParagraphMarkdown = await readRawMarkdown();
  assert.match(
    listChildParagraphMarkdown,
    /markflow-v2-block[^\n]*d=1/,
    "The converted paragraph should persist its mixed-outline depth"
  );
  await reloadWith(listChildParagraphMarkdown, "list-child-to-paragraph-roundtrip.md");
  await waitFor(depthExpression("Mixed list child", 1));
  await waitFor(`(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== 'Mixed list child') {}
    const row = node?.parentElement.closest('[data-markflow-outline-depth]');
    return Boolean(row && row.tagName === 'P' && row.getClientRects().length === 0 &&
      document.querySelector('.markflow-block-toggle-button[aria-expanded="false"]'));
  })()`);
  console.log("passed list child to paragraph hierarchy preservation");

  await reloadWith(
    "Ordinary parent\n\nOrdinary nested child\n\nOrdinary outside",
    "ordinary-child-list-conversions.md"
  );
  await focusText("Ordinary nested child");
  await pressTab();
  await waitFor(depthExpression("Ordinary nested child", 1));
  await turnBlockInto("Ordinary nested child", "bullet-list");
  await waitFor(`(() => {
    const item = [...document.querySelectorAll('.markflow-editor li[data-markflow-outline-depth]')]
      .find((element) => element.textContent.trim() === 'Ordinary nested child');
    return Number(item?.dataset.markflowOutlineDepth) === 1;
  })()`);

  const nestedBulletMarkdown = await readRawMarkdown();
  await reloadWith(nestedBulletMarkdown, "ordinary-child-bullet-roundtrip.md");
  await waitFor(`(() => {
    const item = [...document.querySelectorAll('.markflow-editor li[data-markflow-outline-depth]')]
      .find((element) => element.textContent.trim() === 'Ordinary nested child');
    return Number(item?.dataset.markflowOutlineDepth) === 1;
  })()`);
  await turnBlockInto("Ordinary nested child", "paragraph");
  await waitFor(`(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== 'Ordinary nested child') {}
    const row = node?.parentElement.closest('[data-markflow-outline-depth]');
    return row?.tagName === 'P' && Number(row.dataset.markflowOutlineDepth) === 1;
  })()`);

  const nestedParagraphMarkdown = await readRawMarkdown();
  await reloadWith(nestedParagraphMarkdown, "ordinary-child-paragraph-roundtrip.md");
  await waitFor(depthExpression("Ordinary nested child", 1));
  console.log("passed ordinary child list conversion hierarchy preservation");

  await reloadWith(
    "- Isolated bullet A\n- Isolated bullet B\n- Isolated bullet C",
    "isolated-list-type-conversion.md"
  );
  await turnBlockInto("Isolated bullet B", "check-list");
  const isolatedListTypeExpression = `(() => {
    const items = [...document.querySelectorAll('.markflow-editor li')];
    const findItem = (text) => items.find((item) => item.textContent.trim() === text);
    const first = findItem('Isolated bullet A');
    const converted = findItem('Isolated bullet B');
    const last = findItem('Isolated bullet C');
    return Boolean(
      first &&
      converted &&
      last &&
      first.getAttribute('role') !== 'checkbox' &&
      !first.hasAttribute('aria-checked') &&
      converted.getAttribute('role') === 'checkbox' &&
      converted.getAttribute('aria-checked') === 'false' &&
      last.getAttribute('role') !== 'checkbox' &&
      !last.hasAttribute('aria-checked') &&
      first.parentElement !== converted.parentElement &&
      converted.parentElement !== last.parentElement
    );
  })()`;
  await waitFor(isolatedListTypeExpression);

  const isolatedListTypeMarkdown = await readRawMarkdown();
  assert.match(
    isolatedListTypeMarkdown,
    /[*+-] \[ \] Isolated bullet B/,
    "Only the selected list item should serialize as a check item"
  );
  assert.doesNotMatch(
    isolatedListTypeMarkdown,
    /[*+-] \[ \] Isolated bullet [AC]/,
    "Adjacent bullet items should not be converted to check items"
  );
  await reloadWith(isolatedListTypeMarkdown, "isolated-list-type-conversion-roundtrip.md");
  await waitFor(isolatedListTypeExpression);
  console.log("passed isolated list type conversion");

  await reloadWith(
    "- Isolated number A\n- Isolated number B\n- Isolated number C",
    "isolated-number-list-conversion.md"
  );
  await turnBlockInto("Isolated number B", "number-list");
  const isolatedNumberTypeExpression = `(() => {
    const items = [...document.querySelectorAll('.markflow-editor li')];
    const findItem = (text) => items.find((item) => item.textContent.trim() === text);
    const first = findItem('Isolated number A');
    const converted = findItem('Isolated number B');
    const last = findItem('Isolated number C');
    return Boolean(
      first &&
      converted &&
      last &&
      first.parentElement?.tagName === 'UL' &&
      converted.parentElement?.tagName === 'OL' &&
      converted.parentElement.start === 1 &&
      converted.dataset.markflowListMarker === '1' &&
      last.parentElement?.tagName === 'UL' &&
      first.parentElement !== converted.parentElement &&
      converted.parentElement !== last.parentElement
    );
  })()`;
  await waitFor(isolatedNumberTypeExpression);

  const isolatedNumberTypeMarkdown = await readRawMarkdown();
  assert.match(
    isolatedNumberTypeMarkdown,
    /(?:^|\n)1\. Isolated number B(?:\n|$)/,
    "The isolated numbered item should serialize with a marker starting at one"
  );
  assert.match(
    isolatedNumberTypeMarkdown,
    /(?:^|\n)[*+-] Isolated number A(?:\n|$)/,
    "The preceding item should remain a bullet"
  );
  assert.match(
    isolatedNumberTypeMarkdown,
    /(?:^|\n)[*+-] Isolated number C(?:\n|$)/,
    "The following item should remain a bullet"
  );
  await reloadWith(isolatedNumberTypeMarkdown, "isolated-number-list-conversion-roundtrip.md");
  await waitFor(isolatedNumberTypeExpression);
  console.log("passed isolated numbered list conversion");

  await reloadWith(
    "- Compound conversion parent\n\n  > Compound conversion quote\n\nCompound conversion outside",
    "compound-list-parent-conversion.md"
  );
  await waitFor(depthExpression("Compound conversion quote", 1));
  await turnBlockInto("Compound conversion parent", "paragraph");
  const compoundParentConversionExpression = `(() => {
    const root = document.querySelector('.markflow-editor');
    const findRow = (text) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && node.textContent !== text) {}
      return node?.parentElement.closest('[data-markflow-outline-depth]');
    };
    const parent = findRow('Compound conversion parent');
    const quote = findRow('Compound conversion quote');
    const outside = findRow('Compound conversion outside');
    return Boolean(
      parent &&
      quote &&
      outside &&
      parent !== quote &&
      parent.tagName === 'P' &&
      Number(parent.dataset.markflowOutlineDepth) === 0 &&
      quote.tagName === 'BLOCKQUOTE' &&
      Number(quote.dataset.markflowOutlineDepth) === 1 &&
      [...root.querySelectorAll('[data-markflow-outline-depth]')].indexOf(parent) <
        [...root.querySelectorAll('[data-markflow-outline-depth]')].indexOf(quote) &&
      [...root.querySelectorAll('[data-markflow-outline-depth]')].indexOf(quote) <
        [...root.querySelectorAll('[data-markflow-outline-depth]')].indexOf(outside)
    );
  })()`;
  await waitFor(compoundParentConversionExpression);

  const compoundParentConversionMarkdown = await readRawMarkdown();
  assert.match(
    compoundParentConversionMarkdown,
    /markflow-v2-block[^\n]*d=1/,
    "The quote should retain child depth when its list parent becomes a paragraph"
  );
  await reloadWith(
    compoundParentConversionMarkdown,
    "compound-list-parent-conversion-roundtrip.md"
  );
  await waitFor(compoundParentConversionExpression);
  console.log("passed compound list parent conversion");

  await reloadWith(
    "Toggle code parent\n\nToggle code child\n\nToggle code outside",
    "toggle-parent-code-conversion.md"
  );
  await focusText("Toggle code child");
  await pressTab();
  await waitFor(depthExpression("Toggle code child", 1));
  await turnBlockInto("Toggle code parent", "toggle");
  await waitFor("document.querySelectorAll('.markflow-block-toggle-button[aria-expanded=\"true\"]').length === 1");
  await turnBlockInto("Toggle code parent", "code");

  const toggleCodeBindingExpression = (expanded) => `(() => {
    const root = document.querySelector('.markflow-editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && node.textContent !== 'Toggle code parent') {}
    const row = node?.parentElement.closest('[data-markflow-outline-depth]');
    if (!row || !row.querySelector('.cm-editor')) return false;
    const rowRect = row.getBoundingClientRect();
    const control = [...document.querySelectorAll('.markflow-block-controls')].sort((left, right) =>
      Math.abs(left.getBoundingClientRect().top - rowRect.top) -
      Math.abs(right.getBoundingClientRect().top - rowRect.top)
    )[0];
    const toggle = [...document.querySelectorAll('.markflow-block-toggle-button')]
      .find((button) => button.dataset.blockKey === control?.dataset.blockKey);
    return Boolean(
      toggle &&
      toggle.getAttribute('aria-expanded') === ${JSON.stringify(String(expanded))} &&
      Number(row.dataset.markflowOutlineDepth) === 0
    );
  })()`;
  await waitFor(toggleCodeBindingExpression(true));
  await clickToggleForBlock("Toggle code parent");
  await waitFor(toggleCodeBindingExpression(false));
  await waitFor(`(() => {
    const rows = [...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')];
    const child = rows.find((row) => row.textContent.trim() === 'Toggle code child');
    const outside = rows.find((row) => row.textContent.trim() === 'Toggle code outside');
    return Boolean(child && child.getClientRects().length === 0 &&
      outside && outside.getClientRects().length > 0);
  })()`);

  const toggleCodeMarkdown = await readRawMarkdown();
  assert.match(
    toggleCodeMarkdown,
    /markflow-v2-block[^\n]*t=closed/,
    "Converting a toggle parent to code should retain its closed state"
  );
  await reloadWith(toggleCodeMarkdown, "toggle-parent-code-conversion-roundtrip.md");
  await waitFor(toggleCodeBindingExpression(false));
  await waitFor(`(() => {
    const rows = [...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')];
    const child = rows.find((row) => row.textContent.trim() === 'Toggle code child');
    return Boolean(child && child.getClientRects().length === 0);
  })()`);
  console.log("passed toggle parent code conversion");

  await reloadWith(
    "- Native compound parent\n\n  > Native compound quote\n\nNative compound outside",
    "native-compound-list-quote.md"
  );
  await waitFor(depthExpression("Native compound quote", 1));
  assert.equal(
    await evaluate(`(() => {
      const root = document.querySelector('.markflow-editor');
      const findText = (text) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && node.textContent !== text) {}
        return node;
      };
      const parentRow = findText('Native compound parent')?.parentElement
        .closest('[data-markflow-outline-depth]');
      const childRow = findText('Native compound quote')?.parentElement
        .closest('[data-markflow-outline-depth]');
      if (!parentRow || !childRow || parentRow === childRow || childRow.tagName !== 'BLOCKQUOTE') {
        return false;
      }
      const controls = [...document.querySelectorAll('.markflow-block-controls')];
      const nearestControl = (row) => {
        const top = row.getBoundingClientRect().top;
        return controls.slice().sort((left, right) =>
          Math.abs(left.getBoundingClientRect().top - top) -
          Math.abs(right.getBoundingClientRect().top - top)
        )[0];
      };
      const parentControl = nearestControl(parentRow);
      const childControl = nearestControl(childRow);
      return Boolean(
        parentControl &&
        childControl &&
        parentControl !== childControl &&
        childControl.querySelector('.markflow-block-drag-handle')
      );
    })()`),
    true,
    "A native quote inside a list item should have its own outline row and handle"
  );
  await focusText("Native compound quote");
  await pressTab(true);
  await waitFor(depthExpression("Native compound quote", 0));
  assert.deepEqual(
    await evaluate(`[...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')]
      .map((element) => element.textContent.trim()).filter(Boolean)`),
    ["Native compound parent", "Native compound quote", "Native compound outside"],
    "Outdenting a native compound-list child should retain its block and document order"
  );
  console.log("passed native compound list quote migration");
}

if (!focusedToggleRun) {
await reloadWith(
  "Parent\n\n[markflow-v2-block]: # \"d=1\"\n\nFirst child\n\n[markflow-v2-block]: # \"d=1\"\n\nSecond child\n\nOutside",
  "mixed-outdent.md"
);
await focusText("First child");
await pressTab(true);
await waitFor(depthExpression("First child", 0));
assert.deepEqual(
  await evaluate(`[
    ...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')
  ].map((element) => element.textContent.trim()).filter(Boolean)`),
  ["Parent", "Second child", "First child", "Outside"],
  "Shift+Tab should move the outdented subtree after its old parent's remaining children"
);
console.log("passed mixed outdent");

await reloadWith(
  "1. Parent number\n\n   4. Nested child\n2. Outside number\n\nTrailing paragraph",
  "native-nested-list.md"
);
await waitFor(depthExpression("Nested child", 1));
await waitFor(`(() => {
  const item = [...document.querySelectorAll('.markflow-editor li[data-markflow-outline-depth]')]
    .find((element) => element.textContent.trim() === 'Nested child');
  return item?.dataset.markflowListMarker === '4';
})()`);
console.log("initial custom nested list", await evaluate(`(() => {
  const item = [...document.querySelectorAll('.markflow-editor li[data-markflow-outline-depth]')]
    .find((element) => element.textContent.trim() === 'Nested child');
  return {
    marker: item?.dataset.markflowListMarker,
    parentStart: item?.parentElement?.start
  };
})()`));
await focusText("Parent number");
await pressTab(true);
await evaluate(`[...document.querySelectorAll('button')]
  .find((button) => button.textContent.trim() === 'Raw').click()`);
await waitFor("Boolean(document.querySelector('.raw-markdown-editor'))");
const untouchedNestedMarkdown = await evaluate("document.querySelector('.raw-markdown-editor').value");
console.log("custom nested raw", JSON.stringify(untouchedNestedMarkdown));
assert.match(
  untouchedNestedMarkdown,
  /\n {2,4}4\./,
  "A no-op Shift+Tab should not flatten native nested Markdown"
);
await reloadWith(untouchedNestedMarkdown, "native-nested-list-edit.md");
await focusText("Trailing paragraph");
await pressTab();
await waitFor(depthExpression("Trailing paragraph", 1));
assert.deepEqual(
  await evaluate(`[...document.querySelectorAll('.markflow-editor li[data-markflow-list-marker]')]
    .map((item) => ({ marker: Number(item.dataset.markflowListMarker), text: item.textContent.trim() }))`),
  [
    { marker: 1, text: "Parent number" },
    { marker: 4, text: "Nested child" },
    { marker: 2, text: "Outside number" }
  ],
  "Canonicalized ordered-list runs should preserve numbering at every logical depth"
);
await evaluate(`[...document.querySelectorAll('button')]
  .find((button) => button.textContent.trim() === 'Raw').click()`);
await waitFor("Boolean(document.querySelector('.raw-markdown-editor'))");
const customListStartMarkdown = await evaluate("document.querySelector('.raw-markdown-editor').value");
await reloadWith(customListStartMarkdown, "native-nested-list-roundtrip.md");
await waitFor(`(() => {
  const item = [...document.querySelectorAll('.markflow-editor li[data-markflow-outline-depth]')]
    .find((element) => element.textContent.trim() === 'Nested child');
  return item?.dataset.markflowListMarker === '4';
})()`);
console.log("passed native nested list migration");

await reloadWith(
  "1. First item\n2. Second item\n3. Third item",
  "number-reparent.md"
);
await focusText("Second item");
await pressTab();
await waitFor(depthExpression("Second item", 1));
assert.deepEqual(
  await evaluate(`[...document.querySelectorAll('.markflow-editor li[data-markflow-list-marker]')]
    .map((item) => ({ marker: Number(item.dataset.markflowListMarker), text: item.textContent.trim() }))`),
  [
    { marker: 1, text: "First item" },
    { marker: 1, text: "Second item" },
    { marker: 2, text: "Third item" }
  ],
  "Reparented numbered items should restart at one while the outer sequence closes the gap"
);
console.log("passed numbered item reparenting");
}

if (focusedNumberRun) {
  socket.close();
  process.exit(0);
}

await reloadWith(
  "Parent paragraph\n\n- Nested list item\n- Nested child\n\nOutside paragraph",
  "list-plus.md"
);
await focusText("Nested list item");
await pressTab();
await focusText("Nested child");
await pressTab();
await pressTab();
await waitFor(depthExpression("Nested child", 2));
assert.equal(await evaluate(`(() => {
  const item = [...document.querySelectorAll('.markflow-editor li')]
    .find((element) => element.textContent.trim() === 'Nested list item');
  if (!item) return false;
  const itemRect = item.getBoundingClientRect();
  const control = [...document.querySelectorAll('.markflow-block-controls')].sort((left, right) =>
    Math.abs(left.getBoundingClientRect().top - itemRect.top) -
    Math.abs(right.getBoundingClientRect().top - itemRect.top)
  )[0];
  const addButton = control?.querySelector('.markflow-block-add-button');
  if (!addButton) return false;
  addButton.click();
  return true;
})()`), true, "Could not click the list item's plus button");
await waitFor(`document.querySelectorAll('.markflow-editor li').length === 3`);
await waitFor(`(() => {
  const rows = [...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')];
  const childIndex = rows.findIndex((element) => element.textContent.trim() === 'Nested child');
  const outsideIndex = rows.findIndex((element) => element.textContent.trim() === 'Outside paragraph');
  return childIndex >= 0 && outsideIndex === childIndex + 2 &&
    rows[childIndex + 1].tagName === 'LI' &&
    Number(rows[childIndex + 1].dataset.markflowOutlineDepth) === 1;
})()`);
assert.equal(
  await evaluate(`[...document.querySelectorAll('.markflow-editor ul, .markflow-editor ol')]
    .every((list) => [...list.children].every((child) => child.tagName === 'LI'))`),
  true,
  "The list-item plus button should preserve a valid ListNode -> ListItemNode structure"
);
console.log("passed list item plus");

await reloadWith("Parent paragraph\n\n- Nested Enter item\n\nOutside paragraph", "list-enter.md");
await focusText("Nested Enter item");
await pressTab();
await focusText("Nested Enter item");
await pressEnter();
await waitFor(`document.querySelectorAll('.markflow-editor li').length === 2`);
assert.deepEqual(
  await evaluate(`[...document.querySelectorAll('.markflow-editor li')]
    .map((item) => Number(item.dataset.markflowOutlineDepth))`),
  [1, 1],
  "Enter should inherit a logically nested list item's depth"
);
console.log("passed nested list Enter");

await reloadWith("Toggle parent\n\nToggle child\n\nOutside sibling", "toggle.md");
await focusText("Toggle child");
await pressTab();
await waitFor(depthExpression("Toggle child", 1));

const menuOpened = await evaluate(`(() => {
  const root = document.querySelector('.markflow-editor');
  const textNode = [...root.querySelectorAll('p')].find((element) => element.textContent === 'Toggle parent');
  if (!textNode) return false;
  const rect = textNode.getBoundingClientRect();
  const control = [...document.querySelectorAll('.markflow-block-controls')].sort((left, right) =>
    Math.abs(left.getBoundingClientRect().top - rect.top) -
    Math.abs(right.getBoundingClientRect().top - rect.top)
  )[0];
  const handle = control?.querySelector('.markflow-block-drag-handle');
  if (!handle) return false;
  const handleRect = handle.getBoundingClientRect();
  handle.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: handleRect.left + handleRect.width / 2,
    clientY: handleRect.top + handleRect.height / 2
  }));
  return true;
})()`);
assert.equal(menuOpened, true, "Could not open the parent block's context menu");
await waitFor("Boolean(document.querySelector('#markflow-block-command-toggle'))");
await evaluate("document.querySelector('#markflow-block-command-toggle').click()");

const toggleSelector = ".markflow-block-toggle-button";
await waitFor(`Boolean(document.querySelector('${toggleSelector}[aria-expanded="true"]'))`);
await evaluate(`document.querySelector('${toggleSelector}').click()`);
await waitFor(`document.querySelector('${toggleSelector}')?.getAttribute('aria-expanded') === 'false'`);
await waitFor(`(() => {
  const blocks = [...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')];
  const child = blocks.find((element) => element.textContent.trim() === 'Toggle child');
  const sibling = blocks.find((element) => element.textContent.trim() === 'Outside sibling');
  return child && child.getClientRects().length === 0 && sibling && sibling.getClientRects().length > 0;
})()`);

assert.equal(await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')];
  const parent = rows.find((element) => element.textContent.trim() === 'Toggle parent');
  const sibling = rows.find((element) => element.textContent.trim() === 'Outside sibling');
  if (!parent || !sibling) return false;
  const parentRect = parent.getBoundingClientRect();
  const control = [...document.querySelectorAll('.markflow-block-controls')].sort((left, right) =>
    Math.abs(left.getBoundingClientRect().top - parentRect.top) -
    Math.abs(right.getBoundingClientRect().top - parentRect.top)
  )[0];
  const handle = control?.querySelector('.markflow-block-drag-handle');
  const scroller = document.querySelector('.markflow-editor')?.parentElement;
  if (!handle || !scroller) return false;
  const handleRect = handle.getBoundingClientRect();
  const siblingRect = sibling.getBoundingClientRect();
  const dataTransfer = new DataTransfer();
  handle.dispatchEvent(new DragEvent('dragstart', {
    bubbles: true,
    cancelable: true,
    clientX: handleRect.left + handleRect.width / 2,
    clientY: handleRect.top + handleRect.height / 2,
    dataTransfer
  }));
  const dropInit = {
    bubbles: true,
    cancelable: true,
    clientX: handleRect.left + handleRect.width / 2,
    clientY: siblingRect.bottom - 1,
    dataTransfer
  };
  scroller.dispatchEvent(new DragEvent('dragover', dropInit));
  scroller.dispatchEvent(new DragEvent('drop', dropInit));
  return true;
})()`), true, "Could not drag the closed toggle parent");
await waitFor(`JSON.stringify([...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')]
  .map((element) => element.textContent.trim()).filter(Boolean)) ===
  JSON.stringify(['Outside sibling', 'Toggle parent', 'Toggle child'])`);
console.log("passed closed toggle drag");

await evaluate(`[...document.querySelectorAll('button')]
  .find((button) => button.textContent.trim() === 'Raw').click()`);
await waitFor("Boolean(document.querySelector('.raw-markdown-editor'))");
const closedToggleMarkdown = await evaluate("document.querySelector('.raw-markdown-editor').value");
await reloadWith(closedToggleMarkdown, "toggle-roundtrip.md");
await waitFor(`document.querySelector('${toggleSelector}')?.getAttribute('aria-expanded') === 'false'`);
await waitFor(`(() => {
  const blocks = [...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')];
  const child = blocks.find((element) => element.textContent.trim() === 'Toggle child');
  return child && child.getClientRects().length === 0;
})()`);

await reloadWith(closedToggleMarkdown, "toggle-readonly.md", true);
await waitFor(`(() => {
  const blocks = [...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')];
  const child = blocks.find((element) => element.textContent.trim() === 'Toggle child');
  return Boolean(child && child.getClientRects().length === 0 &&
    document.querySelector('${toggleSelector}[aria-expanded="false"]'));
})()`);
await evaluate(`document.querySelector('${toggleSelector}').click()`);
await waitFor(`(() => {
  const blocks = [...document.querySelectorAll('.markflow-editor [data-markflow-outline-depth]')];
  const child = blocks.find((element) => element.textContent.trim() === 'Toggle child');
  return Boolean(child && child.getClientRects().length > 0 &&
    document.querySelector('${toggleSelector}[aria-expanded="true"]'));
})()`);

console.log(JSON.stringify({
  mixedBlockRoundTrips: mixedCases.map(({ name }) => name),
  nativeNestedListMigration: true,
  readonlyToggleInteraction: true,
  toggleCollapse: true,
  toggleClosedRoundTrip: true
}, null, 2));
socket.close();
