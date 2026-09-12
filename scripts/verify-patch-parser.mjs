/**
 * Checks that the parser this plugin is tested against still reads patches the
 * same way as the one it runs against.
 *
 * `@pierre/diffs` is in devDependencies, not dependencies, because bb shims it
 * to a runtime global — the plugin's bundle never contains it. So `npm test`
 * exercises one copy and the app runs another, and the whole reason for using
 * bb's parser rather than writing one is that this plugin agrees with bb's
 * renderer by construction. That only holds while the two copies agree.
 *
 * They already do not, entirely. bb's copy leaves a malformed hunk's declared
 * counts on the hunk; newer copies recompute them. `lib/patch.ts` checks both,
 * and this is what would notice if a third difference showed up somewhere that
 * matters.
 *
 * Only the fields `lib/patch.ts` actually reads are compared. bb's copy also
 * disagrees about `collapsedBefore` and the rendered line counts for a
 * zero-context hunk, which are bb's renderer's business and not this plugin's.
 *
 * Needs an installed bb to compare against, so it is a maintainer's check
 * rather than part of `npm run check`. Without one it says so and exits 0.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PATCH_FIXTURES } from "../lib/patch-fixtures.ts";

/**
 * Differences that `lib/patch.ts` already copes with, and why. Anything not
 * listed here is what this check exists to find.
 */
const ACCEPTED = {
  malformed:
    "bb's copy leaves a malformed hunk's declared counts on the hunk; newer\n" +
    "    copies recompute them from what they managed to read. rebuildSides()\n" +
    "    checks the header and the content separately, so either shape is\n" +
    "    refused rather than silently rebuilt a line short.",
};

const KNOWN_PATCH =
  "diff --git a/probe.txt b/probe.txt\n--- a/probe.txt\n+++ b/probe.txt\n" +
  "@@ -1,2 +1,2 @@\n keep\n-was\n+now\n";

const bbAppRoot = findBbApp();
if (bbAppRoot === null) {
  console.log(
    "no installed bb found — skipping (this compares against bb's own copy of\n" +
      "@pierre/diffs, so it only runs where bb is installed)",
  );
  process.exit(0);
}

const shipped = await loadShippedParser(bbAppRoot);
if (shipped === null) {
  fail(
    `found bb at ${bbAppRoot} but no module in app/dist/assets exports a patch\n` +
      "parser — bb's build has changed shape and this check needs updating",
  );
}

const { parsePatchFiles: local } = await import("@pierre/diffs");

// The parser reports a malformed patch with console.error and recovers. One of
// the fixtures is malformed on purpose; its recovery is the interesting part.
const realError = console.error;
console.error = () => {};
const disagreements = [];
for (const [name, patch] of Object.entries(PATCH_FIXTURES)) {
  const fromBb = read(shipped, patch);
  const fromLocal = read(local, patch);
  if (fromBb !== fromLocal) disagreements.push({ name, fromBb, fromLocal });
}
console.error = realError;

const total = Object.keys(PATCH_FIXTURES).length;
const unexpected = disagreements.filter(({ name }) => !(name in ACCEPTED));
const stale = Object.keys(ACCEPTED).filter(
  (name) => !disagreements.some((found) => found.name === name),
);

if (unexpected.length > 0) {
  for (const { name, fromBb, fromLocal } of unexpected) {
    console.error(`\n${name}:`);
    console.error(`  bb ships   ${fromBb}`);
    console.error(`  we test on ${fromLocal}`);
  }
  fail(
    `\n${unexpected.length} of ${total} patches parse differently in bb than in\n` +
      "devDependencies, in ways nothing here knows about. Either lib/patch.ts\n" +
      "has to handle both shapes and the difference gets listed in ACCEPTED, or\n" +
      "the devDependency has to move to the version bb ships.",
  );
}

console.log(
  `patch parser: ${total} patches, bb at ${path.relative(homedir(), bbAppRoot)}`,
);
for (const { name } of disagreements) {
  console.log(`  differs as expected: ${name} — ${ACCEPTED[name]}`);
}
for (const name of stale) {
  console.log(
    `  no longer differs: ${name} — bb and devDependencies now agree, so the\n` +
      "    ACCEPTED entry can go once nothing older than this bb is supported",
  );
}
if (disagreements.length === 0 && stale.length === 0) {
  console.log("  no differences");
}

/** Projects a parse down to the fields `lib/patch.ts` reads. */
function read(parsePatchFiles, patch) {
  let files;
  try {
    files = parsePatchFiles(patch).flatMap((parsed) => parsed.files);
  } catch (error) {
    return `threw: ${error.message}`;
  }
  return JSON.stringify(
    files.map((file) => ({
      name: file.name,
      prevName: file.prevName,
      type: file.type,
      deletionLines: file.deletionLines,
      additionLines: file.additionLines,
      hunks: file.hunks.map((hunk) => ({
        additionStart: hunk.additionStart,
        additionCount: hunk.additionCount,
        additionLineIndex: hunk.additionLineIndex,
        deletionStart: hunk.deletionStart,
        deletionCount: hunk.deletionCount,
        deletionLineIndex: hunk.deletionLineIndex,
        hunkSpecs: hunk.hunkSpecs,
        hunkContent: hunk.hunkContent,
      })),
    })),
  );
}

/**
 * bb's frontend is built with hashed asset names, so the module holding the
 * parser cannot be named. It is found by its own error message instead, then
 * confirmed by parsing a patch whose answer is known.
 */
async function loadShippedParser(root) {
  const assets = path.join(root, "app", "dist", "assets");
  if (!existsSync(assets)) return null;

  const candidates = readdirSync(assets)
    .filter((name) => name.endsWith(".js"))
    .filter((name) =>
      readFileSync(path.join(assets, name), "utf8").includes(
        "parsePatchContent",
      ),
    );

  for (const name of candidates) {
    let module;
    try {
      module = await import(pathToFileURL(path.join(assets, name)).href);
    } catch {
      continue;
    }
    // Everything in here is minified to a single letter, so the parser has to
    // be found by calling things and seeing which one parses. Most of what gets
    // called objects, and some of it objects asynchronously — the theme loaders
    // reject rather than throw, which would take the process down as an
    // unhandled rejection before the parser is ever reached.
    const ignoreRejections = () => {};
    process.on("unhandledRejection", ignoreRejections);
    try {
      for (const value of Object.values(module)) {
        if (typeof value !== "function" || value.length !== 2) continue;
        let result;
        try {
          result = value(KNOWN_PATCH);
        } catch {
          continue;
        }
        if (typeof result?.then === "function") {
          result.then(ignoreRejections, ignoreRejections);
          continue;
        }
        const files = Array.isArray(result)
          ? result.flatMap((parsed) => parsed?.files ?? [])
          : [];
        if (files.length === 1 && files[0].hunks?.length === 1) return value;
      }
    } finally {
      process.off("unhandledRejection", ignoreRejections);
    }
  }
  return null;
}

function findBbApp() {
  const fromCli = process.env.BB_CLI;
  if (fromCli !== undefined) {
    // `<...>/node_modules/bb-app/host-daemon/dist/bb`
    const root = path.resolve(fromCli, "..", "..", "..");
    if (existsSync(path.join(root, "app", "dist"))) return root;
  }

  const npx = path.join(homedir(), ".npm", "_npx");
  if (!existsSync(npx)) return null;
  for (const entry of readdirSync(npx)) {
    const root = path.join(npx, entry, "node_modules", "bb-app");
    if (existsSync(path.join(root, "app", "dist"))) return root;
  }
  return null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
