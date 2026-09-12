// Turns the `patch` prop into the two texts a diff editor needs.
//
// The slot hands over a patch and, sometimes, `experimental_fullFileContents`.
// Sometimes is the problem: the timeline never supplies full contents and the
// diff panel resolves them lazily, so the first render is always null. For the
// diffs this plugin exists for, the patch is all there is.
//
// So the after-side is not reconstructed at all — it is the file on disk, which
// is the thing being edited and written back. The before-side is derived from
// it, by putting each hunk's deletion lines back where its addition lines sit.
// That needs no second read and no full file contents, and it only works when
// the file really is the patch's after-side — which is the same question as
// whether the diff is editable at all, so the check and the reconstruction are
// one walk.
//
// Parsing is `@pierre/diffs`, the parser bb's own renderer uses. bb shims it to
// a runtime global, so it costs nothing in the bundle, and agreeing with bb is
// then a property of the build rather than of how carefully this was written.
import {
  SPLIT_WITH_NEWLINES,
  getLineEndingType,
  parsePatchFiles,
} from "@pierre/diffs";
import type { FileDiffMetadata, Hunk } from "@pierre/diffs";

export interface ParsedFilePatch {
  /** The patch actually parsed — completed if it arrived without a header. */
  patch: string;
  file: FileDiffMetadata;
}

/** Both sides of a diff as whole-file text, ready to hand to an editor. */
export interface DiffSides {
  original: string;
  modified: string;
}

/**
 * Why a patch and a file could not be reconciled. A patch that is unusable on
 * its own terms never gets this far — `parseFilePatch` returns null for those.
 */
export interface PatchMismatch {
  /** Which hunk disagreed, indexing `file.hunks`. */
  hunkIndex: number;
  message: string;
}

export type RebuildResult =
  | { ok: true; sides: DiffSides }
  | { ok: false; mismatch: PatchMismatch };

/**
 * Parses a single-file patch, completing it first if it arrived bare.
 *
 * Null means the patch is not something to rebuild from: it did not parse, it
 * covered more than one file, or it has no hunks. A patch with no hunks — a
 * pure rename, or text that merely failed to parse as a diff — would make every
 * later check pass by having nothing to check, so it is refused here rather
 * than allowed to vouch for a file it says nothing about.
 */
export function parseFilePatch(
  patch: string,
  path: string,
): ParsedFilePatch | null {
  if (patch.trim() === "") return null;

  const completed = completePatch(patch, path);
  let files: FileDiffMetadata[];
  try {
    files = parsePatchFiles(completed).flatMap((parsed) => parsed.files);
  } catch {
    return null;
  }

  if (files.length !== 1) return null;
  const file = files[0];
  if (file.hunks.length === 0) return null;
  return { patch: completed, file };
}

/**
 * Rebuilds the before-side of a diff from its after-side.
 *
 * `modified` is the file as it exists now. Every hunk is checked against it
 * first — each hunk's after-side lines have to already sit at the line numbers
 * the hunk claims — and only then are that hunk's deletion lines spliced in
 * where its addition lines were. A single disagreement fails the whole thing,
 * because a patch that does not describe this file cannot be used to rebuild
 * the other side of it.
 */
