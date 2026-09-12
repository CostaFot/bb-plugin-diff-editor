// The patches live in `lib/patch-fixtures.ts`, shared with the parser-drift
// check so both are looking at the same shapes.
//
// These run against the `@pierre/diffs` in devDependencies, while the plugin
// runs against the copy bb shims in. `npm run verify:patch-parser` is what says
// those two still agree; it is not assumed here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePatchFiles } from "@pierre/diffs";

import { PATCH_FIXTURES as P } from "./patch-fixtures.ts";
import { parseFilePatch, rebuildSides, splitLines } from "./patch.ts";

/** Parses and rebuilds, asserting both steps succeeded. */
function rebuild(patch: string, path: string, modified: string): string {
  const parsed = parseFilePatch(patch, path);
  assert.notEqual(parsed, null, "patch did not parse");
  const result = rebuildSides(parsed!.file, modified);
  assert.ok(
    result.ok,
    result.ok ? "" : `rebuild failed: ${result.mismatch.message}`,
  );
  assert.equal(
    result.sides.modified,
    modified,
    "modified side was not the file",
  );
  return result.sides.original;
}

const TWENTY_LINES = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt\n";

test("splitLines keeps line endings, and joining is the identity", () => {
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("a\nb\n"), ["a\n", "b\n"]);
  assert.deepEqual(splitLines("a\nb"), ["a\n", "b"]);
  assert.deepEqual(splitLines("a\r\nb\r\n"), ["a\r\n", "b\r\n"]);
  assert.deepEqual(splitLines("\n"), ["\n"]);
  for (const text of ["", "a\nb\n", "a\nb", "a\r\nb", "\n\n"]) {
    assert.equal(splitLines(text).join(""), text);
  }
});

test("a single-hunk change rebuilds the old file", () => {
  const parsed = parseFilePatch(P.rename, "ren2.txt");
  assert.notEqual(parsed, null);
  // The slot only passes the after-side path; the rename survives in the patch.
  assert.equal(parsed!.file.name, "ren2.txt");
  assert.equal(parsed!.file.prevName, "ren.txt");
  assert.equal(parsed!.file.type, "rename-changed");

  assert.equal(
    rebuild(P.rename, "ren2.txt", "old1\nOLD2\nold3\n"),
    "old1\nold2\nold3\n",
  );
});

test("several hunks rebuild together without shifting each other", () => {
  const after = TWENTY_LINES.replace("\nb\n", "\nB\n").replace(
    "\nr\n",
    "\nR\n",
  );
  assert.equal(rebuild(P.twoHunks, "multi.txt", after), TWENTY_LINES);
});

test("a new file rebuilds to nothing", () => {
  assert.equal(parseFilePatch(P.added, "added.txt")!.file.type, "new");
  assert.equal(rebuild(P.added, "added.txt", "x\ny\n"), "");
});

test("a deleted file rebuilds from nothing", () => {
  // `@@ -1,3 +0,0 @@` — after-side start 0, count 0. Treating that 0 as a
  // 1-based line number would splice at index -1.
  assert.equal(parseFilePatch(P.deleted, "del.txt")!.file.type, "deleted");
  assert.equal(rebuild(P.deleted, "del.txt", ""), "a\nb\nc\n");
});

test("a zero-context deletion lands on the right line", () => {
  // `@@ -5,3 +4,0 @@` removes what was line 5, which is index 4 — the same
  // number the header carries, not one less. Off by one here would put l5, l6
  // and l7 back above l4.
  const before = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n";
  const after = "l1\nl2\nl3\nl4\nl8\nl9\nl10\n";
  assert.equal(rebuild(P.zeroContextDeletion, "mid.txt", after), before);
});

test("a file that lost its trailing newline rebuilds with it", () => {
  assert.equal(
    rebuild(P.noTrailingNewline, "noeol.txt", "keep\nnow"),
    "keep\nwas\n",
  );
});

test("trailing spaces on the changed line survive", () => {
  // bb's own patch completion runs `trimEnd()` over the whole patch, which eats
  // the trailing spaces of the last line along with the newline after it.
  assert.equal(rebuild(P.trailingSpaces, "space.txt", "x\nz  \n"), "x\ny  \n");
});

test("a CRLF file rebuilds as CRLF", () => {
  assert.equal(
    rebuild(P.crlf, "crlf.txt", "c1\r\nC2\r\nc3\r\n"),
    "c1\r\nc2\r\nc3\r\n",
  );
});

test("a CRLF file rebuilds as CRLF even when the patch arrived flattened", () => {
  // What bb hands over when it rebuilt the patch text from parsed metadata, or
  // when it came through `experimental_Diff`: every CRLF replaced with LF. The
  // rebuilt side has to follow the file, or the editor shows all three lines as
  // changed.
  assert.equal(
    rebuild(P.crlfFlattened, "crlf.txt", "c1\r\nC2\r\nc3\r\n"),
    "c1\r\nc2\r\nc3\r\n",
  );
});

