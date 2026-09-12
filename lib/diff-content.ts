// Decides what text to put in the two editors, and what to number the lines.
//
// The finished plugin reads the after-side off disk. Nothing resolves a path
// to a file yet — that is COS-169 — so this takes the best of what the slot
// itself hands over:
//
//   `experimental_fullFileContents`, when it is there and the patch agrees
//   with it. Both sides are then whole files and the gutter is just the line
//   numbers, as in any editor.
//
//   The patch's own lines otherwise, which is every timeline diff and the
//   first render of every diff panel one. The two sides are then the hunks
//   concatenated, so the text between hunks is missing and the gutter has to
//   be told what the lines are really called.
//
// The verification is not optional politeness: the SDK says a replacement must
// check that the paths and hunk lines agree with `patch` before treating the
// contents as complete, and bb's own renderer does it. `rebuildSides` is that
// check and the reconstruction in one walk, so contents that disagree are
// dropped rather than half-believed.
import type { FileDiffMetadata } from "@pierre/diffs";

import { rebuildSides, type DiffSides } from "./patch.ts";

/** One side's real 1-based file line numbers, one per line of its text. */
export type LineNumbers = readonly number[];

export interface DiffContent extends DiffSides {
  /**
   * Null when the text is the whole file and Monaco's own numbering is
   * already right. An array when it is not, indexed by rendered line.
   */
  originalLineNumbers: LineNumbers | null;
  modifiedLineNumbers: LineNumbers | null;
  /** True when both sides are complete files rather than the patch's lines. */
  whole: boolean;
}

/** Only the field this needs, so the SDK's shape is not a dependency here. */
export interface FullFileContents {
  new: { content: string };
}

export function diffContent(
  file: FileDiffMetadata,
  fullFileContents: FullFileContents | null,
): DiffContent {
  if (fullFileContents !== null) {
    // Only the after-side is read. The before-side that comes back is the
    // whole old file — `rebuildSides` starts from the after-side and splices,
    // so everything outside the hunks is already there — and it is derived
    // from contents the patch has just vouched for, where the supplied
    // `old` is a second thing that would have to be vouched for separately.
    const rebuilt = rebuildSides(file, fullFileContents.new.content);
    if (rebuilt.ok) {
      return {
        ...rebuilt.sides,
        originalLineNumbers: null,
        modifiedLineNumbers: null,
        whole: true,
      };
    }
  }

  return {
    original: file.deletionLines.join(""),
    modified: file.additionLines.join(""),
    ...patchLineNumbers(file),
    whole: false,
  };
}

/**
 * What the patch's own lines are called in the files they came from.
 *
 * `deletionLines` and `additionLines` are the hunks' lines laid end to end,
 * so line 12 of the text can be line 400 of the file, and the line after it
 * can be line 900. Numbering that 1, 2, 3 would be a lie told in the one
 * place a reader goes to check.
 *
 * A hunk covers `deletionCount` entries from `deletionLineIndex` and
 * `additionCount` from `additionLineIndex`, contiguously, starting at the
 * line its header names. A hunk with a count of zero — `@@ -5,3 +4,0 @@`, a
 * pure deletion — contributes nothing to that side and so never reaches the
 * start line, which is where `+N,0` would otherwise be off by one.
 */
export function patchLineNumbers(file: FileDiffMetadata): {
  originalLineNumbers: number[];
  modifiedLineNumbers: number[];
} {
  const originalLineNumbers = new Array<number>(file.deletionLines.length).fill(
    0,
  );
  const modifiedLineNumbers = new Array<number>(file.additionLines.length).fill(
    0,
  );
  for (const hunk of file.hunks) {
    for (let n = 0; n < hunk.deletionCount; n += 1) {
      originalLineNumbers[hunk.deletionLineIndex + n] = hunk.deletionStart + n;
    }
    for (let n = 0; n < hunk.additionCount; n += 1) {
      modifiedLineNumbers[hunk.additionLineIndex + n] = hunk.additionStart + n;
    }
  }
  return { originalLineNumbers, modifiedLineNumbers };
}