export function rebuildSides(
  file: FileDiffMetadata,
  modified: string,
): RebuildResult {
  const modifiedLines = splitLines(modified);
  const restoreCrlf = patchWasFlattened(file, modified);
  const originalLines = modifiedLines.slice();

  const afterSideMatches = (patchLine: number, fileLine: number): boolean =>
    sameLine(file.additionLines[patchLine], modifiedLines[fileLine]);

  // Back to front. Splicing a hunk shifts every line after it, and hunks come
  // in ascending order, so working backwards keeps the line numbers of the
  // hunks not yet reached meaningful.
  for (let index = file.hunks.length - 1; index >= 0; index -= 1) {
    const hunk = file.hunks[index];
    const start = afterSideStart(hunk);
    const totals = hunkContentTotals(hunk);

    // The parser recovers from a malformed hunk rather than throwing: it logs
    // the shortfall to the console and hands back the lines it did manage to
    // read. Both checks below are for that one case, and which of them fires
    // depends on the version of the parser doing the recovering — the copy bb
    // ships leaves the header's counts on the hunk, so the content disagrees
    // with them; newer copies recompute the counts, so only the raw header is
    // left to disagree. Neither check is redundant, on either version.
    const declared = declaredCounts(hunk);
    if (
      declared !== null &&
      (declared.additions !== hunk.additionCount ||
        declared.deletions !== hunk.deletionCount)
    ) {
      return fail(
        index,
        `${describe(hunk, index)} declares ${declared.deletions} old and ` +
          `${declared.additions} new lines but only ${hunk.deletionCount} ` +
          `and ${hunk.additionCount} parsed — the patch is malformed`,
      );
    }
    // This one also guards the splice below, which replaces `additionCount`
    // lines with whatever walking `hunkContent` produces.
    if (
      totals.additions !== hunk.additionCount ||
      totals.deletions !== hunk.deletionCount
    ) {
      return fail(
        index,
        `${describe(hunk, index)} carries ${totals.deletions} old and ` +
          `${totals.additions} new lines but counts ${hunk.deletionCount} ` +
          `and ${hunk.additionCount}`,
      );
    }
    if (
      hunk.deletionLineIndex + hunk.deletionCount > file.deletionLines.length ||
      hunk.additionLineIndex + hunk.additionCount > file.additionLines.length
    ) {
      return fail(
        index,
        `${describe(hunk, index)} runs past the end of the patch's own lines`,
      );
    }
    if (start < 0 || start + hunk.additionCount > modifiedLines.length) {
      return fail(
        index,
        `${describe(hunk, index)} covers lines ${start + 1}` +
          `–${start + hunk.additionCount} but the file has ` +
          `${modifiedLines.length}`,
      );
    }

    const rebuilt: string[] = [];
    let deletionIndex = hunk.deletionLineIndex;
    let additionIndex = hunk.additionLineIndex;
    let fileIndex = start;

    for (const part of hunk.hunkContent) {
      if (part.type === "context") {
        for (let n = 0; n < part.lines; n += 1) {
          if (!afterSideMatches(additionIndex + n, fileIndex + n)) {
            return fail(index, disagreement(hunk, index, fileIndex + n));
          }
          // Context is the same line on both sides, so the file's own bytes are
          // the most faithful before-side line there is — line ending included.
          rebuilt.push(modifiedLines[fileIndex + n]);
        }
        deletionIndex += part.lines;
        additionIndex += part.lines;
        fileIndex += part.lines;
        continue;
      }

      for (let n = 0; n < part.deletions; n += 1) {
        const line = file.deletionLines[deletionIndex + n];
        rebuilt.push(restoreCrlf ? withCrlf(line) : line);
      }
      for (let n = 0; n < part.additions; n += 1) {
        if (!afterSideMatches(additionIndex + n, fileIndex + n)) {
          return fail(index, disagreement(hunk, index, fileIndex + n));
        }
      }
      deletionIndex += part.deletions;
      additionIndex += part.additions;
      fileIndex += part.additions;
    }

    originalLines.splice(start, hunk.additionCount, ...rebuilt);
  }

  return { ok: true, sides: { original: originalLines.join(""), modified } };
}

/**
 * Splits text into lines that keep their endings, so joining them back is the
 * identity. The regex is the parser's own, so a line means the same thing on
 * both sides of every comparison here.
 */
export function splitLines(text: string): string[] {
  return text === "" ? [] : text.split(SPLIT_WITH_NEWLINES);
}

/**
 * Gives a patch the header the parser needs, if it does not have one.
 *
 * The slot documents `patch` as always complete, and through bb's own surfaces
 * it is. A plugin rendering `experimental_Diff` can still pass a bare `@@`
 * hunk — the shape GitHub's REST patches arrive in — and the parser returns no
 * files at all for those rather than saying anything about why.
 *
 * Unlike bb's version this does not trim the patch. `trimEnd()` takes the
 * trailing spaces off the last line along with the newline after it, which
 * quietly changes the content of a line that is about to be reconstructed.
 */
function completePatch(patch: string, path: string): string {
  const body = patch.endsWith("\n") ? patch : `${patch}\n`;
  if (body.startsWith("diff --git") || body.startsWith("--- ")) return body;

  const name = path.trim();
  if (name === "") return body;
  const header = `diff --git a/${name} b/${name}`;
  return `${header}\n--- a/${name}\n+++ b/${name}\n${body}`;
}

