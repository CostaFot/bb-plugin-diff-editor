/**
 * Proves the shipped bundle can actually compute a diff.
 *
 * "Monaco loads" is the wrong thing to check. `computeDiff` runs in the web
 * worker, and a diff editor whose worker never starts still renders: two
 * panes of text, no change decorations, no error in the console. It looks
 * like a plugin that does nothing rather than one that is broken, which is
 * the worst way to find out. So the check here is that `onDidUpdateDiff`
 * fires and reports the changes it should.
 *
 * It runs the real artifacts — `dist/monaco/editor.js`, `editor.worker.js`
 * and `editor.css` as committed — over HTTP in headless Chromium, because a
 * module worker needs a real origin and jsdom has neither.
 *
 * With a bb server around (`BB_SERVER_URL`, which bb sets inside a thread)
 * the three files are fetched through a real `files.createPreview` lease, so
 * the path the plugin actually uses — lease creation, bb's own routing, the
 * content types it serves — is what gets checked. Without one it reads them
 * off disk, so this still runs in CI or a bare checkout.
 *
 * The page itself is always served locally. It has to be same-origin with
 * the worker it constructs, and bb serves preview HTML sandboxed into an
 * opaque origin, where `new Worker` cannot reach anything.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const bundleDir = path.join(pluginRoot, "dist", "monaco");
const DIFF_TIMEOUT_MS = 20_000;

if (!existsSync(path.join(bundleDir, "editor.js"))) {
  fail("dist/monaco/editor.js is missing — run `npm run build:monaco`");
}

// Two changes with untouched lines between them, so the expected answer is a
// specific number rather than "more than nothing". A worker that starts but
// answers badly, or a diff that only notices the first hunk, fails here
// instead of passing on a technicality.
const ORIGINAL = [
  "const greeting = 'hello';",
  "",
  "function shout(value) {",
  "  return value.toUpperCase();",
  "}",
  "",
  "export default greeting;",
  "",
].join("\n");
const MODIFIED = [
  "const greeting = 'hello, world';",
  "",
  "function shout(value) {",
  "  return value.toUpperCase();",
  "}",
  "",
  "export { shout };",
  "export default greeting;",
  "",
].join("\n");
const EXPECTED_CHANGES = 2;

const PAGE = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="./editor.css">
<div id="host" style="width:900px;height:500px"></div>
<script type="module">
  globalThis.MonacoEnvironment = {
    getWorker: () =>
      new Worker(new URL("./editor.worker.js", location.href), { type: "module" }),
  };
  window.__verify = (async () => {
    const { monaco } = await import("./editor.js");
    const original = monaco.editor.createModel(${JSON.stringify(ORIGINAL)}, "javascript");
    const modified = monaco.editor.createModel(${JSON.stringify(MODIFIED)}, "javascript");
    const diffEditor = monaco.editor.createDiffEditor(
      document.getElementById("host"),
      { automaticLayout: false, renderSideBySide: true },
    );
    // Counted rather than awaited. The event firing is the thing being
    // proven, but a worker that never starts never fires it, so waiting on it
    // would hang instead of failing — which is exactly the silence this check
    // exists to break.
    let updates = 0;
    diffEditor.onDidUpdateDiff(() => { updates += 1; });

    const computed = new Promise((resolve, reject) => {
      const deadline = Date.now() + ${DIFF_TIMEOUT_MS - 4000};
      const settled = () => {
        if (updates === 0) return null;
        const changes = diffEditor.getLineChanges();
        // onDidUpdateDiff also fires before the worker answers, with
        // nothing computed. That empty first call is exactly what a worker
        // that never starts looks like forever, so wait for real changes.
        if (changes === null || changes.length < ${EXPECTED_CHANGES}) return null;
        const decorations = document.querySelectorAll(
          ".line-insert, .line-delete, .char-insert, .char-delete",
        ).length;
        // The grammars load through a dynamic import inside Monaco. If the
        // bundler left that unresolved every line tokenizes as one class and
        // the diff renders in a single colour — loaded, working, and plainly
        // wrong to look at.
        const tokenClasses = new Set(
          [...document.querySelectorAll(".view-line span span")].map(
            (span) => span.className,
          ),
        );
        if (decorations === 0 || tokenClasses.size < 2) return null;
        return {
          changes: changes.length,
          updates,
          tokenClasses: tokenClasses.size,
        };
      };
      const poll = () => {
        const result = settled();
        if (result !== null) {
          resolve(result);
          return;
        }
        if (Date.now() > deadline) {
          reject(
            new Error(
              updates === 0
                ? "onDidUpdateDiff never fired — the editor worker did not answer"
                : "onDidUpdateDiff fired " + updates + " times but nothing was " +
                  "computed or rendered: changes=" +
                  JSON.stringify(diffEditor.getLineChanges()),
            ),
          );
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    });
    diffEditor.setModel({ original, modified });
    return await computed;
  })();
</script>
`;

const MIME = { ".js": "text/javascript", ".css": "text/css" };

const lease = await createLease();

const server = createServer((request, response) => {
  const name = path.basename(new URL(request.url, "http://localhost").pathname);
  if (name === "" || name === "index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
    return;
  }
  if (lease !== null) {
    void proxyFromLease(name, response);
    return;
  }
  const file = path.join(bundleDir, name);
  if (!existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[path.extname(name)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/index.html`;

const profileDir = await mkdtemp(path.join(tmpdir(), "diff-editor-verify-"));
const chromium = resolveChromium();
const browser = spawn(
  chromium,
  [
    "--headless=new",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    pageUrl,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browserStderr = "";
browser.stderr.on("data", (chunk) => {
  browserStderr += String(chunk);
});

try {
  const result = await run();
  console.log(
    `diff worker: onDidUpdateDiff fired ${result.updates}x — ${result.changes} changes, ` +
      `${result.tokenClasses} token classes, decorations rendered ` +
      `(served ${lease === null ? "from disk" : "through a bb preview lease"})`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), browserStderr);
} finally {
  browser.kill();
  // Chromium keeps writing to its profile for a moment after SIGTERM, and
  // removing it underneath produces an ENOTEMPTY that would mask the result.
  await once(browser, "exit").catch(() => {});
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  server.close();
}

async function run() {
  const devtoolsUrl = await devtoolsEndpoint();
  const socket = new WebSocket(devtoolsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("could not attach to Chromium")),
      { once: true },
    );
  });

  let nextId = 0;
  const pending = new Map();
  const pageErrors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      pageErrors.push(
        details.exception?.description ?? details.text ?? "unknown page error",
      );
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    waiter(message);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");

  // The page starts loading before the socket attaches, so `window.__verify`
  // may or may not exist yet; wait for it rather than racing it.
  const response = await send("Runtime.evaluate", {
    expression: `new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (window.__verify) { window.__verify.then(resolve, reject); return; }
        if (Date.now() - started > ${DIFF_TIMEOUT_MS}) {
          reject(new Error("the page never reached the Monaco import"));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  socket.close();

  if (response.error) {
    throw new Error(
      `Chromium rejected the evaluation: ${response.error.message}`,
    );
  }
  const details = response.result.exceptionDetails;
  if (details) {
    const reported = details.exception?.description ?? details.text;
    throw new Error([reported, ...pageErrors].filter(Boolean).join("\n"));
  }
  const value = response.result.result.value;
  if (value.changes !== EXPECTED_CHANGES) {
    throw new Error(
      `the diff editor reported ${value.changes} changes, expected ${EXPECTED_CHANGES}`,
    );
  }

  return value;
}

async function devtoolsEndpoint() {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (browser.exitCode !== null) {
      throw new Error(`Chromium exited with code ${browser.exitCode}`);
    }
    try {
      const [port] = (await readFile(portFile, "utf8")).split("\n");
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
        (response) => response.json(),
      );
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chromium has not written the port or opened the tab yet.
    }
    await delay(100);
  }
  throw new Error("Chromium never exposed a debugging endpoint");
}

function resolveChromium() {
  const configured = process.env.CHROMIUM_BIN;
  if (configured) return configured;
  for (const candidate of [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
  ]) {
    const found = onPath(candidate);
    if (found) return found;
  }
  fail(
    "no Chromium found — install one or set CHROMIUM_BIN to its path.\n" +
      "This check needs a real browser: a module worker has no origin in jsdom.",
  );
}

/**
 * Asks bb for a preview lease over the bundle, exactly as the plugin's
 * `assets` RPC does. Returns null when there is no bb server to ask.
 */
async function createLease() {
  const serverUrl = process.env.BB_SERVER_URL;
  if (!serverUrl) return null;
  const response = await fetch(new URL("/api/v1/files/previews", serverUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: bundleDir, ttlMs: 10 * 60 * 1000 }),
  });
  if (!response.ok) {
    fail(
      `bb refused a preview lease over ${bundleDir}: ${response.status} ${await response.text()}`,
    );
  }
  const { baseUrl } = await response.json();
  return new URL(baseUrl, serverUrl);
}

async function proxyFromLease(name, response) {
  const upstream = await fetch(`${lease.href}/${name}`);
  const body = Buffer.from(await upstream.arrayBuffer());
  // Pass bb's own content type through rather than guessing. A module import
  // or a module worker refuses anything that is not a JavaScript MIME type,
  // so getting this wrong on bb's side has to fail the check, not be papered
  // over here.
  response.writeHead(upstream.status, {
    "content-type":
      upstream.headers.get("content-type") ?? "application/octet-stream",
  });
  response.end(body);
}

function onPath(command) {
  try {
    return execFileSync("which", [command], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function fail(message, extra = "") {
  console.error(`diff worker check failed: ${message}`);
  if (extra.trim()) console.error(extra.trim());
  process.exit(1);
}