test("a diff that only changes line endings is left alone", () => {
  // The patch still carries CRLF, so it is taken at its word rather than being
  // normalised to the file it is being rebuilt against.
  assert.equal(rebuild(P.crlfToLf, "crlf.txt", "c1\nc2\n"), "c1\r\nc2\r\n");
});

test("a bare hunk is completed from the path", () => {
  assert.equal(
    parsePatchFiles(P.bareHunk).flatMap((parsed) => parsed.files).length,
    0,
    "a bare hunk should parse to nothing without completion",
  );

  const parsed = parseFilePatch(P.bareHunk, "ren2.txt");
  assert.notEqual(parsed, null);
  assert.equal(parsed!.file.name, "ren2.txt");
  assert.equal(
    rebuild(P.bareHunk, "ren2.txt", "old1\nOLD2\nold3\n"),
    "old1\nold2\nold3\n",
  );
});

test("a hunk header without counts means one line a side", () => {
  assert.equal(rebuild(P.singleLine, "x.txt", "now\n"), "was\n");
});

test("a bare hunk with no path to complete it from stays unparsed", () => {
  assert.equal(parseFilePatch(P.bareHunk, "   "), null);
});

test("unusable patches parse to null", () => {
  assert.equal(parseFilePatch("", "x.txt"), null);
  assert.equal(parseFilePatch("   \n", "x.txt"), null);
  assert.equal(parseFilePatch(P.notAPatch, "x.txt"), null);
  // A pure rename has no hunks, so it says nothing about the file's contents
  // and must not be allowed to vouch for them.
  assert.equal(parseFilePatch(P.pureRename, "b.txt"), null);
  // Two files in one patch: the slot promises one, and rebuilding the wrong one
  // against this path would be worse than refusing.
  assert.equal(parseFilePatch(P.twoFiles, "a.txt"), null);
});

test("a file that moved on underneath fails with the hunk that disagreed", () => {
  const parsed = parseFilePatch(P.twoHunks, "multi.txt");
  assert.notEqual(parsed, null);

  // Someone edited line 16 — inside the second hunk's context, not the first's.
  const edited =
    "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\nEDITED\nq\nR\ns\nt\n";
  const result = rebuildSides(parsed!.file, edited);
  assert.ok(!result.ok);
  assert.equal(result.mismatch.hunkIndex, 1);
  assert.match(result.mismatch.message, /line 16/);
});

test("a file too short for the patch fails rather than rebuilding a prefix", () => {
  const parsed = parseFilePatch(P.secondHunkOnly, "multi.txt");
  const result = rebuildSides(parsed!.file, "o\np\nq\nR\n");
  assert.ok(!result.ok);
  assert.equal(result.mismatch.hunkIndex, 0);
});

test("a hunk whose content does not match its header is refused", () => {
  // Which guard catches this depends on the parser: the copy bb ships leaves
  // the header's counts on the hunk, so the content total disagrees with them;
  // newer copies recompute the counts to match what they read, so only the raw
  // header is left to disagree. Both are refusals, and the point is that the
  // dropped line never reaches the rebuilt side.
  const parsed = parseFilePatch(P.malformed, "x.txt");
  assert.notEqual(parsed, null);
  assert.match(parsed!.file.hunks[0].hunkSpecs ?? "", /@@ -1,3 \+1,3 @@/);

  const result = rebuildSides(parsed!.file, "now\nkeep\n\n");
  assert.ok(!result.ok);
  assert.equal(result.mismatch.hunkIndex, 0);
});

test("git's mnemonic prefixes do not cost the patch its name", () => {
  // Without putting `a/` and `b/` back, the parser logs `invalid git diff
  // header`, recovers, and returns every hunk under an empty name — which bb
  // then passes to this slot as the file's path.
  const parsed = parseFilePatch(P.mnemonicPrefix, "");
  assert.notEqual(parsed, null);
  assert.equal(parsed!.file.name, "mne.txt");
  assert.equal(parsed!.file.type, "change");
  assert.equal(
    rebuild(P.mnemonicPrefix, "", "keep\nnow\n"),
    "keep\nwas\n",
  );

  const added = parseFilePatch(P.mnemonicPrefixAdded, "");
  assert.notEqual(added, null);
  assert.equal(added!.file.name, "mne-new.txt");
  assert.equal(added!.file.type, "new");
});

test("a patch already written with a/ and b/ is passed through untouched", () => {
  assert.equal(parseFilePatch(P.rename, "ren2.txt")!.patch, P.rename);
});
