// Loads the Monaco bundle the server leases to us, once per app session.
//
// The bundle is not part of `dist/app.js`. bb builds the frontend as one file
// with no code splitting, so bundling Monaco there would parse 4 MB at app
// boot for everyone — including everyone who only ever reads diffs — and the
// web worker could not be emitted at all. Instead the server hands out a
// `files.createPreview` lease over `dist/monaco/` and this imports from it.
import type * as MonacoNs from "monaco-editor";

interface MonacoBundle {
  monaco?: typeof MonacoNs;
}

let bootPromise: Promise<typeof MonacoNs> | null = null;

// Leases expire, and Monaco starts workers whenever it feels like it — not
// only during boot. So the worker URL is read at `getWorker` time from
// whichever lease was most recently handed in, rather than captured from the
// first one. A worker constructed from an expired lease 404s, and a diff
// editor with no worker shows no changes and says nothing about why.
let currentBaseUrl = "";

/**
 * `baseUrl` is the `baseUrl` of an `assets` lease: a same-origin path
 * (`/api/v1/file-previews/<id>`). Same-origin matters — a module worker has
 * to share an origin with the page that constructs it.
 *
 * The import is memoized. A lease outlives the editors opened from it, and
 * re-importing would mean a second 4 MB parse and a second copy of Monaco's
 * global state. Pass the current lease on every call anyway; it is cheap and
 * it is what keeps the worker URL fresh.
 */
export function loadMonaco(baseUrl: string): Promise<typeof MonacoNs> {
  currentBaseUrl = baseUrl;
  bootPromise ??= boot(baseUrl);
  return bootPromise;
}

async function boot(baseUrl: string): Promise<typeof MonacoNs> {
  await injectStylesheet(`${baseUrl}/editor.css`);

  // Monaco starts this lazily and never reports a failure to start it. The
  // diff itself is computed in there, so without this a diff editor renders
  // two panes of text, no change decorations, and nothing in the console.
  (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker: () =>
      new Worker(
        new URL(`${currentBaseUrl}/editor.worker.js`, location.origin),
        { type: "module" },
      ),
  };

  // Everything Monaco loads after this point has to already be inside the
  // bundle, because the lease serves three files and nothing else. Notably
  // `diffAlgorithm: "advanced"` makes it fetch `@vscode/diff` at diff time,
  // which would 404 here — the default algorithm is bundled, so leave it be.
  const bundle: MonacoBundle = await import(
    /* @vite-ignore */ `${baseUrl}/editor.js`
  );
  if (!bundle.monaco) {
    throw new Error("the Monaco bundle did not expose its API");
  }
  return bundle.monaco;
}

function injectStylesheet(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`could not load ${href}`));
    document.head.appendChild(link);
  });
}

/**
 * A node outside the diff card for Monaco's overflowing widgets to live in.
 *
 * bb's diff card body sets `contain: layout paint style`, which makes it a
 * containing block *and* clips anything painted past its bounds. A diff card
 * is a few hunks tall, and the widgets that declare `allowEditorOverflow` —
 * hover, suggest, parameter hints — are the ones that routinely need more
 * room than that, so inside the card they are cropped to whatever fits.
 *
 * `fixedOverflowWidgets` plus a node on `document.body` is Monaco's own answer
 * to that: it moves each editor's overflowing content and overlay widget
 * containers here, out from under the containment. The first-party
 * monaco-editor plugin already does this; the id is this plugin's own so that,
 * with both installed, the two do not fight over one node's theme class.
 */
const OVERFLOW_NODE_ID = "bb-plugin-diff-editor-overflow-widgets";

export function overflowWidgetsNode(): HTMLElement {
  const existing = document.getElementById(OVERFLOW_NODE_ID);
  if (existing !== null) return existing;
  const node = document.createElement("div");
  node.id = OVERFLOW_NODE_ID;
  node.className = "monaco-editor";
  node.style.position = "absolute";
  node.style.top = "0";
  node.style.left = "0";
  node.style.zIndex = "40";
  // Electron resolves native window-drag regions separately from CSS
  // stacking, so a widget crossing a drag strip loses its hit target without
  // this. It is the same marker bb puts on its own portaled surfaces.
  node.setAttribute("data-bb-portaled-overlay", "");
  document.body.appendChild(node);
  return node;
}

/** Monaco styles widgets off the theme class on their container, not the editor. */
export function setOverflowWidgetsTheme(base: "vs" | "vs-dark"): void {
  const node = document.getElementById(OVERFLOW_NODE_ID);
  if (node !== null) node.className = `monaco-editor ${base}`;
}