/**
 * Where a hunk's after-side lines start, zero-based.
 *
 * `additionStart` is the 1-based line number out of the hunk header, except
 * when the hunk adds nothing. Unified diff writes `+N,0` for a pure deletion,
 * where N is the line it comes *after* rather than the line it starts at:
 * `@@ -5,3 +4,0 @@` removes what was the fifth line, which is index 4 — the
 * same number, not one less. Subtracting one anyway puts every pure deletion a
 * line too early, and a deleted file (`+0,0`) at index -1.
 */
function afterSideStart(hunk: Hunk): number {
  return hunk.additionCount === 0 ? hunk.additionStart : hunk.additionStart - 1;
}

/** `@@ -old[,count] +new[,count] @@`, where an absent count means one line. */
const HUNK_HEADER_COUNTS = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

/**
 * What the hunk header claims, as opposed to what the parser managed to read.
 *
 * Null when there is no header to read — a hunk the host rebuilt from metadata
 * rather than parsed carries no `hunkSpecs`, and then the parsed counts are all
 * there is and all there needs to be.
 */
function declaredCounts(
  hunk: Hunk,
): { deletions: number; additions: number } | null {
  const match = hunk.hunkSpecs?.match(HUNK_HEADER_COUNTS);
  if (!match) return null;
  return {
    deletions: match[1] === undefined ? 1 : Number(match[1]),
    additions: match[2] === undefined ? 1 : Number(match[2]),
  };
}

function hunkContentTotals(hunk: Hunk): {
  deletions: number;
  additions: number;
} {
  let deletions = 0;
  let additions = 0;
  for (const part of hunk.hunkContent) {
    if (part.type === "context") {
      deletions += part.lines;
      additions += part.lines;
    } else {
      deletions += part.deletions;
      additions += part.additions;
    }
  }
  return { deletions, additions };
}

/**
 * Compares two lines ignoring how they end.
 *
 * Line endings are not evidence here. bb rebuilds patch text out of its own
 * parsed metadata whenever the caller supplied file contents rather than a
 * patch, and that round trip joins every line with "\n" — so a CRLF file
 * arrives described by an LF patch, with a last line that has grown a newline
 * it never had. Comparing past the last line ending would reject those diffs,
 * and those diffs are the ordinary ones.
 *
 * The cost is that a diff whose only change is the line endings verifies
 * against both of its sides. The reconstruction still comes out right, because
 * the before-side lines are taken from the patch rather than from the file.
 */
function sameLine(a: string, b: string): boolean {
  return withoutEnding(a) === withoutEnding(b);
}

function withoutEnding(line: string): string {
  return line.replace(/\r?\n$|\r$/, "");
}

/**
 * True when the patch's line endings were flattened on the way here.
 *
 * bb rebuilds patch text from parsed metadata by joining lines with "\n", and
 * `experimental_Diff` replaces every CRLF in a patch before parsing it. Either
 * leaves a CRLF file described by an LF patch. Splicing those LF lines into a
 * CRLF file would have the editor show every rebuilt line as changed, which is
 * the opposite of the point.
 *
 * The condition is deliberately narrow — the file has CRLF somewhere and the
 * patch has none at all. A patch that kept even one CRLF is trusted as it
 * stands, so a diff that genuinely changes line endings still renders as one.
 */
function patchWasFlattened(file: FileDiffMetadata, modified: string): boolean {
  if (getLineEndingType(modified) !== "CRLF") return false;
  const endsCrlf = (line: string): boolean => line.endsWith("\r\n");
  return (
    !file.deletionLines.some(endsCrlf) && !file.additionLines.some(endsCrlf)
  );
}

function withCrlf(line: string): string {
  return line.endsWith("\n") && !line.endsWith("\r\n")
    ? `${line.slice(0, -1)}\r\n`
    : line;
}

function describe(hunk: Hunk, index: number): string {
  const specs = hunk.hunkSpecs?.trim();
  return specs === undefined || specs === "" ? `hunk ${index + 1}` : specs;
}

function disagreement(hunk: Hunk, index: number, line: number): string {
  return `${describe(hunk, index)} does not match the file at line ${line + 1}`;
}

function fail(hunkIndex: number, message: string): RebuildResult {
  return { ok: false, mismatch: { hunkIndex, message } };
}
