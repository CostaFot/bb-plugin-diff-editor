// The fixtures are the ones in `lib/patch-fixtures.ts`, so what the editor is
// handed is checked against the same patches the parser is.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PATCH_FIXTURES as P } from "./patch-fixtures.ts";
import { diffContent, patchLineNumbers } from "./diff-content.ts";
import { parseFilePatch } from "./patch.ts";

function parse(patch: string, path: string) {
  const parsed = parseFilePatch(patch, path);
  assert.notEqual(parsed, null, "patch did not parse");
  return parsed!.file;
}

const TWENTY_LINES = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt\n";

test("with no full contents, both sides are the patch's own lines", () => {
  const content = diffContent(parse(P.rename, "ren2.txt"), null);

  assert.equal(content.whole, false);
  assert.equal(content.original, "old1\nold2\nold3\n");
  assert.equal(content.modified, "old1\nOLD2\nold3\n");
});

test("the gutter says what the lines are called in the file, not in the text", () => {
  // Two hunks, at lines 1-5 and 15-20 of a twenty-line file. Laid end to end
  // that is eleven lines of text whose sixth line is line 15 of the file.
  const content = diffContent(parse(P.twoHunks, "multi.txt"), null);

  assert.equal(content.modified.split("\n").length - 1, 11);
  assert.deepEqual(
    content.modifiedLineNumbers,
    [1, 2, 3, 4, 5, 15, 16, 17, 18, 19, 20],
  );
  assert.deepEqual(content.originalLineNumbers, content.modifiedLineNumbers);
});

test("a hunk that adds nothing numbers only the side it has lines on", () => {
  // `@@ -5,3 +4,0 @@` — three old lines, no new ones.
  const file = parse(P.zeroContextDeletion, "mid.txt");
  const { originalLineNumbers, modifiedLineNumbers } = patchLineNumbers(file);

  assert.deepEqual(originalLineNumbers, [5, 6, 7]);
  assert.deepEqual(modifiedLineNumbers, []);
});

test("a hunk header with no counts still numbers its one line a side", () => {
  const file = parse(P.singleLine, "x.txt");

  assert.deepEqual(patchLineNumbers(file), {
    originalLineNumbers: [1],
    modifiedLineNumbers: [1],
  });
});

test("full contents the patch agrees with give whole files and no numbering", () => {
  const modified = TWENTY_LINES.replace("\nb\n", "\nB\n").replace(
    "\nr\n",
    "\nR\n",
  );
  const content = diffContent(parse(P.twoHunks, "multi.txt"), {
    new: { content: modified },
  });

  assert.equal(content.whole, true);
  assert.equal(content.modified, modified);
  assert.equal(content.original, TWENTY_LINES);
  assert.equal(content.originalLineNumbers, null);
  assert.equal(content.modifiedLineNumbers, null);
});

test("full contents the patch disagrees with are dropped, not half-believed", () => {
  // The same file with the hunks nowhere near where the patch says they are.
  const content = diffContent(parse(P.twoHunks, "multi.txt"), {
    new: { content: "something else entirely\n" },
  });

  assert.equal(content.whole, false);
  assert.equal(content.modified, "a\nB\nc\nd\ne\no\np\nq\nR\ns\nt\n");
  assert.notEqual(content.modifiedLineNumbers, null);
});
