/**
 * Builds the Monaco bundle this plugin serves, into `dist/monaco`.
 *
 * Monaco cannot go through `bb plugin build` with the rest of the frontend:
 * that config emits one file with no code splitting, so Monaco would parse at
 * app boot for everyone — including everyone who only ever reads diffs — and
 * the worker could not be emitted at all. Building it here keeps it lazy:
 * `lib/monaco-loader.ts` imports these files from a `files.createPreview`
 * lease the first time someone asks to edit a diff.
 *
 * The output is committed. bb installs a git plugin's dependencies with
 * `--ignore-scripts --omit=dev --omit=optional`, and esbuild resolves its
 * native binary through an optional dependency plus a postinstall, so esbuild
 * is not merely absent on someone else's install, it cannot be there. Running
 * this script is a maintainer's job; `dist/monaco/` in git is what users get.
 *
 * `bb plugin build` stages and renames three named artifacts into `dist/` and
 * deletes only its own temp directory, so the committed `dist/monaco/`
 * survives a rebuild.
 */
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(pluginRoot, "package.json"));
const esbuild = require("esbuild");

const outDir = path.join(pluginRoot, "dist", "monaco");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// Monaco's own `editor.main` registers language *feature* clients for CSS,
// HTML, JSON and TypeScript, and there is no entry that gives you the editor
// without them. Left in, `languages.onLanguage("javascript")` starts the
// TypeScript client, which asks for a worker labelled "javascript", gets the
// base editor worker we ship, and throws `Missing requestHandler or method:
// getSyntacticDiagnostics` at the console on every JavaScript diff.
//
// Shipping a TypeScript worker to silence that would be worse. There is no
// language server behind this plugin and Monaco's checker would see one side
// of one file, so every "cannot find module" it reported would be a lie
// about the user's code. Stub the registrations out instead: the Monarch
// grammars live in `languages/definitions/` and are untouched, so files still
// get their colours.
const DROPPED_NAMESPACE = "monaco-dropped-service";

const dropLanguageServices = {
  name: "drop-language-services",
  setup(build) {
    const services = /languages\/features\/(css|html|json|typescript)\/register(\.js)?$/;
    build.onResolve({ filter: services }, (args) => ({
      path: args.path,
      namespace: DROPPED_NAMESPACE,
    }));
    build.onLoad({ filter: /.*/, namespace: DROPPED_NAMESPACE }, () => ({
      contents: "",
      loader: "js",
    }));
  },
};

const shared = {
  bundle: true,
  plugins: [dropLanguageServices],
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  absWorkingDir: pluginRoot,
  // Monaco's contributions style their icons with a webfont. Inlining it
  // keeps the bundle to the three files the loader knows how to fetch,
  // rather than a fourth whose URL would have to resolve relative to the
  // preview lease.
  loader: { ".ttf": "dataurl" },
};

// Two entries, not one: the worker runs in its own global scope and has to be
// a separate file for `new Worker(url)`.
const editor = await esbuild.build({
  ...shared,
  entryPoints: [path.join(pluginRoot, "monaco-bundle", "editor.js")],
  outfile: path.join(outDir, "editor.js"),
  metafile: true,
});
const worker = await esbuild.build({
  ...shared,
  entryPoints: [path.join(pluginRoot, "monaco-bundle", "worker.js")],
  outfile: path.join(outDir, "editor.worker.js"),
  metafile: true,
});

// A Monaco bundle can be missing whole features and still load, still open,
// and still let you type. That is how the first-party plugin once shipped
// without the find widget, and it is how this one nearly shipped a diff
// editor that renders two panes and computes nothing. Fail the build here
// rather than find out by looking at it.
const editorInputs = Object.keys(editor.metafile.inputs);
const editorOut = await readFile(path.join(outDir, "editor.js"), "utf8");
const workerOut = await readFile(path.join(outDir, "editor.worker.js"), "utf8");

const problems = [
  [
    "no language grammars — every file would render as plain text",
    () =>
      !editorInputs.some((input) =>
        input.includes("languages/definitions/"),
      ),
  ],
  [
    "no editor contributions — find, folding and word navigation would be gone",
    () => !editorInputs.some((input) => input.includes("editor/contrib/")),
  ],
  [
    "the language services are still bundled — they would ask for workers this " +
      "plugin does not ship and log errors on every diff",
    () =>
      editorInputs.some(
        (input) =>
          // The stubs keep their original path under the plugin's namespace,
          // so they show up here too; they are the fix, not the problem.
          !input.startsWith(`${DROPPED_NAMESPACE}:`) &&
          input.includes("languages/features/"),
      ),
  ],
  ["no find widget", () => !editorOut.includes("find-widget")],
  ["no folding", () => !editorOut.includes("foldRecursively")],
  ["no word navigation", () => !editorOut.includes("cursorWordLeft")],
  ["no diff editor", () => !editorOut.includes("monaco-diff-editor")],
  ["the editor never asks for a diff", () => !editorOut.includes("computeDiff")],
  ["the worker cannot answer one", () => !workerOut.includes("computeDiff")],
  [
    // `editor.worker.start.js` only exports `start`; it is `editor.worker.js`
    // that calls it and installs `self.onmessage`. Import the first by
    // mistake and the worker boots, ignores everything Monaco sends it, and
    // no diff is ever computed — with nothing logged anywhere.
    "the worker never listens — check that monaco-bundle/worker.js imports " +
      "editor.worker.js, not editor.worker.start.js",
    () => !/onmessage\s*=/.test(workerOut),
  ],
]
  .filter(([, wrong]) => wrong())
  .map(([problem]) => problem);
if (problems.length > 0) {
  throw new Error(`the Monaco bundle is wrong:\n- ${problems.join("\n- ")}`);
}

const bytes = [editor, worker]
  .flatMap((build) => Object.values(build.metafile.outputs))
  .reduce((total, output) => total + output.bytes, 0);
console.log(
  `monaco: built ${path.relative(pluginRoot, outDir)} (${(bytes / 1024 / 1024).toFixed(2)} MB editor + worker)`,
);
